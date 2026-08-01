/**
 * A signed response that carries its own provenance is a PIECE OF EVIDENCE,
 * not just an API response. This example turns one $0.03 call into an audit
 * file that your accountant — or a tax auditor — can re-check years later,
 * offline, without Sirenic and without an account.
 *
 * Why it matters now: from **September 1, 2026** every French company must be
 * able to RECEIVE electronic invoices (art. 91, Loi de finances 2024; issuance
 * phases in Sept. 2026 for large companies, Sept. 2027 for SMEs). Before you
 * invoice or pay a supplier, three things need checking — is the company still
 * active, is its VAT number valid TODAY, is that IBAN a real account at an
 * identified bank. `GET /v1/facturation/dossier` answers all three and adds a
 * deterministic `pret_a_facturer` verdict with closed-list reasons.
 *
 * The ORDER below is the whole argument: verify the signature first, read the
 * data second. You do not act on a payload you have not authenticated.
 *
 *   1. pay the call;
 *   2. verify the Ed25519 signature over the EXACT body bytes, offline;
 *   3. only then read the verdict, its reasons and the per-block provenance;
 *   4. write the archive to disk (raw bytes, signature, public key, LISEZ-MOI);
 *   5. re-verify FROM THE WRITTEN FILES — an archive that needs the API to be
 *      re-checked is not an archive.
 *
 * Sirenic is not an accredited platform (PDP): it does not issue, transmit or
 * route any invoice. The verdict is decision support, not tax-compliance
 * advice, and the account holder's name is never checked.
 *
 * Run: TEST_WALLET_KEY=0x... npx tsx examples/verify-invoice-file.ts   (~$0.03)
 * Env: SIREN (default 552032534, Danone), IBAN (default: the example IBAN used
 *      throughout French banking documentation — mod 97-10 valid), OUT_DIR.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, createPublicKey, verify } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const BASE = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const SIREN = process.env.SIREN ?? "552032534";
const IBAN = process.env.IBAN ?? "FR1420041010050500013M02606";

type Signature = { kid: string; timestamp: string; signature: string };

/**
 * The whole recipe in one function — deliberately, because it is called TWICE:
 * once on the live response, once on the files written to disk. Same inputs,
 * same result, or the archive is worthless.
 */
function verifySignature(body: Buffer, sig: Signature, publicKeyBase64: string): boolean {
  const digest = createHash("sha256").update(body).digest("base64");
  const message = Buffer.from(`sirenic-v1:${sig.kid}:${sig.timestamp}:${digest}`, "utf8");
  const publicKey = createPublicKey({
    key: Buffer.from(publicKeyBase64, "base64"),
    format: "der",
    type: "spki",
  });
  return verify(null, message, publicKey, Buffer.from(sig.signature, "base64"));
}

