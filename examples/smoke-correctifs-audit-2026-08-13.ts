/**
 * Smoke PAYANT des correctifs de l'audit complet du 13/08/2026 (R1-R4).
 *
 * Les 4 rouges de l'audit avaient tous été REPRODUITS À L'ACHAT : la seule
 * preuve de leur correction est donc l'achat des mêmes réponses. Quatre
 * épreuves, sur les SIREN mêmes de l'audit :
 *
 *   1. **R1 — 429941453 (liquidation OUVERTE 2021, jamais clôturée)** — 0,10 $ :
 *      l'audit achetait « vigilance / modéré / 35 » avec
 *      `liquidation_judiciaire: false`. Attendu v1.7 : `defaut_avere` / 100,
 *      `signaux_bodacc.liquidation_judiciaire: true`.
 *   2. **R2 — 533662409 (clôture pour insuffisance d'actif 2025-04-22)** —
 *      0,10 $ : l'audit achetait « sain / faible / 0 ». Attendu :
 *      `defaut_avere` / 100, `cloture_insuffisance_actif: true`.
 *   3. **R4 — 429941453 /alertes** — 0,03 $ : l'audit y lisait le texte libre
 *      du jugement nommant le liquidateur avec son adresse. Attendu : plus
 *      aucun champ `complement` dans la réponse.
 *   4. **R3 — 552059024 (THALES) /intelligence** — 1,00 $ : l'audit achetait
 *      `verdict_global: "fragile"` via l'alias « Abu Thale ». Attendu : verdict
 *      NON fragile, signal `correspondance_sanctions_quasi_homonyme` présent,
 *      et le bloc criblage_sanctions toujours complet (option B).
 *
 * Total ≈ 1,23 $ (wallet de test 0x9218fd5A…, exclu du revenu).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-correctifs-audit-2026-08-13.ts
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
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-correctifs-audit-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const echecs: string[] = [];
const verifier = (ok: boolean, quoi: string): void => {
  console.log(`${ok ? "  ok  " : " ÉCHEC"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};

async function acheter(nom: string, url: string): Promise<{ statut: number; brut: string; corps: Record<string, unknown> }> {
  const r = await payer(url);
  const brut = await r.text();
  writeFileSync(`${dossier}/${nom}.json`, `HTTP ${r.status}\n${brut}\n`);
  const regle = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  writeFileSync(`${dossier}/${nom}-reglement.txt`, String(regle ?? "(aucun en-tête de règlement)"));
  let corps: Record<string, unknown> = {};
  try {
    corps = JSON.parse(brut) as Record<string, unknown>;
  } catch {
    /* corps non JSON : les assertions sur `corps` échoueront d'elles-mêmes */
  }
  console.log(`\n— ${nom} → HTTP ${r.status}`);
  return { statut: r.status, brut, corps };
}

// --- 1. R1 : liquidation ouverte 2021 sans clôture -------------------------
const r1 = await acheter("r1-score-liq-ouverte-429941453", `${api}/v1/score/defaillance/429941453`);
verifier(r1.statut === 200, `R1 : réponse 200 (lu ${r1.statut})`);
verifier(r1.corps.classe === "defaut_avere", `R1 : classe defaut_avere (lu ${String(r1.corps.classe)})`);
verifier(r1.corps.score_risque === 100, `R1 : score 100 (lu ${String(r1.corps.score_risque)})`);
const signauxR1 = (r1.corps.signaux_bodacc ?? {}) as Record<string, unknown>;
verifier(signauxR1.liquidation_judiciaire === true, "R1 : signaux_bodacc.liquidation_judiciaire est enfin VRAI");
verifier(String(r1.corps.version_modele) === "defaillance-v1.7", `R1 : version_modele v1.7 (lu ${String(r1.corps.version_modele)})`);

// --- 2. R2 : clôture pour insuffisance d'actif -----------------------------
const r2 = await acheter("r2-score-cloture-insuff-533662409", `${api}/v1/score/defaillance/533662409`);
verifier(r2.statut === 200, `R2 : réponse 200 (lu ${r2.statut})`);
verifier(r2.corps.classe === "defaut_avere", `R2 : classe defaut_avere, plus jamais « sain » (lu ${String(r2.corps.classe)})`);
verifier(r2.corps.score_risque === 100, `R2 : score 100 (lu ${String(r2.corps.score_risque)})`);
const signauxR2 = (r2.corps.signaux_bodacc ?? {}) as Record<string, unknown>;
verifier(signauxR2.cloture_insuffisance_actif === true, "R2 : signaux_bodacc.cloture_insuffisance_actif est VRAI");

// --- 3. R4 : plus de texte libre du jugement -------------------------------
const r4 = await acheter("r4-alertes-429941453", `${api}/v1/entreprise/429941453/alertes`);
verifier(r4.statut === 200, `R4 : réponse 200 (lu ${r4.statut})`);
verifier(!r4.brut.includes("complement"), "R4 : aucun champ complement dans /alertes");
verifier(!r4.brut.toLowerCase().includes("liquidateur"), "R4 : aucun texte libre nommant le liquidateur");
verifier(r4.brut.includes("liquidation"), "R4 : la nature STRUCTURÉE du jugement reste servie");

// --- 4. R3 : THALES n'est plus « fragile » ---------------------------------
const r3 = await acheter("r3-intelligence-thales-552059024", `${api}/v1/intelligence/552059024`);
verifier(r3.statut === 200, `R3 : réponse 200 (lu ${r3.statut})`);
const synthese = (r3.corps.synthese ?? {}) as Record<string, unknown>;
verifier(synthese.verdict_global !== "fragile", `R3 : verdict non fragile (lu ${String(synthese.verdict_global)})`);
verifier(r3.brut.includes("correspondance_sanctions_quasi_homonyme"), "R3 : le doute reste VISIBLE (signal quasi_homonyme)");
verifier(!r3.brut.includes("correspondance_sanctions_entreprise"), "R3 : plus de signal accablant fabriqué");
verifier(r3.brut.includes("criblage_sanctions"), "R3 : le bloc criblage reste servi (option B)");
verifier(r3.brut.includes("score_defaillance_sain"), "R3 : le point fort score sain est toujours là");

writeFileSync(
  `${dossier}/verdict.txt`,
  echecs.length === 0 ? "TOUT VERT\n" : `ÉCHECS :\n${echecs.map((e) => `- ${e}`).join("\n")}\n`,
);
console.log(`\n${"=".repeat(70)}`);
console.log(echecs.length === 0 ? "SMOKE VERT" : `SMOKE ROUGE — ${echecs.length} échec(s)`);
for (const e of echecs) console.log(`  - ${e}`);
console.log(`résultats : ${dossier}`);
process.exit(echecs.length === 0 ? 0 : 1);
