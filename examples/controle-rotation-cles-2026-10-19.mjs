#!/usr/bin/env node
/**
 * Contrôle de la rotation des clés de signature sur des réponses RÉELLES
 * conservées (ticket 325 de kopko13/sirenic, 19/10/2026).
 *
 * Le test publié (test/rotation-cles.test.mjs) joue la recette sur des clés de
 * test. Ce contrôle la joue sur des réponses signées par la clé de production,
 * conservées avec leurs en-têtes : le jour où Sirenic change de clé, chacune doit
 * encore se vérifier par les trois copies de la recette de cette vitrine.
 *
 *   node examples/controle-rotation-cles-2026-10-19.mjs [--cles <document.json>] <corps> <en-têtes> [<corps> <en-têtes> …]
 *
 * <en-têtes> : lignes « nom: valeur » (sortie de curl -D, ligne de statut
 * ignorée) ou objet JSON ; seuls X-Sirenic-Key-Id, X-Sirenic-Timestamp et
 * X-Sirenic-Signature sont lus. --cles : le document de
 * /.well-known/sirenic-signing-key capturé (sinon lu sur SIRENIC_URL, défaut
 * https://api.sirenic.eu).
 *
 * Rotation simulée : dans le document des clés, chaque entrée encore ouverte
 * (celle du kid des réponses comprise) est fermée au jour UTC du lancement, et
 * une clé de test tirée au hasard s'ouvre ce jour-là, en racine. Chaque réponse
 * passe ensuite par les trois copies :
 *   - verifierLivraison de examples/verifier-livraison-webhook.mjs, importée
 *     sans rien exécuter (sans objet pour un corps qui n'est pas du texte UTF-8) ;
 *   - examples/verify-signature.ts et examples/verify-invoice-file.ts, lancés
 *     par le tsx du dépôt contre un faux serveur local (test/faux-sirenic.mjs) qui
 *     sert le corps conservé avec ses trois en-têtes de signature d'origine ;
 *     aucun 402, donc aucun paiement ; clé de portefeuille tirée au hasard.
 * Le verdict se lit sur la ligne « signature valid » ou sur le motif du refus,
 * jamais sur le code de sortie : après la signature, un exemple lit le corps
 * comme une réponse de sa route (sanctions, facturation), ce qu'un autre corps
 * n'est pas ; l'archive de verify-invoice-file.ts n'est donc pas exercée ici
 * (le test publié la couvre).
 *
 * Témoin négatif : la même rotation, l'entrée du kid fermée au 2026-09-04 ;
 * toute réponse signée après doit être refusée « hors de la fenêtre » par les
 * trois copies.
 *
 * Sortie 0 seulement si chaque verdict attendu tombe, sur au moins une réponse.
 * Rien d'un corps n'est affiché : nom du fichier, taille, sha256, kid,
 * horodatage et verdicts. À lancer sous le verrou de la machine (trente
 * lancements de tsx et plus).
 */
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { demarrerFauxSirenic, documentDesCles, nouvelleCle } from "../test/faux-sirenic.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const TSX = join(RACINE, "node_modules", ".bin", "tsx");
const API = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const FUSEAU = "Pacific/Kiritimati"; // UTC+14 : un jour lu en heure locale se tromperait sur les bornes
const JOUR_TEMOIN = "2026-09-04";
const SIMULTANES = 4;

function arreter(message) {
  console.error(message);
  process.exit(2);
}

// --- Arguments ---------------------------------------------------------------
const args = process.argv.slice(2);
let fichierCles = null;
if (args[0] === "--cles") {
  fichierCles = args[1] ?? arreter("--cles attend un fichier");
  args.splice(0, 2);
}
if (args.length === 0 || args.length % 2 !== 0) {
  arreter("usage : node examples/controle-rotation-cles-2026-10-19.mjs [--cles <document.json>] <corps> <en-têtes> [<corps> <en-têtes> …]");
}
if (!existsSync(TSX)) arreter(`tsx absent (${TSX}) : installer les dépendances du dépôt (npm ci)`);

/** Les trois en-têtes de signature d'un fichier conservé, noms en minuscules. */
function lireEntetes(chemin) {
  const texte = readFileSync(chemin, "utf8");
  let paires;
  if (texte.trimStart().startsWith("{")) {
    paires = Object.entries(JSON.parse(texte)).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]);
  } else {
    paires = texte
      .split("\n")
      .map((l) => l.replace(/\r$/, ""))
      .filter((l) => l.includes(":") && !l.startsWith("HTTP/"))
      .map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]);
  }
  const entetes = Object.fromEntries(paires.map(([k, v]) => [String(k).toLowerCase(), String(v)]));
  return {
    "X-Sirenic-Key-Id": entetes["x-sirenic-key-id"],
    "X-Sirenic-Timestamp": entetes["x-sirenic-timestamp"],
    "X-Sirenic-Signature": entetes["x-sirenic-signature"],
  };
}

