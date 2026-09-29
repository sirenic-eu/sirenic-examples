/**
 * Re-derive a `response-provenance` hash from a real paid response — with an
 * off-the-shelf RFC 8785 library, no vendor code.
 *
 * Illustration agreed in issue #2: what a buyer keeps on file after paying a
 * seller that emits `responseHash = sha256(jcs(fixedPoint))`, and how they
 * re-check it offline with nothing but a JCS library. Sirenic does not emit
 * the field today; the live target is x402toll.com, an x402 seller that does.
 * Sirenic's cached/model-derived routes (e.g. /v1/entreprise/{siren}/sante,
 * /capital) are explicitly OUT of scope — under the spec's closure rule they
 * must emit nothing, and re-deriving them is not meant to be possible.
 *
 * Spec: golden-vector-provenance, pinned to git tag v0.7.0 (not npm):
 *   https://github.com/SolomonisBlack/golden-vector-provenance/tree/v0.7.0
 * This target serves the GVP-FixedPoint/1 shape ({endpoint, inputs, result,
 * method, dataVintage}); /2 tightens the dataVintage grammar, the fixed-point
 * membership is the same. No runtime dependency on the spec's package — the
 * whole point is that `canonicalize` (RFC 8785) + sha256 is enough.
 *
 * Usage:
 *   TEST_WALLET_KEY=0x... npx tsx examples/rederive-response-provenance.ts
 *
 * TEST_WALLET_KEY is YOUR client test wallet (the payer), funded with a few
 * cents of USDC on Base mainnet. The "exact" scheme uses signed
 * authorizations: the client pays no gas. Cost of this run: $0.05.
 */
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const apiUrl = process.env.TOLL_URL ?? "https://x402toll.com";
const key = process.env.TEST_WALLET_KEY;
if (!key?.startsWith("0x")) {
  console.error("Set TEST_WALLET_KEY=0x... (your client test wallet, never the server's)");
  process.exit(1);
}

const account = privateKeyToAccount(key as `0x${string}`);
console.log(`Payer wallet: ${account.address}`);

const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const payingFetch = wrapFetchWithPayment(fetch, client);

// 1. Pay for a deterministic calculation. The inputs are OURS — a buyer
//    re-derives against what they sent, never against an echo they trust.
const inputs = { salary: 85000, state: "TX", filingStatus: "single", payFrequency: "biweekly" };
console.log(`\nPaying POST ${apiUrl}/v1/paycheck …`);
const res = await payingFetch(`${apiUrl}/v1/paycheck`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(inputs),
});
console.log(`→ HTTP ${res.status}`);
if (res.status !== 200) {
  console.error(JSON.stringify(await res.json(), null, 2));
  process.exit(1);
}
const body = await res.json();
const claimed: string = body.provenance.responseHash;
console.log(`result.netPerCheck : ${body.result.netPerCheck}`);
console.log(`claimed hash       : ${claimed}`);

// 2. Rebuild the fixed point from what we know and what we were served.
//    Everything the hash covers is on the table: no timestamp, no signature,
//    no callback to the seller.
const fixedPoint = {
  endpoint: body.endpoint,
  inputs,
  result: body.result,
  method: body.provenance.method,
  dataVintage: body.provenance.dataVintage,
};

// 3. Re-derive with an independent RFC 8785 implementation. `canonicalize`
//    is the reference JCS library — not the seller's code, not the spec
//    author's code.
const jcs = canonicalize(fixedPoint);
if (!jcs) {
  console.error("canonicalize returned nothing — fixed point not serializable");
  process.exit(1);
}
const rederived = "sha256:" + createHash("sha256").update(jcs).digest("hex");
console.log(`re-derived hash    : ${rederived}`);

const match = rederived === claimed;
console.log(`MATCH              : ${match}`);

// 4. Keep the settlement receipt beside the hash — payment proof and content
//    proof are different claims, and a buyer files both.
const receipt = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
if (receipt) {
  const settle = JSON.parse(Buffer.from(receipt, "base64").toString("utf8"));
  console.log(`settled on         : ${settle?.network ?? "(not reported)"}`);
  console.log(`settlement tx      : ${settle?.transaction ?? "(none)"}`);
}

if (!match) {
  console.error("\nThe served result does not re-derive — do not file it as unaltered.");
  process.exit(1);
}
console.log("\nOn file: the response bytes re-derive to the claimed hash. That proves");
console.log("unaltered + reproducible — not correct. Correctness is the golden vectors' job.");
