/**
 * A KYB agent in ~20 lines: give it a SIREN, it buys the consolidated KYB
 * file ($0.15) and prints a verdict — identity, legal alerts, sanctions
 * screening of the company AND each officer, completeness score.
 *
 * Usage:  TEST_WALLET_KEY=0x... npm run kyb-agent -- 552032534
 */
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const siren = process.argv[2] ?? "552032534";
const client = new x402Client();
registerExactEvmScheme(client, {
  signer: privateKeyToAccount(process.env.TEST_WALLET_KEY as `0x${string}`),
});
const payingFetch = wrapFetchWithPayment(fetch, client);

const kyb = await (await payingFetch(
  `${process.env.SIRENIC_URL ?? "https://api.sirenic.eu"}/v1/kyb/${siren}`,
)).json() as Record<string, any>;

console.log(`Company : ${kyb.identite.denomination} (${kyb.siren}) — ${kyb.identite.etat_administratif}`);
console.log(`Officers: ${kyb.identite.dirigeants?.length ?? 0} | VAT: ${kyb.tva_intracommunautaire}`);
console.log(`Alerts  : ${kyb.alertes_bodacc.procedures_collectives?.length ?? "n/a"} insolvency proceedings`);
console.log(`Sanctions screening: ${kyb.criblage_sanctions.statut}`);
console.log(`Completeness: ${kyb.score_completude}/100`, kyb.blocs_manquants?.length ? `(missing: ${kyb.blocs_manquants.map((b: any) => b.bloc).join(", ")})` : "");
