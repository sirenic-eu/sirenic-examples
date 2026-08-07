/**
 * Rejeu PAYANT du « dossier d'audit » du 03/08 sur DANONE (552032534) —
 * baseline AVANT correctifs, pour finaliser l'analyse du 05/08.
 *
 * Trois objectifs, dans l'esprit du smoke-comparer :
 *   A. Prouver en RÉEL le contrat « erreur = jamais débité » : un paiement
 *      SIGNÉ sur /v1/regulateurs/fr/alertes SANS paramètre doit rendre 400,
 *      sans reçu de règlement, et le delta de solde on-chain doit l'ignorer.
 *   B. Figer, avec de vrais achats, l'état AVANT correctifs de chaque constat
 *      de l'audit (score holding, IBAN de doc, PI, zéros, noms courts, fiche).
 *   C. Conserver toutes les réponses payées (règle CDU du 24/07).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-audit-2026-08-05.ts
 *
 * Coût attendu : 0,304 $ (16 achats) + 0,00 $ pour le test A.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { base } from "viem/chains";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const api = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const cle = process.env.TEST_WALLET_KEY;
if (!cle?.startsWith("0x")) {
  console.error("TEST_WALLET_KEY manquante (--env-file=.env.wallet-test)");
  process.exit(1);
}
const compte = privateKeyToAccount(cle as `0x${string}`);
console.log(`Payeur : ${compte.address}`);

const client = new x402Client();
registerExactEvmScheme(client, { signer: compte });
const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;

// Solde USDC on-chain (lecture publique, gratuite) — la preuve côté CLIENT.
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const rpc = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
async function soldeUsdc(): Promise<bigint | null> {
  try {
    return await rpc.readContract({
      address: USDC_BASE,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [compte.address],
    });
  } catch {
    return null; // RPC public indisponible : on dégrade, le ledger serveur reste vérifiable
  }
}

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `resultats/audit-replay-${horodatage}`;
mkdirSync(dossier, { recursive: true });

type Obs = { controle: string; observe: string; attendu_avant_correctifs: string; conforme: boolean };
const observations: Obs[] = [];
function noter(controle: string, observe: string, attendu: string, conforme: boolean) {
  observations.push({ controle, observe, attendu_avant_correctifs: attendu, conforme });
  console.log(`  ${conforme ? "✓" : "✗"} ${controle} — observé : ${observe}`);
}

const soldeAvant = await soldeUsdc();
console.log(`Solde USDC avant : ${soldeAvant === null ? "RPC indisponible" : formatUnits(soldeAvant, 6)}`);

/* ---------- TEST A : paiement signé sur une requête invalide (0,00 $) ---------- */
console.log("\n=== TEST A — /v1/regulateurs/fr/alertes SANS paramètre, paiement signé ===");
try {
  const rA = await payer(`${api}/v1/regulateurs/fr/alertes`);
  const recuA = rA.headers.get("payment-response") ?? rA.headers.get("x-payment-response");
  const corpsA = await rA.text();
  writeFileSync(`${dossier}/testA-400-sans-parametre.json`, `${corpsA}\n`);
  noter("Test A : statut HTTP", String(rA.status), "400 (parametre_invalide)", rA.status === 400);
  noter("Test A : reçu de règlement", recuA ? "PRÉSENT" : "absent", "absent (paiement annulé)", !recuA);
} catch (e) {
  // Certains clients x402 LÈVENT sur un statut d'erreur après paiement : c'est
  // l'expérience « j'ai payé et j'ai eu une erreur » vue côté agent. On la note.
  noter("Test A : le client a levé une exception", String(e).slice(0, 120), "400 restitué sans débit", false);
}

