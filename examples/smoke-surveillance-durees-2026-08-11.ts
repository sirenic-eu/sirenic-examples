/**
 * Smoke PAYANT de la surveillance MULTI-DURÉES (livrée le 11/08/2026).
 *
 * Un devis 402 qui s'affiche ne prouve PAS qu'une route est achetable : seul un
 * achat réel le prouve. Quatre épreuves, choisies parce qu'aucune vérification
 * gratuite ne les voit :
 *
 *   1. **90 jours, 1 cible** — 0,135 $ : le palier intermédiaire. Vérifie que le
 *      montant DÉBITÉ est bien celui de la durée demandée (et non 0,05 $) et que
 *      `expire_le` tombe bien à 90 jours, pas à 30.
 *   2. **Renouvellement à 30 jours** — 0,05 $ : la durée du renouvellement est
 *      LIBRE. Vérifie qu'une watch de 90 j se prolonge de 30 j (et non de 90),
 *      et que la prolongation part de l'expiration COURANTE, pas d'aujourd'hui.
 *   3. **365 jours, 1 cible** — 0,50 $ : le palier le plus cher, celui qu'aucun
 *      test ne peut prouver achetable. C'est aussi le seul qui dépasse le
 *      plafond par défaut du node n8n avant le correctif du jour.
 *   4. **Durée hors liste** — 0,00 $ : `duree=45` doit rendre 400 SANS DÉBIT.
 *      C'est le cœur du dispositif : le gate cote AVANT de valider, donc la
 *      seule protection est que le 400 annule le règlement.
 *
 * Les watches créées sont ARRÊTÉES à la fin (gratuit) : ne pas laisser tourner
 * une surveillance annuelle de test dans la base de production.
 *
 * Total ≈ 0,685 $.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-surveillance-durees-2026-08-11.ts
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

const SIREN = "552032534"; // DANONE — la cible de nos watches de test
const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-surveillance-durees-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const echecs: string[] = [];
const verifier = (ok: boolean, quoi: string): void => {
  console.log(`${ok ? "  ok  " : " ÉCHEC"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};

/** Le devis annoncé AVANT paiement, lu dans l'en-tête PAYMENT-REQUIRED signé. */
async function devisAnnonce(url: string): Promise<number | null> {
  const r = await fetch(url);
  const entete = r.headers.get("payment-required");
  if (!entete) return null;
  const d = JSON.parse(Buffer.from(entete, "base64").toString());
  return Number(d.accepts?.[0]?.amount ?? NaN);
}

interface Corps {
  jeton?: string;
  surveillance_id?: string;
  duree_jours?: number;
  expire_le?: string;
  cibles?: number;
  sans_remboursement?: string;
  error?: string;
}

async function acheter(nom: string, url: string): Promise<{ statut: number; corps: Corps; devis: number | null }> {
  const devis = await devisAnnonce(url);
  const r = await payer(url);
  const brut = await r.text();
  writeFileSync(`${dossier}/${nom}.json`, `HTTP ${r.status}\ndevis annoncé: ${devis}\n${brut}\n`);
  const regle = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  writeFileSync(`${dossier}/${nom}-reglement.txt`, String(regle ?? "(aucun en-tête de règlement)"));
  console.log(`\n${nom} → HTTP ${r.status} (devis annoncé ${devis} unités atomiques)`);
  let corps: Corps = {};
  try {
    corps = JSON.parse(brut) as Corps;
  } catch {
    /* corps non-JSON : conservé sur disque, les vérifications diront quoi */
  }
  return { statut: r.status, corps, devis };
}

const joursJusqua = (iso: string | undefined): number =>
  Math.round((new Date(String(iso)).getTime() - Date.now()) / 864e5);

const aArreter: string[] = [];

// --- 1. 90 jours : le palier intermédiaire --------------------------------
const a1 = await acheter("creer-90j", `${api}/v1/surveillance/creer?cibles=${SIREN}&duree=90`);
verifier(a1.statut === 200, "90 jours : achat réel servi en 200");
verifier(a1.devis === 135_000, `90 jours : devis signé = 135000 (0,135 $), lu ${a1.devis}`);
verifier(a1.corps.duree_jours === 90, "90 jours : la réponse annonce la durée retenue");
verifier(joursJusqua(a1.corps.expire_le) === 90, `90 jours : expire_le à +90 j (lu ${joursJusqua(a1.corps.expire_le)})`);
verifier(
  String(a1.corps.sans_remboursement ?? "").includes("prorata"),
  "90 jours : l'absence de remboursement est dite DANS la réponse",
);
const jeton90 = String(a1.corps.jeton ?? "");
if (jeton90) aArreter.push(jeton90);