const reponses = [];
for (let i = 0; i < args.length; i += 2) {
  const corps = readFileSync(args[i]);
  const entetes = lireEntetes(args[i + 1]);
  if (!entetes["X-Sirenic-Key-Id"] || !entetes["X-Sirenic-Timestamp"] || !entetes["X-Sirenic-Signature"]) {
    arreter(`${args[i + 1]} : en-têtes de signature absents`);
  }
  reponses.push({
    nom: `${basename(dirname(args[i]))}/${basename(args[i])}`,
    corps,
    entetes,
    taille: corps.length,
    sha256: createHash("sha256").update(corps).digest("hex"),
    kid: entetes["X-Sirenic-Key-Id"],
    horodatage: entetes["X-Sirenic-Timestamp"],
  });
}

// --- Le document des clés et ses rotations simulées ----------------------------
const octetsCles = fichierCles
  ? readFileSync(fichierCles)
  : Buffer.from(await (await fetch(`${API}/.well-known/sirenic-signing-key`, { signal: AbortSignal.timeout(30_000) })).arrayBuffer());
const servi = JSON.parse(octetsCles.toString("utf8"));
if (!Array.isArray(servi.keys)) arreter("le document des clés n'a pas de liste keys");
for (const kid of new Set(reponses.map((r) => r.kid))) {
  if (!servi.keys.some((e) => e.kid === kid)) arreter(`kid ${kid} des réponses absent de keys du document servi`);
}
const JOUR = new Date().toISOString().slice(0, 10);
const NEUVE = nouvelleCle();

/**
 * Le document après rotation : chaque entrée encore ouverte se ferme à `fin`, et la clé de test s'ouvre ce jour-là en
 * racine. `forcer` ferme aussi à `fin` les entrées des kids des réponses déjà closes (le témoin négatif).
 */
function rotation(fin, forcer) {
  const kids = new Set(reponses.map((r) => r.kid));
  const keys = servi.keys.map((e) => (e.valid_until === null || (forcer && kids.has(e.kid)) ? { ...e, valid_until: fin } : e));
  keys.push({ kid: NEUVE.kid, public_key: NEUVE.public_key, valid_from: fin, valid_until: null });
  return documentDesCles({ racine: NEUVE, keys });
}
const DOCUMENTS = [
  { nom: `rotation simulée au ${JOUR}`, document: rotation(JOUR, false) },
  { nom: `témoin négatif, entrée fermée au ${JOUR_TEMOIN}`, document: rotation(JOUR_TEMOIN, true) },
];

/** Le verdict attendu d'une réponse sous un document : valide si son jour UTC tombe dans la fenêtre de l'entrée de son kid. */
function attenduSous(reponse, document) {
  const entree = JSON.parse(document).keys.find((e) => e.kid === reponse.kid);
  const jour = reponse.horodatage.slice(0, 10);
  return jour >= entree.valid_from && (entree.valid_until === null || jour <= entree.valid_until) ? "valide" : "fenetre";
}

// --- Les trois copies ------------------------------------------------------------
// L'import du script webhook ne doit rien exécuter : son principal ne tourne que lancé directement.
const fetchReel = globalThis.fetch;
const sortieReelle = process.exit;
globalThis.fetch = () => {
  throw new Error("l'import du script webhook a lancé un appel réseau");
};
process.exit = (code) => {
  throw new Error(`l'import du script webhook a appelé process.exit(${code})`);
};
let verifierLivraison;
try {
  ({ verifierLivraison } = await import("./verifier-livraison-webhook.mjs"));
} finally {
  globalThis.fetch = fetchReel;
  process.exit = sortieReelle;
}

/** Classe une sortie d'exemple : valide, ou le motif du refus. */
function classer(sortie) {
  if (/signature valid/.test(sortie)) return "valide";
  if (/outside the validity window|hors de la fenêtre/.test(sortie)) return "fenetre";
  if (/not published in keys|non publié dans keys/.test(sortie)) return "kid";
  if (/key id mismatch/.test(sortie)) return "kid-racine (key id mismatch)";
  if (/not the root key|racine porte un autre kid/.test(sortie)) return "kid-racine";
  if (/INVALID signature|signature invalide/.test(sortie)) return "signature";
  if (/malformed timestamp|mal formé/.test(sortie)) return "horodatage";
  return "illisible";
}

