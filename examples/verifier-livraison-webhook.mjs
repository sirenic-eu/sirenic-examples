#!/usr/bin/env node
/**
 * Contrôle QUOTIDIEN de la preuve manquante : une livraison webhook RÉELLE de la
 * surveillance Sirenic, en production.
 *
 * Contexte (11/08/2026) : le chemin détection → webhook signé Ed25519 → digest
 * est couvert par les tests unitaires mais n'avait jamais tourné en prod. Une
 * watch de 10 SIREN (personnes morales uniquement, aucune donnée personnelle)
 * a été achetée le 11/08 avec un récepteur tiers. Un webhook ne part qu'avec un
 * ÉVÉNEMENT, et le tour est quotidien : ce script attend, puis conclut.
 *
 * Tant qu'il n'y a rien : il se tait (sortie 0, « rien à signaler »).
 * Dès qu'une livraison arrive, il fait les trois choses qui ferment la preuve :
 *   1. VÉRIFIE la signature Ed25519 avec la clé de son kid, prise dans `keys`
 *      du document servi par l'API (jamais la clé de la racine, celle du jour),
 *      recette `sirenic-v1:{kid}:{timestamp}:{sha256(corps) en base64}` ;
 *   2. ARRÊTE la watch (le jeton a transité chez un tiers : il est brûlé) ;
 *   3. ÉCRIT la trace, à committer sur le dépôt privé.
 *
 *   node examples/verifier-livraison-webhook.mjs
 */
import { createHash, verify as verifierSignature, createPublicKey } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const API = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const BAC = process.env.WEBHOOK_BIN_ID ?? "cc6983e9-02cd-4c27-90d5-799bb7c94520";
const TRACES = "/home/ubuntu/sirenic-examples/resultats/smoke-surveillance-webhook-2026-08-11T17-45-46-797Z";
const FICHIER_JETON = `${TRACES}/JETON-A-ARRETER.txt`;

const journal = [];
const dire = (m) => {
  console.log(m);
  journal.push(m);
};

/** La forme exacte de l'horodatage que Sirenic signe : ISO 8601 en UTC, à la milliseconde au plus. */
const FORME_HORODATAGE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * Vérifie UNE livraison avec le document des clés publiées (`documentCles`, celui
 * de /.well-known/sirenic-signing-key) : l'entrée de `keys` dont le kid est celui
 * de la livraison, et le jour UTC de son horodatage dans [valid_from, valid_until]
 * (bornes incluses ; valid_until nulle : clé toujours en service). Jamais la clé
 * de la racine : c'est la clé du jour, elle ne vérifie pas une livraison signée
 * avant un changement de clé. Un document sans `keys` (archivé avant le
 * 02/10/2026) : sa racine, si et seulement si son kid est celui de la livraison.
 * Rend `{ kid, ok, motif }`. Exportée pour le test ; aucun appel réseau.
 */
export function verifierLivraison(req, documentCles) {
  const entetes = Object.fromEntries(
    Object.entries(req.headers ?? {}).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]),
  );
  const kid = entetes["x-sirenic-key-id"];
  const ts = entetes["x-sirenic-timestamp"];
  const sig = entetes["x-sirenic-signature"];
  const corps = Buffer.from(req.content ?? "", "utf8");

  if (!kid || !ts || !sig) return { kid, ok: false, motif: "en-têtes de signature absents" };
  // Le jour se lit sur la chaîne signée : `new Date()` lirait en heure locale un horodatage sans Z.
  if (!FORME_HORODATAGE.test(ts)) return { kid, ok: false, motif: `horodatage mal formé (${ts})` };
  const jour = ts.slice(0, 10);

  let clePublique;
  let motif;
  if (Array.isArray(documentCles.keys)) {
    const entree = documentCles.keys.find((e) => e.kid === kid);
    if (!entree) return { kid, ok: false, motif: "kid non publié dans keys" };
    const fin = entree.valid_until ?? "aujourd'hui";
    if (jour < entree.valid_from || (entree.valid_until !== null && jour > entree.valid_until)) {
      return { kid, ok: false, motif: `hors de la fenêtre de sa clé (${entree.valid_from} au ${fin})` };
    }
    clePublique = entree.public_key;
    motif = `clé de son kid, en usage du ${entree.valid_from} au ${fin}`;
  } else {
    if (documentCles.kid !== kid) return { kid, ok: false, motif: "document sans keys, dont la racine porte un autre kid" };
    clePublique = documentCles.public_key;
    motif = "racine d'un document sans keys, aucune fenêtre à contrôler";
  }

  const publique = createPublicKey({
    key: Buffer.from(clePublique, "base64"),
    format: "der",
    type: "spki",
  });
  const condensat = createHash("sha256").update(corps).digest("base64");
  const message = Buffer.from(`sirenic-v1:${kid}:${ts}:${condensat}`, "utf8");
  return verifierSignature(null, message, publique, Buffer.from(sig, "base64"))
    ? { kid, ok: true, motif }
    : { kid, ok: false, motif: "signature invalide" };
}

