/**
 * Pay-and-call Sirenic endpoints with REAL money on Base mainnet, in USDC,
 * EURC, or both — a self-check of every route from your side.
 *
 *   # Every endpoint once in USDC (data check, a few $):
 *   TEST_WALLET_KEY=0x... npx tsx examples/smoke-test.ts
 *
 *   # Validate the EURC rail cheaply (only endpoints ≤ $0.005, in EURC):
 *   ASSET=eurc MAX_PRICE=0.005 TEST_WALLET_KEY=0x... npx tsx examples/smoke-test.ts
 *
 *   # Exhaustive: every endpoint in BOTH assets (≈ 2× the cost):
 *   ASSET=both TEST_WALLET_KEY=0x... npx tsx examples/smoke-test.ts
 *
 * Env:
 *   TEST_WALLET_KEY  private key of a DEDICATED throwaway wallet (cleartext).
 *   ASSET            usdc (default) | eurc | both.
 *   MAX_PRICE        skip endpoints above this price (e.g. 0.05). Default: no cap.
 *   SIRENIC_URL      defaults to https://api.sirenic.eu.
 *
 * Prerequisites: fund the wallet on **Base mainnet** with a few USDC AND — to
 * test EURC — a little EURC (Circle's euro stablecoin; buy on Coinbase or swap
 * on a Base DEX). No ETH needed: the x402 `exact` scheme is gasless for the payer
 * (signed EIP-3009 authorization; the facilitator submits the tx).
 *
 * Note: USDC vs EURC only differs in the settlement layer — it is identical for
 * every route. One EURC settlement proves the EURC path works for all of them.
 */
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
const asset = (process.env.ASSET ?? "usdc").toLowerCase();
if (!["usdc", "eurc", "both"].includes(asset)) {
  console.error("ASSET must be one of: usdc | eurc | both");
  process.exit(2);
}
const maxPrice = process.env.MAX_PRICE ? Number(process.env.MAX_PRICE) : Infinity;

const account = privateKeyToAccount(key as `0x${string}`);

// EURC contracts (Circle) on Base — used by the selector to force the EURC
// option of the 402 quote. USDC is the default option, so no selector needed.
const EURC = new Set([
  "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42", // Base mainnet
  "0x808456652fdb597867f38412077a9182bf77359f", // Base Sepolia
]);
const usdcClient = new x402Client();
registerExactEvmScheme(usdcClient, { signer: account });
const eurcClient = new x402Client((_v, requirements) => {
  const e = requirements.find((r) => EURC.has(r.asset.toLowerCase()));
  if (!e) throw new Error("no EURC option offered in the 402 quote");
  return e;
});
registerExactEvmScheme(eurcClient, { signer: account });

const RAILS: Array<[string, ReturnType<typeof wrapFetchWithPayment>]> =
  asset === "both"
    ? [["USDC", wrapFetchWithPayment(fetch, usdcClient)], ["EURC", wrapFetchWithPayment(fetch, eurcClient)]]
    : asset === "eurc"
      ? [["EURC", wrapFetchWithPayment(fetch, eurcClient)]]
      : [["USDC", wrapFetchWithPayment(fetch, usdcClient)]];

