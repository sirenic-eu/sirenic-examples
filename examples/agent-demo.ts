/**
 * A tiny autonomous agent: searches a company by name, pays for the top
 * match's full profile, and prints a decision-ready digest. Total cost:
 * $0.001 (search) + $0.005 (profile) = $0.006 in USDC.
 *
 * Usage:
 *   TEST_WALLET_KEY=0x... npm run agent-demo -- "danone"
 */
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const apiUrl = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const query = process.argv[2] ?? "danone";
const key = process.env.TEST_WALLET_KEY;
if (!key?.startsWith("0x")) {
  console.error("Set TEST_WALLET_KEY=0x...");
  process.exit(1);
}

const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(key as `0x${string}`) });
const payingFetch = wrapFetchWithPayment(fetch, client);

console.log(`1. Searching "${query}"…`);
const search = await (await payingFetch(
  `${apiUrl}/v1/recherche?q=${encodeURIComponent(query)}`,
)).json() as { resultats: Array<{ siren: string; denomination: string }> };
const top = search.resultats[0];
if (!top) {
  console.log("No match.");
  process.exit(0);
}
console.log(`   → ${top.denomination} (SIREN ${top.siren})`);

console.log("2. Buying the full profile…");
const profile = await (await payingFetch(`${apiUrl}/v1/entreprise/${top.siren}`)).json() as Record<string, unknown>;

console.log("\n=== Digest ===");
for (const champ of ["denomination", "etat_administratif", "nature_juridique",
  "date_creation", "tranche_effectif_salarie", "tva_intracommunautaire", "data_freshness"]) {
  if (profile[champ] != null) console.log(`${champ}: ${JSON.stringify(profile[champ])}`);
}
