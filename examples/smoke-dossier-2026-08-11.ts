/**
 * Smoke PAYANT de la fiche à la carte `/v1/entreprise/{siren}/dossier`
 * (brique 3 « adaptations Pappers », livrée le 11/08/2026).
 *
 * Un devis 402 qui s'affiche ne prouve PAS qu'une route est achetable : seul un
 * achat réel le prouve. Trois achats ici, choisis parce qu'ils éprouvent trois
 * choses qu'aucune vérification gratuite ne voit :
 *
 *   1. **DANONE, 3 blocs** (finances, pi, score) — 0,145 $ : le cas nominal.
 *      Vérifie que le montant DÉBITÉ est bien socle + blocs, et que les blocs
 *      servis correspondent aux blocs demandés.
 *   2. **AIRVANCE GROUP, 4 blocs** — 0,155 $ : le cas CONNU DE CDU (sa holding).
 *      Une holding sans brevet et sans marché public est exactement le cas où
 *      la fiche pourrait paraître VIDE alors qu'elle est honnête : on vérifie
 *      que les absences sortent qualifiées `aucune_donnee`, pas `panne_amont`.
 *   3. **DANONE, 1 bloc** (etablissements) — 0,008 $ : le plus petit achat
 *      possible, qui prouve que le devis suit vraiment la demande.
 *
 * Total ≈ 0,308 $.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-dossier-2026-08-11.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const api = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const cle = process.env.TEST_WALLET_KEY;
if (!cle?.startsWith("0x")) {
  console.error("TEST_WALLET_KEY manquante (--env-file=.env.wallet-test)");
  process.exit(1);
}
const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(cle as `0x${string}`) });
const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-dossier-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const echecs: string[] = [];
const verifier = (ok: boolean, quoi: string): void => {
  console.log(`${ok ? "  ok  " : " ÉCHEC"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};

interface Corps {
  siren?: string;
  identite?: Record<string, unknown>;
  blocs_demandes?: string[];
  blocs?: Record<string, unknown>;
  blocs_absents?: Array<{ bloc: string; raison: string; message: string }>;
  resume?: { demandes: number; servis: number; absents: number; dont_panne_amont: number };
}

/** Le devis annoncé AVANT paiement, lu dans l'en-tête PAYMENT-REQUIRED. */
async function devisAnnonce(url: string): Promise<number | null> {
  const r = await fetch(url);
  const entete = r.headers.get("payment-required");
  if (!entete) return null;
  const d = JSON.parse(Buffer.from(entete, "base64").toString());
  return Number(d.accepts?.[0]?.amount ?? NaN);
}

async function acheter(nom: string, siren: string, blocs: string): Promise<Corps | null> {
  const url = `${api}/v1/entreprise/${siren}/dossier?blocs=${encodeURIComponent(blocs)}`;
  const attendu = await devisAnnonce(url);
  const r = await payer(url);
  const brut = await r.text();
  writeFileSync(`${dossier}/${nom}.json`, `HTTP ${r.status}\ndevis annoncé: ${attendu}\n${brut}\n`);
  console.log(`\n${nom} → HTTP ${r.status} (devis annoncé ${attendu} unités atomiques)`);
  verifier(r.status === 200, `${nom} : achat réel servi en 200`);
  if (r.status !== 200) return null;
  // Le montant réellement débité est annoncé par le facilitateur dans la
  // réponse de règlement : on vérifie qu'il ÉGALE le devis (schéma `exact`).
  const regle = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  writeFileSync(`${dossier}/${nom}-reglement.txt`, String(regle ?? "(aucun en-tête de règlement)"));
  return JSON.parse(brut) as Corps;
}

// --- 1. DANONE, 3 blocs ---------------------------------------------------
const d1 = await acheter("danone-3-blocs", "552032534", "finances,pi,score");
if (d1) {
  verifier(d1.blocs_demandes?.length === 3, "3 blocs demandés reconnus");
  verifier(
    (d1.resume?.servis ?? 0) + (d1.resume?.absents ?? 0) === 3,
    "chaque bloc demandé est soit servi, soit NOMMÉ absent (aucun ne disparaît)",
  );
  verifier(d1.identite !== undefined, "le socle identité est servi");
  verifier(
    (d1.resume?.dont_panne_amont ?? 0) === 0,
    "aucune panne amont sur ce cas nominal (sinon le prix serait discutable)",
  );
  console.log(`      servis : ${Object.keys(d1.blocs ?? {}).join(", ") || "(aucun)"}`);
  for (const a of d1.blocs_absents ?? []) console.log(`      absent : ${a.bloc} → ${a.raison}`);
}

