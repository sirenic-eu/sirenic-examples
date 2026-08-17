/**
 * Pay-and-call smoke of the procurement-anticipation routes (2026-08-17) —
 * the ONLY proof a route is actually buyable. Requires the extended DECP
 * stock (post migration 050 re-ingestion); before that, the three routes
 * answer an honest 503 `collecte_en_cours` and nothing is charged.
 *
 *   TEST_WALLET_KEY=0x... npx tsx examples/smoke-marches-predictifs.ts
 *
 * Cost: $0.05 + $0.02 + $0.02 + $0.01 = $0.10 in USDC on Base mainnet.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const apiUrl = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const key = process.env.TEST_WALLET_KEY;
if (!key?.startsWith("0x")) {
  console.error("Set TEST_WALLET_KEY=0x<private key of a DEDICATED test wallet>");
  process.exit(2);
}
const account = privateKeyToAccount(key as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const fetchPayant = wrapFetchWithPayment(fetch, client);

const dossierResultats = join("resultats", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(dossierResultats, { recursive: true });

const CALLS: Array<{ path: string; expect: string; price: string }> = [
  // Tender anticipation: construction contracts expiring within 6 months.
  { path: "/v1/marches/expirations?cpv=45&fenetre_mois=6", expect: "total_marches", price: "$0.05" },
  // Buyer profile: CHU de Toulouse, the most prolific buyer in the DECP stock.
  { path: "/v1/acheteur/26310012500016/profil", expect: "titulaires_principaux", price: "$0.02" },
  // Rivals on the same CPV segments (a training operator with 25 contracts).
  { path: "/v1/entreprise/130031487/concurrents-marches", expect: "concurrents", price: "$0.02" },
  // The historical per-company route, now enriched with estimated end dates.
  { path: "/v1/entreprise/130031487/marches-publics", expect: "marches_en_cours", price: "$0.01" },
];

let echecs = 0;
let ordre = 0;
for (const appel of CALLS) {
  const r = await fetchPayant(`${apiUrl}${appel.path}`, {
    headers: { Accept: "application/json" },
  });
  const corps = await r.text();
  ordre += 1;
  const nom = `${String(ordre).padStart(2, "0")}-${appel.path.replace(/^\/v1\//, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 80)}.json`;
  writeFileSync(join(dossierResultats, nom), corps);
  const ok = r.status === 200 && corps.includes(appel.expect);
  if (!ok) echecs += 1;
  console.log(`${ok ? "✅" : "❌"} ${appel.price} ${appel.path} → HTTP ${r.status}${ok ? "" : ` (attendu: ${appel.expect})`}`);
}
console.log(echecs === 0 ? `\nTout est vert — réponses conservées dans ${dossierResultats}/` : `\n${echecs} échec(s) — corps conservés dans ${dossierResultats}/`);
process.exit(echecs === 0 ? 0 : 1);