// 1. Pay the call. $0.03, no account, no API key — the agent signs a payment
//    authorization on Base and the response is released.
const account = privateKeyToAccount(process.env.TEST_WALLET_KEY as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const payingFetch = wrapFetchWithPayment(fetch, client);

const url = `${BASE}/v1/facturation/dossier?siren=${SIREN}&iban=${IBAN}`;
const res = await payingFetch(url, { signal: AbortSignal.timeout(60_000) });
if (res.status !== 200) {
  console.error(`HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const body = Buffer.from(await res.arrayBuffer()); // exact bytes — do not re-serialize

// 2. Verify BEFORE reading. The signed message is rebuilt from the headers and
//    the digest of those exact bytes; `JSON.parse` + `JSON.stringify` would
//    reorder or reformat something and break it — that is the classic trap.
const sig: Signature = {
  kid: res.headers.get("x-sirenic-key-id") ?? "",
  timestamp: res.headers.get("x-sirenic-timestamp") ?? "",
  signature: res.headers.get("x-sirenic-signature") ?? "",
};
if (!sig.kid || !sig.timestamp || !sig.signature) throw new Error("response is not signed");

// Kept as the bytes actually served: the archive must hold the key AS PUBLISHED,
// not our re-rendering of it. In production, pin this file and stop fetching it.
const keyBytes = Buffer.from(
  await (await fetch(`${BASE}/.well-known/sirenic-signing-key`)).arrayBuffer(),
);
const publishedKey = JSON.parse(keyBytes.toString()) as { kid: string; public_key: string };
if (publishedKey.kid !== sig.kid) {
  throw new Error("key id mismatch (key rotated?) — refresh the pinned key");
}

if (!verifySignature(body, sig, publishedKey.public_key)) {
  console.error("✘ INVALID signature — do not trust this payload, do not pay this supplier");
  process.exit(1);
}
console.log(`✔ signature valid (kid ${sig.kid}, ${sig.timestamp}) — authenticated, unmodified`);

// 3. ONLY NOW read the file. Everything below is inside the signed bytes, so it
//    is exactly as provable as the signature itself.
type Reason = { code: string; niveau: "bloquante" | "information"; source: string };
type Provenance = {
  bloc: string;
  source_code: string;
  registre: string;
  mode: "stock" | "temps_reel" | "calcul";
  licence?: string;
  version?: string;
  as_of?: string;
  precision_as_of?: string;
};
const file = JSON.parse(body.toString()) as {
  siren: string;
  destinataire?: { destinataire?: { denomination?: string | null; etat_administratif?: string | null } };
  tva_vies?: { numero: string | null; statut: string };
  banque?: {
    iban_normalise?: string;
    valide?: boolean;
    banque?: { identifiee?: boolean; nom?: string | null; bic?: string | null };
  } | null;
  verdict: { pret_a_facturer: boolean; raisons: Reason[] };
  provenance?: Provenance[];
};

const supplier = file.destinataire?.destinataire;
console.log(`\nSupplier   ${supplier?.denomination ?? "?"} (SIREN ${file.siren}) — ${supplier?.etat_administratif ?? "?"}`);
console.log(`VAT        ${file.tva_vies?.numero ?? "not computable"} → ${file.tva_vies?.statut ?? "not checked"} (VIES, live)`);
const bank = file.banque?.banque;
console.log(
  file.banque
    ? `IBAN       ${file.banque.iban_normalise} → ${file.banque.valide ? "valid" : "INVALID"}, bank ${bank?.identifiee ? `${bank.nom ?? "?"} (BIC ${bank.bic ?? "n/a"})` : "not identified"}`
    : "IBAN       not provided",
);
console.log(`\nVERDICT    pret_a_facturer = ${file.verdict.pret_a_facturer}`);
// Reasons are a CLOSED list: an agent can branch on `code` without parsing prose.
for (const r of file.verdict.raisons) {
  console.log(`  ${r.niveau === "bloquante" ? "✘" : "·"} ${r.code.padEnd(24)} ${r.source}`);
}

console.log("\nProvenance, block by block:");
for (const p of file.provenance ?? []) {
  const date = p.as_of ? `${p.as_of} (${p.precision_as_of})` : "no date (computed block)";
  console.log(`  ${p.bloc.padEnd(24)} ${p.registre}\n${" ".repeat(28)}${p.mode} · ${date}`);
}
if (!file.provenance?.length) console.log("  (no provenance block in this response)");

// 4. Write the audit file. Under resultats/ by default — the directory this repo
//    already gitignores, so a paid response never lands in a commit by accident.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = join(process.env.OUT_DIR ?? "resultats", `dossier-facturation-${SIREN}-${stamp}`);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "reponse.json"), body); // the bytes, byte for byte
writeFileSync(
  join(dir, "signature.txt"),
  `kid=${sig.kid}\ntimestamp=${sig.timestamp}\nsignature=${sig.signature}\n`,
);
writeFileSync(join(dir, "cle-publique.json"), keyBytes);
writeFileSync(join(dir, "LISEZ-MOI.md"), lisezMoi(url, sig, file.verdict.pret_a_facturer));

// 5. Re-verify from disk only. If this fails, the archive proves nothing — so
//    it is a hard failure, not a warning.
const archivedBody = readFileSync(join(dir, "reponse.json"));
const archivedSig = Object.fromEntries(
  readFileSync(join(dir, "signature.txt"), "utf8")
    .trim()
    .split("\n")
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
) as Signature;
const archivedKey = JSON.parse(readFileSync(join(dir, "cle-publique.json"), "utf8")) as {
  public_key: string;
};
if (!verifySignature(archivedBody, archivedSig, archivedKey.public_key)) {
  console.error(`\n✘ the archive in ${dir}/ does NOT re-verify — it is not evidence`);
  process.exit(1);
}
console.log(`\n✔ archive re-verified from its files alone → ${dir}/`);
console.log("  Keep the folder. It re-checks offline, with node or openssl — see LISEZ-MOI.md.");

/**
 * The archive is read by a human (an accountant, an auditor), months later,
 * on a machine that has never heard of Sirenic — hence a French README with
 * the exact commands, and no dependency beyond node or openssl.
 */
function lisezMoi(source: string, sig: Signature, pretAFacturer: boolean): string {
  return `# Pièce d'audit — dossier de facturation Sirenic

Réponse de \`${source}\`, achetée le ${sig.timestamp} (paiement x402 réglé sur Base).
Verdict au moment de l'achat : **pret_a_facturer = ${pretAFacturer}**.

| Fichier | Contenu |
|---|---|
| \`reponse.json\` | les octets EXACTS du corps signé — ne jamais les reformater : la signature porte sur ces octets-là, pas sur ce JSON « rangé » |
| \`signature.txt\` | \`kid\`, \`timestamp\` et signature Ed25519 (base64), tels que reçus dans les en-têtes |
| \`cle-publique.json\` | la clé publique Sirenic telle que publiée sur \`/.well-known/sirenic-signing-key\` |

Message signé : \`sirenic-v1:{kid}:{timestamp}:{base64(sha256(reponse.json))}\`.
La provenance (registre officiel de chaque bloc et sa date) est **dans le corps
signé** : elle est donc couverte par la même signature que la donnée.

## Re-vérifier cette archive, des mois plus tard, hors ligne et sans Sirenic

Depuis ce dossier, avec Node seul (aucune dépendance, aucun réseau) :

\`\`\`bash
node -e '
const fs=require("fs"), c=require("crypto");
const corps=fs.readFileSync("reponse.json");
const s={}; for (const l of fs.readFileSync("signature.txt","utf8").trim().split("\\n")) s[l.slice(0,l.indexOf("="))]=l.slice(l.indexOf("=")+1);
const cle=JSON.parse(fs.readFileSync("cle-publique.json","utf8")).public_key;
const message="sirenic-v1:"+s.kid+":"+s.timestamp+":"+c.createHash("sha256").update(corps).digest("base64");
const pub=c.createPublicKey({key:Buffer.from(cle,"base64"),format:"der",type:"spki"});
console.log(c.verify(null,Buffer.from(message),pub,Buffer.from(s.signature,"base64")) ? "signature VALIDE" : "signature INVALIDE");
'
\`\`\`

Ou avec OpenSSL seul, sans Node :

\`\`\`bash
{ echo "-----BEGIN PUBLIC KEY-----"; grep -o '"public_key":"[^"]*"' cle-publique.json | cut -d'"' -f4; echo "-----END PUBLIC KEY-----"; } > cle-publique.pem
kid=$(grep '^kid=' signature.txt | cut -d= -f2-)
horodatage=$(grep '^timestamp=' signature.txt | cut -d= -f2-)
grep '^signature=' signature.txt | cut -d= -f2- | base64 -d > signature.bin
printf 'sirenic-v1:%s:%s:%s' "$kid" "$horodatage" "$(openssl dgst -sha256 -binary reponse.json | base64)" > message.txt
openssl pkeyutl -verify -pubin -inkey cle-publique.pem -rawin -in message.txt -sigfile signature.bin
\`\`\`

La seconde commande dérive trois fichiers de travail (\`cle-publique.pem\`,
\`signature.bin\`, \`message.txt\`) : ils se recalculent, seuls les trois fichiers
d'origine font foi. Toute modification d'un seul octet de \`reponse.json\` fait
échouer les deux commandes. La clé peut avoir été remplacée depuis (rotation) : c'est \`kid\` qui
dit laquelle a signé, et c'est la copie archivée ici qui fait foi.

## Portée

Aide à la décision déterministe (raisons en liste fermée, tracées à leur
source). Ce n'est ni un avis de conformité fiscale, ni une vérification du nom
du titulaire du compte, qui n'est jamais contrôlé. Sirenic n'est pas une
plateforme agréée (PDP) : elle n'émet, ne transmet ni ne route aucune facture,
et ne confirme pas l'enregistrement du destinataire sur le PPF ou une PDP.

*In English: this folder re-verifies offline with the two commands above. The
signed message is \`sirenic-v1:{kid}:{timestamp}:{base64(sha256(reponse.json))}\`
and the recipe is published at \`/.well-known/sirenic-signing-key\`.*
`;
}