// --- 2. AIRVANCE GROUP, le cas connu de CDU -------------------------------
const d2 = await acheter("airvance-4-blocs", "490586708", "finances,pi,marches_publics,score");
if (d2) {
  verifier(d2.blocs_demandes?.length === 4, "4 blocs demandés reconnus");
  // Une holding sans brevet : l'absence doit être une RÉPONSE, pas une panne.
  const pi = (d2.blocs_absents ?? []).find((a) => a.bloc === "pi");
  verifier(
    pi === undefined || pi.raison === "aucune_donnee",
    "un bloc vide sur une holding est qualifié `aucune_donnee`, jamais `panne_amont`",
  );
  verifier(
    (d2.blocs_absents ?? []).every((a) => a.message.length > 20),
    "chaque absence porte une phrase d'explication lisible",
  );
  console.log(`      servis : ${Object.keys(d2.blocs ?? {}).join(", ") || "(aucun)"}`);
  for (const a of d2.blocs_absents ?? []) console.log(`      absent : ${a.bloc} → ${a.raison}`);
}

// --- 3. Le plus petit achat possible --------------------------------------
const d3 = await acheter("danone-1-bloc", "552032534", "etablissements");
if (d3) {
  verifier(d3.blocs_demandes?.length === 1, "un seul bloc demandé, un seul facturé");
}

// --- 3 bis. Un bloc SANS donnée : que reçoit-on vraiment ? ----------------
// MESURÉ le 11/08, et le résultat corrige une hypothèse : je m'attendais à voir
// la qualification `aucune_donnee` se déclencher sur une holding non inscrite au
// répertoire des représentants d'intérêts (~4 000 organisations seulement). Elle
// ne se déclenche PAS — et c'est mieux. Le service rend une réponse NÉGATIVE
// EXPLICITE (`inscrit: false`) avec sa source et sa fraîcheur : le client
// apprend « cette société n'est pas lobbyiste », ce qui est l'information
// achetée, et non « bloc absent ».
//
// Conséquence à retenir : `aucune_donnee` est un FILET (pour un service qui
// rendrait null ou une liste vide), pas le chemin normal. Les trois raisons de
// l'enum restent couvertes par les tests unitaires du dépôt.
const d4 = await acheter("airvance-bloc-sans-donnee", "490586708", "lobbying");
if (d4) {
  const lobbying = (d4.blocs ?? {}).lobbying as { inscrit?: boolean; source?: string } | undefined;
  verifier(lobbying !== undefined, "un bloc sans donnée est SERVI, pas déclaré absent");
  verifier(
    lobbying?.inscrit === false,
    "la réponse négative est explicite (`inscrit: false`), pas un vide ambigu",
  );
  verifier(
    typeof lobbying?.source === "string" && lobbying.source.length > 10,
    "même négative, la réponse porte sa source (attribution HATVP)",
  );
  verifier(
    (d4.resume?.dont_panne_amont ?? 1) === 0,
    "aucune panne amont : la facturation pleine est légitime",
  );
}

// --- 4. Ce qui ne doit PAS marcher ---------------------------------------
// Payer un bloc inconnu : 400 et, surtout, aucun débit (le middleware annule).
const rInconnu = await payer(`${api}/v1/entreprise/552032534/dossier?blocs=finances,bidon`);
const corpsInconnu = await rInconnu.text();
writeFileSync(`${dossier}/bloc-inconnu.json`, `HTTP ${rInconnu.status}\n${corpsInconnu}\n`);
verifier(rInconnu.status === 400, "un bloc inconnu rend 400 (paiement annulé)");
verifier(corpsInconnu.includes("bloc_inconnu"), "l'erreur nomme le bloc fautif");

writeFileSync(
  `${dossier}/recap.txt`,
  [
    `Smoke PAYANT /v1/entreprise/{siren}/dossier — ${new Date().toISOString()}`,
    `API : ${api}`,
    `Achats : DANONE 3 blocs (0,145 $), AIRVANCE GROUP 4 blocs (0,155 $), DANONE 1 bloc (0,008 $)`,
    `Contrôles en échec : ${echecs.length}`,
    ...echecs.map((e) => `ÉCHEC : ${e}`),
  ].join("\n"),
);

console.log(`\nRésultats conservés dans ${dossier}`);
if (echecs.length > 0) {
  console.error(`${echecs.length} contrôle(s) en échec`);
  process.exit(1);
}
console.log("Smoke payant vert.");