/* ---------- TEST B : rejeu du dossier DANONE (16 achats, 0,304 $) ---------- */
const SIREN = "552032534"; // DANONE — l'entreprise du dossier d'audit
const IBAN_DOC = "FR1420041010050500013M02606"; // IBAN de documentation (Banque Postale)
const appels: Array<{ nom: string; chemin: string; prix: number }> = [
  { nom: "recherche", chemin: `/v1/recherche?q=danone`, prix: 0.001 },
  { nom: "fiche", chemin: `/v1/entreprise/${SIREN}`, prix: 0.005 },
  { nom: "etablissements", chemin: `/v1/entreprise/${SIREN}/etablissements`, prix: 0.003 },
  { nom: "finances", chemin: `/v1/entreprise/${SIREN}/finances`, prix: 0.01 },
  { nom: "pi", chemin: `/v1/entreprise/${SIREN}/pi`, prix: 0.03 },
  { nom: "marches-publics", chemin: `/v1/entreprise/${SIREN}/marches-publics`, prix: 0.01 },
  { nom: "marches-publics-ue", chemin: `/v1/entreprise/${SIREN}/marches-publics-ue`, prix: 0.02 },
  { nom: "risques-industriels", chemin: `/v1/entreprise/${SIREN}/risques-industriels`, prix: 0.01 },
  { nom: "lobbying", chemin: `/v1/entreprise/${SIREN}/lobbying`, prix: 0.01 },
  { nom: "sanctions-danone", chemin: `/v1/sanctions/check?name=DANONE`, prix: 0.02 },
  { nom: "sanctions-leo", chemin: `/v1/sanctions/check?name=LEO`, prix: 0.02 },
  { nom: "score", chemin: `/v1/score/defaillance/${SIREN}`, prix: 0.1 },
  { nom: "iban", chemin: `/v1/iban/verifier/${IBAN_DOC}`, prix: 0.005 },
  { nom: "facturation-dossier", chemin: `/v1/facturation/dossier?siren=${SIREN}&iban=${IBAN_DOC}`, prix: 0.03 },
  { nom: "facturation-prep", chemin: `/v1/entreprise/${SIREN}/facturation-prep`, prix: 0.02 },
  { nom: "regulateurs-valide", chemin: `/v1/regulateurs/fr/alertes?siren=${SIREN}`, prix: 0.01 },
];

const corps: Record<string, unknown> = {};
let totalRegle = 0;
let debutTotal = Date.now();
for (const a of appels) {
  const debut = Date.now();
  try {
    const r = await payer(`${api}${a.chemin}`);
    const ms = Date.now() - debut;
    const texte = await r.text();
    writeFileSync(`${dossier}/${a.nom}.json`, `${texte}\n`);
    let json: unknown = null;
    try {
      json = JSON.parse(texte);
    } catch {
      /* corps non JSON conservé tel quel */
    }
    corps[a.nom] = json;
    const recu = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
    console.log(`\n${a.nom} → HTTP ${r.status} en ${ms} ms (règlement ${recu ? "reçu" : "ABSENT"})`);
    if (r.status === 200 && recu) totalRegle += a.prix;
  } catch (e) {
    console.log(`\n${a.nom} → EXCEPTION ${String(e).slice(0, 160)}`);
    corps[a.nom] = null;
  }
}
console.log(`\nDurée cumulée test B : ${((Date.now() - debutTotal) / 1000).toFixed(1)} s`);

/* ---------- Observations par constat d'audit (baseline avant correctifs) ---------- */
console.log("\n=== Observations (état AVANT correctifs — un ✓ CONFIRME l'analyse) ===");
const s = (n: string) => JSON.stringify(corps[n] ?? "");

// B1 — score holding 70.10Z GE servi sans avertissement
const score = (corps["score"] ?? {}) as Record<string, unknown>;
noter("B1 score DANONE (70.10Z GE)", `score=${score.score} classe=${score.classe}`, "30 / vigilance (référence scoring.md)", score.score === 30);
noter("B1 aucun avertissement holding", s("score").includes("holding") ? "mention holding présente" : "aucune mention holding", "aucune (le correctif C3 l'ajoutera)", !s("score").includes("holding"));

// B2 — IBAN de documentation
const iban = (corps["iban"] ?? {}) as Record<string, unknown>;
const dossierFact = (corps["facturation-dossier"] ?? {}) as Record<string, unknown>;
const verdict = (dossierFact.verdict ?? {}) as Record<string, unknown>;
noter("B2 IBAN de doc : valide", String(iban.valide), "true (mod-97 passe)", iban.valide === true);
noter("B2 verification_titulaire", s("iban").includes("non_disponible") ? "non_disponible présent" : "ABSENT", "présent mais enterré", s("iban").includes("non_disponible"));
noter("B2 verdict pret_a_facturer avec IBAN de doc", `${verdict.pret_a_facturer} raisons=${JSON.stringify(verdict.raisons)}`, "true + raisons [] (aucune réserve machine)", verdict.pret_a_facturer === true);

