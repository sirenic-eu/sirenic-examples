/**
 * Smoke PAYANT complémentaire — voie PRIMAIRE « page employeur » de
 * /v1/entreprise/{siren}/emploi, après souscription SPE par CDU (25/08/2026)
 * et correctif `where` (6725240).
 *
 * UNE ÉPREUVE : LA POSTE (356000000) — page employeur relevée en direct à
 * 99 annonces. Attendu : comptage = page_employeur, recrute_activement = true,
 * annonces_actives > 0. Coût : 0,02 $.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-emploi-spe-2026-08-25.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const api = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const cle = process.env.TEST_WALLET_KEY;
if (!cle?.startsWith("0x")) {
  console.error("TEST_WALLET_KEY manquante");
  process.exit(1);
}
const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(cle as `0x${string}`) });
const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-emploi-spe-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const echecs: string[] = [];
const verifier = (ok: boolean, quoi: string): void => {
  console.log(`${ok ? "  ok  " : " ÉCHEC"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};

const r = await payer(`${api}/v1/entreprise/356000000/emploi`);
const brut = await r.text();
writeFileSync(`${dossier}/la-poste.json`, `HTTP ${r.status}\n${brut}\n`);
const corps = JSON.parse(brut) as Record<string, unknown>;
const s = (corps.signaux_recrutement ?? {}) as Record<string, unknown>;
const methode = (s.methode ?? {}) as Record<string, unknown>;
console.log(`— LA POSTE → HTTP ${r.status}`);
verifier(r.status === 200, `200 (lu ${r.status})`);
verifier(methode.comptage === "page_employeur", `comptage = page_employeur (lu ${String(methode.comptage)})`);
verifier(s.recrute_activement === true, `recrute_activement = true (lu ${String(s.recrute_activement)})`);
verifier(typeof s.annonces_actives === "number" && (s.annonces_actives as number) > 0, `annonces_actives > 0 (lu ${String(s.annonces_actives)})`);
console.log(`  annonces=${String(s.annonces_actives)} correspondantes=${String(methode.annonces_correspondantes)} familles=${JSON.stringify((s.familles_rome as unknown[])?.slice(0, 3))}`);
writeFileSync(`${dossier}/RECAP.md`, `# Smoke SPE ${horodatage}\n\nLA POSTE 0,02 $ — voie page employeur.\n${echecs.length === 0 ? "TOUT VERT" : `ÉCHECS:\n${echecs.join("\n")}`}\n`);
console.log(echecs.length === 0 ? "SMOKE VERT" : `SMOKE ROUGE — ${echecs.length} échec(s)`);
console.log(`résultats : ${dossier}`);
process.exit(echecs.length === 0 ? 0 : 1);
