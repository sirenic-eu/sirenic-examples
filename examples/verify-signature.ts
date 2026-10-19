/**
 * Verify a Sirenic response OFFLINE: every 2xx /v1 response carries a
 * detached Ed25519 signature over the exact body bytes:
 *
 *   X-Sirenic-Key-Id     identifier of the key that signed THIS response
 *   X-Sirenic-Timestamp  included in the signed message (anti-replay)
 *   X-Sirenic-Signature  base64 Ed25519 signature
 *
 * Signed message: `sirenic-v1:{kid}:{timestamp}:{base64(sha256(body))}`
 * Keys + recipe: https://api.sirenic.eu/.well-known/sirenic-signing-key
 *
 * Its `keys` list holds EVERY key that has ever signed, and an entry is never
 * removed, each with the UTC days it may have signed (`valid_from`,
 * `valid_until`, both inclusive). So a response bought before Sirenic changes
 * its key still verifies, months or years later, with the entry of its kid.
 * Never verify with the root `public_key`: it is the key signing TODAY.
 *
 * THE FULL AUDIT LOOP: verify the signature, THEN read the provenance. Paid
 * KYB, batch KYB, sanctions and intelligence responses carry a `provenance`
 * array (one entry per block served, each naming the official register it
 * came from and its `as_of` date). Because provenance lives INSIDE the signed
 * bytes, an agent can prove to an auditor, offline and months later, exactly
 * which official source it relied on when it decided to pay.
 *
 * Every paid response also carries X-Sirenic-Verification-Id: its public
 * receipt, GET /verifier/{number} (free, no account), re-checks the signature
 * Sirenic stored for it and never shows the data. It is the link to hand to
 * whoever has to check the document.
 *
 * Run: TEST_WALLET_KEY=0x... npx tsx examples/verify-signature.ts   (~$0.02)
 * Env: SIRENIC_URL (default https://api.sirenic.eu)
 */
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createHash, createPublicKey, verify } from "node:crypto";

const BASE = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";

/** Prints why the response is refused and stops: nothing below is read. */
function refuse(reason: string): never {
  console.log(`✘ ${reason}`);
  process.exit(1);
}

// 1. Pay one request. We use sanctions screening ($0.02): the cheapest
//    endpoint that carries a `provenance` block, so we can demo both halves
//    of the audit loop in a single paid call.
const account = privateKeyToAccount(process.env.TEST_WALLET_KEY as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const payingFetch = wrapFetchWithPayment(fetch, client);

const res = await payingFetch(`${BASE}/v1/sanctions/check?name=Danone`);
const body = Buffer.from(await res.arrayBuffer()); // exact bytes, do not re-serialize

// 2. Rebuild the signed message from the response headers + body digest.
const kid = res.headers.get("x-sirenic-key-id");
const timestamp = res.headers.get("x-sirenic-timestamp");
const signature = res.headers.get("x-sirenic-signature");
if (!kid || !timestamp || !signature) throw new Error("response is not signed");

const digest = createHash("sha256").update(body).digest("base64");
const message = Buffer.from(`sirenic-v1:${kid}:${timestamp}:${digest}`, "utf8");

// 3. Find the key that signed THIS response: the entry of `keys` whose kid is
//    the key id header (fetch the document once, then archive it with your
//    responses: a newer copy always keeps every entry of an older one).
type KeyEntry = {
  kid: string;
  alg: string;
  public_key: string; // Ed25519, SPKI DER, base64
  valid_from: string; // UTC day, inclusive
  valid_until: string | null; // UTC day, inclusive; null while the key may still sign
};
type KeysDocument = { kid: string; public_key: string; keys?: KeyEntry[] };
const wk = (await (await fetch(`${BASE}/.well-known/sirenic-signing-key`)).json()) as KeysDocument;

// The UTC day is read on the header itself, in the exact form Sirenic signs:
// `new Date()` would read a timestamp without its Z in local time.
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(timestamp)) {
  refuse(`malformed timestamp header (${timestamp}): do not trust this payload`);
}
const day = timestamp.slice(0, 10);