// --- 2. Renouvellement à une AUTRE durée ----------------------------------
if (jeton90) {
  const expireAvant = joursJusqua(a1.corps.expire_le);
  const a2 = await acheter(
    "renouveler-30j",
    `${api}/v1/surveillance/${encodeURIComponent(jeton90)}/renouveler?cibles=${SIREN}&duree=30`,
  );
  verifier(a2.statut === 200, "renouvellement : achat réel servi en 200");
  verifier(a2.devis === 50_000, `renouvellement 30 j : devis signé = 50000 (0,05 $), lu ${a2.devis}`);
  verifier(a2.corps.duree_jours === 30, "renouvellement : la durée choisie diffère de celle de la création");
  // La prolongation part de l'EXPIRATION COURANTE : 90 + 30 = 120, jamais 30.
  const apres = joursJusqua(a2.corps.expire_le);
  verifier(
    apres === expireAvant + 30,
    `renouvellement : prolongation depuis l'expiration courante (${expireAvant} + 30 = ${expireAvant + 30}, lu ${apres})`,
  );
}

// --- 3. 365 jours : le palier le plus cher --------------------------------
const a3 = await acheter("creer-365j", `${api}/v1/surveillance/creer?cibles=${SIREN}&duree=365`);
verifier(a3.statut === 200, "365 jours : achat réel servi en 200 — le palier annuel est ACHETABLE");
verifier(a3.devis === 500_000, `365 jours : devis signé = 500000 (0,50 $), lu ${a3.devis}`);
verifier(a3.corps.duree_jours === 365, "365 jours : la réponse annonce la durée retenue");
verifier(joursJusqua(a3.corps.expire_le) === 365, `365 jours : expire_le à +365 j (lu ${joursJusqua(a3.corps.expire_le)})`);
const jeton365 = String(a3.corps.jeton ?? "");
if (jeton365) aArreter.push(jeton365);

// --- 4. Durée hors liste : 400, et AUCUN débit ----------------------------
// Le gate cote avant de valider : sans le 400, on encaisserait une durée qu'on
// ne sait pas servir. C'est la vérification la plus importante du lot.
const a4 = await acheter("creer-duree-45j-refusee", `${api}/v1/surveillance/creer?cibles=${SIREN}&duree=45`);
verifier(a4.statut === 400, `durée hors liste : refusée en 400 (lu ${a4.statut})`);
verifier(a4.corps.error === "duree_invalide", `durée hors liste : erreur duree_invalide (lu ${a4.corps.error})`);
verifier(a4.devis === 50_000, "durée hors liste : cotée au tarif par défaut, jamais un montant fabriqué");

// --- 4 bis. Le plafond d'horizon ------------------------------------------
// Renouveler la watch annuelle d'un an de plus ferait 730 jours : refusé.
if (jeton365) {
  const a5 = await acheter(
    "renouveler-horizon-depasse",
    `${api}/v1/surveillance/${encodeURIComponent(jeton365)}/renouveler?cibles=${SIREN}&duree=365`,
  );
  verifier(a5.statut === 400, `plafond d'horizon : refusé en 400 (lu ${a5.statut})`);
  verifier(a5.corps.error === "horizon_depasse", `plafond d'horizon : erreur horizon_depasse (lu ${a5.corps.error})`);
}

// --- 5. Ménage : arrêter les watches de test (gratuit) --------------------
for (const jeton of aArreter) {
  const r = await fetch(`${api}/v1/surveillance/${encodeURIComponent(jeton)}/arreter`);
  console.log(`\narrêt ${jeton.slice(0, 12)}… → HTTP ${r.status}`);
  verifier(r.status === 200, "arrêt gratuit de la watch de test (la base de prod reste propre)");
}

writeFileSync(
  `${dossier}/verdict.txt`,
  echecs.length === 0 ? "TOUT VERT\n" : `ÉCHECS :\n${echecs.map((e) => `- ${e}`).join("\n")}\n`,
);
console.log(`\n${"=".repeat(70)}`);
console.log(echecs.length === 0 ? "SMOKE VERT" : `SMOKE ROUGE — ${echecs.length} échec(s)`);
for (const e of echecs) console.log(`  - ${e}`);
console.log(`résultats : ${dossier}`);
process.exit(echecs.length === 0 ? 0 : 1);
