/**
 * Verify a Sirenic response OFFLINE — every 2xx /v1 response carries a
 * detached Ed25519 signature over the exact body bytes:
 *
 *   X-Sirenic-Key-Id     key identifier (rotates with the key)
 *   X-Sirenic-Timestamp  included in the signed message (anti-replay)
 *   X-Sirenic-Signature  base64 Ed25519 signature
 *
 * Signed message: `sirenic-v1:{kid}:{timestamp}:{base64(sha256(body))}`
 * Public key + recipe: https://api.sirenic.eu/.well-known/sirenic-signing-key
 *
 * Run: TEST_WALLET_KEY=0x... npx tsx examples/verify-signature.ts   (~$0.001)
 */
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createHash, createPublicKey, verify } from "node:crypto";

const BASE = "https://api.sirenic.eu";

// 1. Pay one request (any /v1 endpoint — search is the cheapest at $0.001).
const account = privateKeyToAccount(process.env.TEST_WALLET_KEY as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const payingFetch = wrapFetchWithPayment(fetch, client);

const res = await payingFetch(`${BASE}/v1/recherche?q=danone`);
const body = Buffer.from(await res.arrayBuffer()); // exact bytes — do not re-serialize

// 2. Rebuild the signed message from the response headers + body digest.
const kid = res.headers.get("x-sirenic-key-id");
const timestamp = res.headers.get("x-sirenic-timestamp");
const signature = res.headers.get("x-sirenic-signature");
if (!kid || !timestamp || !signature) throw new Error("response is not signed");

const digest = createHash("sha256").update(body).digest("base64");
const message = Buffer.from(`sirenic-v1:${kid}:${timestamp}:${digest}`, "utf8");

// 3. Check against the published public key (fetch once, then cache/pin it).
const wk = (await (await fetch(`${BASE}/.well-known/sirenic-signing-key`)).json()) as {
  kid: string;
  public_key: string; // Ed25519, SPKI DER, base64
};
if (wk.kid !== kid) throw new Error("key id mismatch (key rotated?) — refresh the pinned key");

const publicKey = createPublicKey({
  key: Buffer.from(wk.public_key, "base64"),
  format: "der",
  type: "spki",
});
const valid = verify(null, message, publicKey, Buffer.from(signature, "base64"));

console.log(
  valid
    ? "✔ signature valid — this payload provably came from Sirenic, unmodified"
    : "✘ INVALID signature — do not trust this payload",
);
console.log(JSON.parse(body.toString()).resultats?.[0]);