async function principal() {
  const requetes = await (async () => {
    try {
      const r = await fetch(`https://webhook.site/token/${BAC}/requests?sorting=newest`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  })();

  if (requetes === null) {
    dire("bac injoignable : rien de concluant, on retentera demain");
    process.exit(0);
  }

  const recues = Array.isArray(requetes.data) ? requetes.data : [];
  if (recues.length === 0) {
    dire(`aucune livraison à ce jour (bac ${BAC}) : la watch attend un événement réel`);
    process.exit(0);
  }

  // --- Une livraison est arrivée : on ferme la preuve -----------------------
  dire(`${recues.length} livraison(s) reçue(s) : vérification de la signature`);

  const cle = await (await fetch(`${API}/.well-known/sirenic-signing-key`)).json();

  const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
  const dossier = `/home/ubuntu/sirenic-examples/resultats/livraison-webhook-${horodatage}`;
  mkdirSync(dossier, { recursive: true });

  let signaturesValides = 0;
  for (const [i, req] of recues.entries()) {
    const { kid, ok, motif } = verifierLivraison(req, cle);
    if (ok) signaturesValides += 1;
    dire(`  livraison ${i + 1} : kid=${kid ?? "(absent)"} signature=${ok ? "VALIDE" : "INVALIDE"} (${motif})`);
    // Le corps porte le jeton porteur : conservé en trace PRIVÉE uniquement.
    writeFileSync(`${dossier}/livraison-${i + 1}.json`, JSON.stringify(req, null, 2));
  }

  dire(`signatures valides : ${signaturesValides}/${recues.length}`);
  dire(`clés publiées : ${(cle.keys ?? [cle]).map((e) => e.kid).join(", ")}`);

  // --- Arrêt de la watch : le jeton a transité chez un tiers ----------------
  if (existsSync(FICHIER_JETON)) {
    const jeton = readFileSync(FICHIER_JETON, "utf8").trim();
    const r = await fetch(`${API}/v1/surveillance/${encodeURIComponent(jeton)}/arreter`);
    dire(`arrêt de la watch (jeton brûlé) → HTTP ${r.status}`);
  } else {
    dire("fichier de jeton introuvable : arrêter la watch à la main");
  }

  writeFileSync(`${dossier}/verdict.txt`, journal.join("\n") + "\n");

  // --- Trace sur le dépôt PRIVÉ (règle CDU du 11/08) ------------------------
  // Le corps d'une livraison porte un jeton porteur : ce dépôt ne devient JAMAIS
  // public. Commit fait ici pour que le contrôle soit autonome : personne n'a à
  // se souvenir de le faire le jour où la livraison tombe.
  try {
    const depot = "/home/ubuntu/sirenic-resultats";
    execSync(`cp -r ${dossier} ${depot}/smokes/`, { stdio: "pipe" });
    execSync(
      `git -C ${depot} add -A && git -C ${depot} -c user.name=Sirenic -c user.email=contact@sirenic.eu ` +
        `commit -q -m "livraison webhook surveillance : ${signaturesValides}/${recues.length} signature(s) Ed25519 verifiee(s), watch arretee" && ` +
        `git -C ${depot} push -q origin main`,
      { stdio: "pipe" },
    );
    dire("trace commitée sur le dépôt privé de traces");
  } catch (e) {
    dire(`commit de la trace ÉCHOUÉ (${String(e).slice(0, 120)}), dossier conservé : ${dossier}`);
  }

  dire(`\ntraces : ${dossier}`);
  process.exit(signaturesValides === recues.length ? 0 : 1);
}

// Lancé directement seulement : l'importer (le test) n'exécute rien.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal();