// Every paid endpoint, cheapest sample parameters (Danone = SIREN 552032534).
const CALLS: Array<{ path: string; expect: string; price: string }> = [
  { path: "/v1/recherche?q=danone", expect: "resultats", price: "$0.001" },
  { path: "/v1/entreprise/552032534", expect: "denomination", price: "$0.005" },
  { path: "/v1/entreprise/552032534/etablissements", expect: "etablissements", price: "$0.003" },
  { path: "/v1/entreprise/552032534/alertes", expect: "total_annonces", price: "$0.01" },
  { path: "/v1/entreprise/552032534/finances", expect: "exercices", price: "$0.01" },
  { path: "/v1/entreprise/552032534/marches-publics", expect: "siren", price: "$0.01" },
  { path: "/v1/entreprise/552032534/changements?depuis=2020-01-01", expect: "siren", price: "$0.01" },
  { path: "/v1/entreprise/552032534/pi", expect: "marques", price: "$0.03" },
  { path: "/v1/tva/verifier/FR27552032534", expect: "statut", price: "$0.003" },
  { path: "/v1/sanctions/check?name=Danone", expect: "correspondances", price: "$0.02" },
  { path: "/v1/dirigeant/recherche?nom=Faber", expect: "resultats", price: "$0.02" },
  { path: "/v1/eu/recherche?q=equinor&pays=NO", expect: "resultats", price: "$0.003" },
  { path: "/v1/eu/entreprise/NO/923609016", expect: "denomination", price: "$0.01" },
  { path: "/v1/eu/entreprise/CZ/45274649", expect: "denomination", price: "$0.01" },
  { path: "/v1/prospection?naf=62.01Z&departement=75", expect: "resultats", price: "$0.02" },
  { path: "/v1/secteur/62.01Z/benchmarks", expect: "code_naf", price: "$0.05" },
  { path: "/v1/score/defaillance/552032534", expect: "score_risque", price: "$0.10" },
  { path: "/v1/entreprise/552032534/documents", expect: "actes", price: "$0.02" },
  { path: "/v1/kyb/552032534", expect: "score_completude", price: "$0.15" },
  { path: "/v1/entreprise/552032534/sante", expect: "synthese", price: "$0.15" },
  { path: "/v1/entreprise/552032534/capital", expect: "capital", price: "$0.25" },
  { path: "/v1/entreprise/552032534/comptes-pdf", expect: "annexe", price: "$0.15" },
  { path: "/v1/entreprise/552032534/liens-capitalistiques", expect: "detenteurs_pm", price: "$0.15" },
  { path: "/v1/intelligence/552032534", expect: "synthese", price: "$1.00" },
  { path: "/v1/rapport/552032534", expect: "(PDF)", price: "$0.50" },
];

let paid = 0;
let failed = 0;

/** Pays via one rail, prints a report line, returns the JSON body (null for PDF/error/skip). */
async function call(
  rail: string,
  paidFetch: ReturnType<typeof wrapFetchWithPayment>,
  path: string,
  expect: string,
  price: string,
): Promise<Record<string, unknown> | null> {
  if (Number(price.slice(1)) > maxPrice) {
    console.log(`– [${rail}] ${path} skipped (${price} > MAX_PRICE)`);
    return null;
  }
  const started = Date.now();
  try {
    const r = await paidFetch(`${apiUrl}${path}`, { signal: AbortSignal.timeout(210_000) });
    const ms = Date.now() - started;
    const type = r.headers.get("content-type") ?? "";
    if (r.status !== 200) {
      failed++;
      console.log(`✗ [${rail}] ${path} → HTTP ${r.status} (${ms} ms)`);
      return null;
    }
    if (type.includes("pdf")) {
      const bytes = (await r.arrayBuffer()).byteLength;
      paid += Number(price.slice(1));
      console.log(`✓ [${rail}] ${path} → PDF ${(bytes / 1024).toFixed(0)} KB, ${price} (${ms} ms)`);
      return null;
    }
    const body = (await r.json()) as Record<string, unknown>;
    paid += Number(price.slice(1));
    console.log(`${expect in body ? "✓" : "?"} [${rail}] ${path} → ${price} (${ms} ms)`);
    return body;
  } catch (error) {
    failed++;
    console.log(`✗ [${rail}] ${path} → ${String(error).slice(0, 120)}`);
    return null;
  }
}

console.log(`Wallet: ${account.address}\nAPI: ${apiUrl}\nAssets: ${RAILS.map((r) => r[0]).join(" + ")}\n`);
let documentId: { type: string; id: string } | null = null;
for (const [rail, paidFetch] of RAILS) {
  for (const c of CALLS) {
    const body = await call(rail, paidFetch, c.path, c.expect, c.price);
    if (c.path.endsWith("/documents") && body && !documentId) {
      const actes = body.actes as Array<{ id: string }> | undefined;
      const bilans = body.bilans as Array<{ id: string }> | undefined;
      if (actes?.[0]) documentId = { type: "actes", id: actes[0].id };
      else if (bilans?.[0]) documentId = { type: "bilans", id: bilans[0].id };
    }
  }
  if (documentId) {
    await call(rail, paidFetch, `/v1/documents/${documentId.type}/${documentId.id}`, "(PDF)", "$0.10");
  } else {
    console.log(`– [${rail}] PDF document skipped (no document id in the list response)`);
  }
}
console.log(`\nTotal paid: ~$${paid.toFixed(3)} — failures: ${failed}`);
console.log("Every 200 response above was settled on-chain via x402 before being released.");