function lancer(script, faux, dossierArchives) {
  return new Promise((fini) => {
    execFile(
      TSX,
      [script],
      {
        cwd: RACINE,
        timeout: 120_000,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TZ: FUSEAU,
          NO_COLOR: "1",
          TEST_WALLET_KEY: `0x${randomBytes(32).toString("hex")}`, // jamais financée : aucun 402 n'est servi
          SIRENIC_URL: faux.url,
          OUT_DIR: dossierArchives,
        },
      },
      (erreur, stdout, stderr) => fini(erreur?.killed ? "coupé par le délai" : classer(`${stdout}\n${stderr}`)),
    );
  });
}

/** Le verdict des trois copies pour une réponse et un document. */
async function verdicts(reponse, document) {
  const texte = reponse.corps.toString("utf8");
  const webhook = Buffer.from(texte, "utf8").equals(reponse.corps)
    ? (() => {
        const v = verifierLivraison({ headers: reponse.entetes, content: texte }, JSON.parse(document));
        return v.ok ? "valide" : v.motif ? classer(v.motif) : "refus sans motif";
      })()
    : "sans objet";
  const type = reponse.corps.subarray(0, 4).toString("latin1") === "%PDF" ? "application/pdf" : "application/json; charset=utf-8";
  const servie = { corps: reponse.corps, entetes: reponse.entetes, type };
  const faux = await demarrerFauxSirenic({
    document,
    reponses: { "/v1/sanctions/check": servie, "/v1/facturation/dossier": servie },
  });
  const dossierArchives = mkdtempSync(join(tmpdir(), "sirenic-controle-rotation-"));
  try {
    const signature = await lancer("examples/verify-signature.ts", faux, dossierArchives);
    const facture = await lancer("examples/verify-invoice-file.ts", faux, dossierArchives);
    const paiement = faux.requetes.some((r) => r.entetes["x-payment"] !== undefined || r.entetes["payment-signature"] !== undefined);
    return { webhook, signature, facture, paiement };
  } finally {
    await faux.fermer();
    rmSync(dossierArchives, { recursive: true, force: true });
  }
}

// --- Le contrôle ------------------------------------------------------------------
console.log(`document des clés : ${fichierCles ?? `${API}/.well-known/sirenic-signing-key`}, sha256 ${createHash("sha256").update(octetsCles).digest("hex")}`);
console.log(`  kids servis : ${servi.keys.map((e) => `${e.kid} (${e.valid_from} au ${e.valid_until ?? "ouverte"})`).join(", ")}`);
console.log(`  clé de test de la rotation : ${NEUVE.kid}, ouverte au jour de la bascule`);
console.log(`réponses : ${reponses.length}\n`);

let ecarts = 0;
for (const { nom, document } of DOCUMENTS) {
  console.log(`== ${nom}`);
  console.log("   réponse | octets | sha256 | kid | horodatage | attendu | webhook | verify-signature | verify-invoice-file");
  const lignes = new Array(reponses.length);
  let suivante = 0;
  await Promise.all(
    Array.from({ length: SIMULTANES }, async () => {
      while (suivante < reponses.length) {
        const i = suivante++;
        const r = reponses[i];
        const attendu = attenduSous(r, document);
        const v = await verdicts(r, document);
        const juste = (x, accepteSansObjet) => x === attendu || (accepteSansObjet && x === "sans objet");
        const ok = juste(v.webhook, true) && juste(v.signature, false) && juste(v.facture, false) && !v.paiement;
        if (!ok) ecarts += 1;
        lignes[i] =
          `${ok ? "ok  " : "ÉCART"} ${r.nom} | ${r.taille} | ${r.sha256} | ${r.kid} | ${r.horodatage} | ${attendu} | ` +
          `${v.webhook} | ${v.signature} | ${v.facture}${v.paiement ? " | EN-TÊTE DE PAIEMENT ENVOYÉ" : ""}`;
      }
    }),
  );
  for (const l of lignes) console.log(`   ${l}`);
  console.log("");
}

console.log(
  ecarts === 0
    ? `✔ ${reponses.length} réponse(s) : chaque verdict attendu est tombé, rotation et témoin`
    : `✘ ${ecarts} ligne(s) en écart : voir les lignes ÉCART`,
);
process.exit(ecarts === 0 ? 0 : 1);