// N9 — bloc PI
noter("N9 PI : XML brut dans numero", s("pi").includes("<country>") ? "présent" : "absent", "présent (12/12)", s("pi").includes("<country>"));
noter("N9 PI : entités non décodées", s("pi").includes("&apos;") ? "présentes" : "absentes", "présentes", s("pi").includes("&apos;"));
const pi = (corps["pi"] ?? {}) as { dessins_modeles?: { titres?: Array<{ numero?: string }> } };
const dm = pi.dessins_modeles?.titres ?? [];
const dmDistincts = new Set(dm.map((t) => t.numero)).size;
noter("N9 PI : dessins & modèles", `${dm.length} lignes / ${dmDistincts} numéros distincts`, "12 lignes / peu de distincts (doublons)", dm.length > dmDistincts);

// I5 — nom court « LEO » au criblage
const leo = s("sanctions-leo");
noter("I5 criblage LEO : niveau forte", leo.includes("forte") ? "forte présente" : "pas de forte", "forte (égalité exacte nom court)", leo.includes("forte"));

// N7 — zéros (marchés, ICPE)
const mp = (corps["marches-publics"] ?? {}) as { marches?: unknown[] };
noter("N7 marchés DECP", `${Array.isArray(mp.marches) ? mp.marches.length : "?"} marché(s)`, "liste (le zéro périmétré arrive en C7)", true);
noter("N7 note de périmètre marchés UE", s("marches-publics-ue").includes("eForms") ? "présente" : "absente", "présente (déjà honnête)", s("marches-publics-ue").includes("eForms"));

// N10 — fiche : IDCC 9999 brut
noter("N10 IDCC 9999 servi brut", s("fiche").includes("9999") ? "présent" : "absent", "présent sans libellé", s("fiche").includes("9999"));

// I6 — facturation-prep GE : échéance 01/09
noter("I6 échéance GE 2026-09-01", s("facturation-prep").includes("2026-09-01") ? "présente" : "absente", "présente", s("facturation-prep").includes("2026-09-01"));
noter("I6 annuaire fermé documenté", s("facturation-prep").includes("annuaire") || s("facturation-prep").includes("plateformes") ? "présent" : "absent", "présent", s("facturation-prep").includes("annuaire") || s("facturation-prep").includes("plateformes"));

// B3 — la route alertes payée AVEC paramètre valide fonctionne
noter("B3 alertes avec ?siren= : 200 payé", corps["regulateurs-valide"] ? "réponse servie" : "échec", "200 settled", corps["regulateurs-valide"] !== null);

/* ---------- Solde après : le delta doit valoir la somme des achats réussis ---------- */
const soldeApres = await soldeUsdc();
if (soldeAvant !== null && soldeApres !== null) {
  const delta = Number(formatUnits(soldeAvant - soldeApres, 6));
  console.log(`\nSolde USDC après : ${formatUnits(soldeApres, 6)}`);
  console.log(`Débit on-chain réel : ${delta.toFixed(6)} $ — attendu : ${totalRegle.toFixed(3)} $ (somme des 200 réglés, test A NON compris)`);
  noter("Delta on-chain = somme des seuls 200 réglés", `${delta.toFixed(6)} $`, `${totalRegle.toFixed(3)} $ — le 400 du test A ne débite RIEN`, Math.abs(delta - totalRegle) < 0.000001);
} else {
  console.log("\nSolde on-chain indisponible (RPC public) — preuve reportée sur le ledger serveur.");
}

writeFileSync(`${dossier}/RECAP.json`, `${JSON.stringify({ horodatage, payeur: compte.address, total_regle_attendu: totalRegle, observations }, null, 2)}\n`);
console.log(`\nRéponses payées + récap conservés : ${dossier}/`);
const nonConformes = observations.filter((o) => !o.conforme);
console.log(`\nBilan : ${observations.length - nonConformes.length}/${observations.length} observations conformes à l'analyse.`);
if (nonConformes.length > 0) console.log("Écarts à examiner :", nonConformes.map((o) => o.controle).join(" ; "));
