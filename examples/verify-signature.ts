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
 * THE FULL AUDIT LOOP: verify the signature, THEN read the provenance. Paid
 * KYB, batch KYB, sanctions and intelligence responses carry a `provenance`
 * array — one entry per block served, each naming the official register it
 * came from and its `as_of` date. Because provenance lives INSIDE the signed
 * bytes, an agent can prove to an auditor, offline and months later, exactly
 * which official source it relied on when it decided to pay.
 *
 * Run: TEST_WALLET_KEY=0x... npx tsx examples/verify-signature.ts   (~$0.02)
 */
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createHash, createPublicKey, verify } from "node:crypto";

const BASE = "https://api.sirenic.eu";

// 1. Pay one request. We use sanctions screening ($0.02): the cheapest
//    endpoint that carries a `provenance` block, so we can demo both halves
//    of the audit loop in a single paid call.
const account = privateKeyToAccount(process.env.TEST_WALLET_KEY as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const payingFetch = wrapFetchWithPayment(fetch, client);

const res = await payingFetch(`${BASE}/v1/sanctions/check?name=Danone`);
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
if (!valid) process.exit(1);

// 4. ONLY NOW read the provenance. It is part of the signed bytes, so what
//    follows is exactly as auditable as the data itself.
type Provenance = {
  bloc: string;
  source_code: string;
  registre: string;
  mode: "stock" | "temps_reel" | "calcul";
  licence?: string;
  version?: string;
  as_of?: string;
  precision_as_of?: "publication_officielle" | "ingestion" | "consultation" | "indisponible";
};
const payload = JSON.parse(body.toString()) as {
  nombre_correspondances: number;
  listes_consultees?: Array<{
    liste: string;
    entrees: number;
    publication: string;
    precision_publication: string;
  }>;
  provenance?: Provenance[];
};

console.log(`\n${payload.nombre_correspondances} match(es) — screened against:`);
for (const l of payload.listes_consultees ?? []) {
  // `precision_publication` is the honest part: OFAC publishes no upstream
  // date, so what you get there is Sirenic's ingestion date, said plainly.
  console.log(
    `  ${l.liste.padEnd(5)} ${String(l.entrees).padStart(6)} entries  as of ${l.publication}  (${l.precision_publication})`,
  );
}

// A missing/empty block is a bug worth shouting about, not a blank section:
// this exact case shipped once (fixed 2026-08-01) and printed a silent void.
if (!payload.provenance?.length) {
  console.log("\n⚠ no provenance block in this response — expected one; please report it.");
  process.exit(1);
}
console.log("\nProvenance, block by block:");
for (const p of payload.provenance) {
  const date = p.as_of ? `${p.as_of} (${p.precision_as_of})` : "no date available";
  console.log(`  ${p.bloc.padEnd(24)} ${p.registre}\n${" ".repeat(28)}${p.mode} · ${date}`);
}
// Codes are stable and documented for free — no payment needed to resolve them.
console.log(`\nWhat each source_code means: ${BASE}/v1/provenance/registres (free)`);