let publicKeyBase64: string;
let keyUsed: string;
if (Array.isArray(wk.keys)) {
  const entry = wk.keys.find((e) => e.kid === kid);
  if (!entry) refuse(`kid ${kid} is not published in keys: Sirenic did not sign this response`);
  const until = entry.valid_until ?? "today";
  if (day < entry.valid_from || (entry.valid_until !== null && day > entry.valid_until)) {
    refuse(`timestamp ${timestamp} is outside the validity window of key ${kid} (${entry.valid_from} to ${until})`);
  }
  publicKeyBase64 = entry.public_key;
  keyUsed = `key ${kid}, in use from ${entry.valid_from} to ${until}`;
} else {
  // A key document archived before 2026-10-02 has no `keys`: its root key is
  // the only one it knows, with no dates to check.
  if (wk.kid !== kid) refuse(`kid ${kid} is not the root key of this document, which has no keys list`);
  publicKeyBase64 = wk.public_key;
  keyUsed = `root key ${kid} of a document without keys, no validity window to check`;
}

const publicKey = createPublicKey({
  key: Buffer.from(publicKeyBase64, "base64"),
  format: "der",
  type: "spki",
});
if (!verify(null, message, publicKey, Buffer.from(signature, "base64"))) {
  refuse("INVALID signature: do not trust this payload");
}
console.log(`✔ signature valid (${keyUsed}): this payload provably came from Sirenic, unmodified`);

// 4. The public receipt. It does not replace the offline check above, which is
//    the proof: a receipt that cannot be read changes nothing to it. But a
//    receipt that describes OTHER bytes must never be handed out.
const number = res.headers.get("x-sirenic-verification-id");
if (!number) {
  console.log("\nNo X-Sirenic-Verification-Id header: no public receipt for this response.");
} else {
  const receiptUrl = `${BASE}/verifier/${encodeURIComponent(number)}`;
  console.log(`\nPublic receipt (free, anyone can open it): ${receiptUrl}`);
  try {
    const r = await fetch(receiptUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const receipt = (await r.json()) as {
      verdict?: string;
      signature?: { kid?: string; corps_sha256?: string; message_signe?: string };
    };
    if (receipt.verdict !== "valide") {
      console.log(`  receipt verdict: ${receipt.verdict ?? `HTTP ${r.status}`} (it neither confirms nor contradicts the offline check)`);
    } else if (
      receipt.signature?.corps_sha256 !== digest ||
      receipt.signature?.kid !== kid ||
      receipt.signature?.message_signe !== message.toString("utf8")
    ) {
      console.log("✘ this receipt describes another response (body digest, kid or signed message differ):");
      console.log("  the signature above is still valid, but do not hand out this verification number.");
      process.exit(1);
    } else {
      console.log("  receipt verdict: valide, same body digest, kid and signed message as the bytes received");
    }
  } catch (e) {
    console.log(`  receipt not readable (${(e as Error).message}): the offline check above is the proof`);
  }
}

// 5. ONLY NOW read the provenance. It is part of the signed bytes, so what
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

console.log(`\n${payload.nombre_correspondances} match(es), screened against:`);
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
  console.log("\n⚠ no provenance block in this response: expected one; please report it.");
  process.exit(1);
}
console.log("\nProvenance, block by block:");
for (const p of payload.provenance) {
  const date = p.as_of ? `${p.as_of} (${p.precision_as_of})` : "no date available";
  console.log(`  ${p.bloc.padEnd(24)} ${p.registre}\n${" ".repeat(28)}${p.mode} · ${date}`);
}
// Codes are stable and documented for free: no payment needed to resolve them.
console.log(`\nWhat each source_code means: ${BASE}/v1/provenance/registres (free)`);
