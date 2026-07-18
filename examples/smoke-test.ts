/**
 * Pay-and-call EVERY Sirenic endpoint once — a full smoke test with real
 * money (~$1.80 total, USDC on Base mainnet).
 *
 *   TEST_WALLET_KEY=0x... npx tsx examples/smoke-test.ts
 *
 * Use a dedicated throwaway wallet funded with a few USDC — never your
 * main wallet: the private key is read from the environment in cleartext.
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

const account = privateKeyToAccount(key as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const paidFetch = wrapFetchWithPayment(fetch, client);

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
  { path: "/v1/prospection?naf=62.01Z&departement=75", expect: "resultats", price: "$0.02" },
  { path: "/v1/secteur/62.01Z/benchmarks", expect: "code_naf", price: "$0.05" },
  { path: "/v1/score/defaillance/552032534", expect: "score_risque", price: "$0.10" },
  { path: "/v1/entreprise/552032534/documents", expect: "actes", price: "$0.02" },
  { path: "/v1/kyb/552032534", expect: "score_completude", price: "$0.15" },
  { path: "/v1/entreprise/552032534/sante", expect: "synthese", price: "$0.15" },
  // AI extractions (slower, up to ~200 s cold). capital → comptes-pdf → liens:
  // liens composes the first two, so it reuses their permanent cache.
  { path: "/v1/entreprise/552032534/capital", expect: "capital", price: "$0.25" },
  { path: "/v1/entreprise/552032534/comptes-pdf", expect: "annexe", price: "$0.15" },
  { path: "/v1/entreprise/552032534/liens-capitalistiques", expect: "detenteurs_pm", price: "$0.15" },
  { path: "/v1/rapport/552032534", expect: "(PDF)", price: "$0.50" },
  // The document PDF needs an id from the /documents call — resolved below.
  // /v1/kyb/batch is the multi-SIREN variant of /v1/kyb — skipped here to keep
  // one dedicated test SIREN and a static cost.
];

let paid = 0;
let failed = 0;

/** Pays, prints one report line, returns the JSON body (null for PDF/error). */
async function call(path: string, expect: string, price: string): Promise<Record<string, unknown> | null> {
  const started = Date.now();
  try {
    const r = await paidFetch(`${apiUrl}${path}`, { signal: AbortSignal.timeout(210_000) });
    const ms = Date.now() - started;
    const type = r.headers.get("content-type") ?? "";
    if (r.status !== 200) {
      failed++;
      console.log(`✗ ${path} → HTTP ${r.status} (${ms} ms)`);
      return null;
    }
    if (type.includes("pdf")) {
      const bytes = (await r.arrayBuffer()).byteLength;
      paid += Number(price.slice(1));
      console.log(`✓ ${path} → PDF ${(bytes / 1024).toFixed(0)} KB, ${price} (${ms} ms)`);
      return null;
    }
    const body = (await r.json()) as Record<string, unknown>;
    paid += Number(price.slice(1));
    console.log(`${expect in body ? "✓" : "?"} ${path} → ${price} (${ms} ms)`);
    return body;
  } catch (error) {
    failed++;
    console.log(`✗ ${path} → ${String(error).slice(0, 120)}`);
    return null;
  }
}

console.log(`Wallet: ${account.address}\nAPI: ${apiUrl}\n`);
let documentId: { type: string; id: string } | null = null;
for (const c of CALLS) {
  const body = await call(c.path, c.expect, c.price);
  // Grab a document id from the list to test the PDF download afterwards.
  if (c.path.endsWith("/documents") && body) {
    const actes = body.actes as Array<{ id: string }> | undefined;
    const bilans = body.bilans as Array<{ id: string }> | undefined;
    if (actes?.[0]) documentId = { type: "actes", id: actes[0].id };
    else if (bilans?.[0]) documentId = { type: "bilans", id: bilans[0].id };
  }
}
if (documentId) {
  await call(`/v1/documents/${documentId.type}/${documentId.id}`, "(PDF)", "$0.10");
} else {
  console.log("– PDF document skipped (no document id in the list response)");
}
console.log(`\nTotal paid: ~$${paid.toFixed(3)} USDC — failures: ${failed}`);
console.log("Every response above was settled on-chain via x402 before being released.");
