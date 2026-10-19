/**
 * A signed response that carries its own provenance is a PIECE OF EVIDENCE,
 * not just an API response. This example turns one $0.03 call into an audit
 * file that your accountant, or a tax auditor, can re-check years later,
 * offline, without Sirenic and without an account.
 *
 * Why it matters now: from **September 1, 2026** every French company must be
 * able to RECEIVE electronic invoices (art. 91, Loi de finances 2024; issuance
 * phases in Sept. 2026 for large companies, Sept. 2027 for SMEs). Before you
 * invoice or pay a supplier, three things need checking: is the company still
 * active, is its VAT number valid TODAY, is that IBAN a real account at an
 * identified bank. `GET /v1/facturation/dossier` answers all three and adds a
 * deterministic `pret_a_facturer` verdict with closed-list reasons.
 *
 * The ORDER below is the whole argument: verify the signature first, read the
 * data second. You do not act on a payload you have not authenticated.
 *
 *   1. pay the call;
 *   2. verify the Ed25519 signature over the EXACT body bytes, offline, with
 *      the key of its kid in the published `keys` list;
 *   3. only then read the verdict, its reasons and the per-block provenance;
 *   4. write the archive to disk (raw bytes, signature, key document, LISEZ-MOI);
 *   5. re-verify FROM THE WRITTEN FILES: an archive that needs the API to be
 *      re-checked is not an archive.
 *
 * Sirenic is not an accredited platform (PDP): it does not issue, transmit or
 * route any invoice. The verdict is decision support, not tax-compliance
 * advice, and the account holder's name is never checked.
 *
 * Run: TEST_WALLET_KEY=0x... npx tsx examples/verify-invoice-file.ts   (~$0.03)
 * Env: SIREN (default 552032534, Danone), IBAN (default: the example IBAN used
 *      throughout French banking documentation, mod 97-10 valid), OUT_DIR,
 *      SIRENIC_URL (default https://api.sirenic.eu).
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
/** One entry of `keys` in /.well-known/sirenic-signing-key: a key that has signed, never removed. */
type KeyEntry = {
  kid: string;
  alg: string;
  public_key: string; // Ed25519, SPKI DER, base64
  valid_from: string; // UTC day, inclusive
  valid_until: string | null; // UTC day, inclusive; null while the key may still sign
};
type KeysDocument = { kid: string; public_key: string; keys?: KeyEntry[] };
/** `entry` is null when a document without `keys` (archived before 2026-10-02) was used through its root key. */
type Verdict = { valid: true; entry: KeyEntry | null } | { valid: false; reason: string };

/**
 * The whole recipe in one function, deliberately, because it is called TWICE:
 * once on the live response, once on the files written to disk. Same inputs,
 * same result, or the archive is worthless.
 *
 * The key is the entry of `keys` whose kid is the one the response carries,
 * and the UTC day of its timestamp must fall within that entry's days. Never
 * the root `public_key`: it is the key of the day the document was fetched,
 * and it does not verify a response signed before Sirenic changed its key.
 */
function verifySignature(body: Buffer, sig: Signature, keysDocument: KeysDocument): Verdict {
  // The UTC day is read on the signed string itself, in the exact form Sirenic
  // signs: `new Date()` would read a timestamp without its Z in local time.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(sig.timestamp)) {
    return { valid: false, reason: `malformed timestamp (${sig.timestamp})` };
  }
  const day = sig.timestamp.slice(0, 10);
  let entry: KeyEntry | null = null;
  let publicKeyBase64: string;
  if (Array.isArray(keysDocument.keys)) {
    const found = keysDocument.keys.find((e) => e.kid === sig.kid);
    if (!found) return { valid: false, reason: `kid ${sig.kid} is not published in keys` };
    if (day < found.valid_from || (found.valid_until !== null && day > found.valid_until)) {
      return {
        valid: false,
        reason: `timestamp ${sig.timestamp} is outside the validity window of key ${sig.kid} (${found.valid_from} to ${found.valid_until ?? "today"})`,
      };
    }
    entry = found;
    publicKeyBase64 = found.public_key;
  } else {
    // A key document archived before 2026-10-02 has no `keys`: only its root key, with no dates to check.
    if (keysDocument.kid !== sig.kid) {
      return { valid: false, reason: `kid ${sig.kid} is not the root key of this document, which has no keys list` };
    }
    publicKeyBase64 = keysDocument.public_key;
  }
  const digest = createHash("sha256").update(body).digest("base64");
  const message = Buffer.from(`sirenic-v1:${sig.kid}:${sig.timestamp}:${digest}`, "utf8");
  const publicKey = createPublicKey({
    key: Buffer.from(publicKeyBase64, "base64"),
    format: "der",
    type: "spki",
  });
  return verify(null, message, publicKey, Buffer.from(sig.signature, "base64"))
    ? { valid: true, entry }
    : { valid: false, reason: "INVALID signature" };
}

/** Which key verified the response, in plain words. */
function keyUsed(kid: string, entry: KeyEntry | null): string {
  return entry
    ? `key ${kid}, in use from ${entry.valid_from} to ${entry.valid_until ?? "today"}`
    : `root key ${kid} of a document without keys, no validity window to check`;
}

// 1. Pay the call. $0.03, no account, no API key: the agent signs a payment
//    authorization on Base and the response is released.
const account = privateKeyToAccount(process.env.TEST_WALLET_KEY as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const payingFetch = wrapFetchWithPayment(fetch, client);

const url = `${BASE}/v1/facturation/dossier?siren=${SIREN}&iban=${IBAN}`;
const res = await payingFetch(url, { signal: AbortSignal.timeout(60_000) });
if (res.status !== 200) {
  console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const body = Buffer.from(await res.arrayBuffer()); // exact bytes, do not re-serialize

// 2. Verify BEFORE reading. The signed message is rebuilt from the headers and
//    the digest of those exact bytes; `JSON.parse` + `JSON.stringify` would
//    reorder or reformat something and break it: that is the classic trap.
const sig: Signature = {
  kid: res.headers.get("x-sirenic-key-id") ?? "",
  timestamp: res.headers.get("x-sirenic-timestamp") ?? "",
  signature: res.headers.get("x-sirenic-signature") ?? "",
};
if (!sig.kid || !sig.timestamp || !sig.signature) throw new Error("response is not signed");

// Kept as the bytes actually served: the archive must hold the key document AS
// PUBLISHED, not our re-rendering of it. Its `keys` list keeps every key that
// has ever signed, so this copy still re-verifies after a key change.
const keyBytes = Buffer.from(
  await (await fetch(`${BASE}/.well-known/sirenic-signing-key`)).arrayBuffer(),
);
const live = verifySignature(body, sig, JSON.parse(keyBytes.toString()) as KeysDocument);
if (!live.valid) {
  console.error(`✘ ${live.reason}: do not trust this payload, do not pay this supplier`);
  process.exit(1);
}
console.log(`✔ signature valid (${keyUsed(sig.kid, live.entry)}, ${sig.timestamp}): authenticated, unmodified`);

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
console.log(`\nSupplier   ${supplier?.denomination ?? "?"} (SIREN ${file.siren}), ${supplier?.etat_administratif ?? "?"}`);
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

// 4. Write the audit file. Under resultats/ by default: the directory this repo
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
writeFileSync(join(dir, "LISEZ-MOI.md"), lisezMoi(url, sig, file.verdict.pret_a_facturer, live.entry));

// 5. Re-verify from disk only, by the same recipe: the entry of its kid in the
//    archived key document. If this fails, the archive proves nothing, so it is
//    a hard failure, not a warning.
const archivedBody = readFileSync(join(dir, "reponse.json"));
const archivedSig = Object.fromEntries(
  readFileSync(join(dir, "signature.txt"), "utf8")
    .trim()
    .split("\n")
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
) as Signature;
const archivedKeys = JSON.parse(readFileSync(join(dir, "cle-publique.json"), "utf8")) as KeysDocument;
const archived = verifySignature(archivedBody, archivedSig, archivedKeys);
if (!archived.valid) {
  console.error(`\n✘ the archive in ${dir}/ does NOT re-verify (${archived.reason}): it is not evidence`);
  process.exit(1);
}
console.log(`\n✔ archive re-verified from its files alone → ${dir}/`);
console.log("  Keep the folder. It re-checks offline, with node or openssl: see LISEZ-MOI.md.");

/**
 * The archive is read by a human (an accountant, an auditor), months later,
 * on a machine that has never heard of Sirenic: hence a French README with
 * the exact commands, and no dependency beyond node or openssl.
 */
function lisezMoi(source: string, sig: Signature, pretAFacturer: boolean, entry: KeyEntry | null): string {
  const cle = entry
    ? `\`${sig.kid}\`, en usage du ${entry.valid_from} au ${entry.valid_until ?? "jour de l'achat (toujours en service)"}, d'après le document des clés archivé ici`
    : `\`${sig.kid}\`, la clé racine d'un document sans liste \`keys\` (aucune fenêtre de jours à contrôler)`;
  return `# Pièce d'audit : dossier de facturation Sirenic

Réponse de \`${source}\`, achetée le ${sig.timestamp} (paiement x402 réglé sur Base).
Verdict au moment de l'achat : **pret_a_facturer = ${pretAFacturer}**.
Clé qui l'a signée : ${cle}.

| Fichier | Contenu |
|---|---|
| \`reponse.json\` | les octets EXACTS du corps signé : ne jamais les reformater, la signature porte sur ces octets-là, pas sur ce JSON « rangé » |
| \`signature.txt\` | \`kid\`, \`timestamp\` et signature Ed25519 (base64), tels que reçus dans les en-têtes |
| \`cle-publique.json\` | le document des clés publiques Sirenic tel que servi sur \`/.well-known/sirenic-signing-key\` : sa liste \`keys\` garde chaque clé qui a jamais signé, avec ses jours d'usage |

Message signé : \`sirenic-v1:{kid}:{timestamp}:{base64(sha256(reponse.json))}\`.
La provenance (registre officiel de chaque bloc et sa date) est **dans le corps
signé** : elle est donc couverte par la même signature que la donnée.

## Re-vérifier cette archive, des mois plus tard, hors ligne et sans Sirenic

Depuis ce dossier, avec Node seul (aucune dépendance, aucun réseau). La recette
prend dans \`keys\` l'entrée dont le \`kid\` est celui de \`signature.txt\`,
contrôle que le jour UTC de l'horodatage tombe dans sa fenêtre (\`valid_from\`
et \`valid_until\`, bornes incluses), puis vérifie la signature avec sa clé :

\`\`\`bash
node -e '
const fs=require("fs"), c=require("crypto");
const corps=fs.readFileSync("reponse.json");
const s={}; for (const l of fs.readFileSync("signature.txt","utf8").trim().split("\\n")) s[l.slice(0,l.indexOf("="))]=l.slice(l.indexOf("=")+1);
const doc=JSON.parse(fs.readFileSync("cle-publique.json","utf8"));
const refus=(m)=>{ console.log("signature INVALIDE : "+m); process.exit(1); };
if (!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z$/.test(s.timestamp)) refus("horodatage mal formé");
const jour=s.timestamp.slice(0,10);
let cle;
if (Array.isArray(doc.keys)) {
  const e=doc.keys.find((k)=>k.kid===s.kid);
  if (!e) refus("kid "+s.kid+" absent de keys");
  if (jour<e.valid_from || (e.valid_until!==null && jour>e.valid_until)) refus("jour "+jour+" hors de la fenêtre de la clé "+s.kid);
  cle=e.public_key;
} else {
  if (doc.kid!==s.kid) refus("document sans keys, dont la racine porte un autre kid");
  cle=doc.public_key;
}
const message="sirenic-v1:"+s.kid+":"+s.timestamp+":"+c.createHash("sha256").update(corps).digest("base64");
const pub=c.createPublicKey({key:Buffer.from(cle,"base64"),format:"der",type:"spki"});
const ok=c.verify(null,Buffer.from(message),pub,Buffer.from(s.signature,"base64"));
console.log(ok ? "signature VALIDE (clé "+s.kid+")" : "signature INVALIDE");
process.exit(ok ? 0 : 1);
'
\`\`\`

Ou avec OpenSSL seul, sans Node. La clé est prise par son \`kid\` dans le
document archivé ; la fenêtre de jours, elle, ne se contrôle que par la recette
Node ci-dessus :

\`\`\`bash
kid=$(grep '^kid=' signature.txt | cut -d= -f2-)
horodatage=$(grep '^timestamp=' signature.txt | cut -d= -f2-)
{ echo "-----BEGIN PUBLIC KEY-----"; grep -o '"kid":"'"$kid"'","alg":"[^"]*","public_key":"[^"]*"' cle-publique.json | head -1 | sed 's/.*"public_key":"//; s/"$//'; echo "-----END PUBLIC KEY-----"; } > cle-publique.pem
grep '^signature=' signature.txt | cut -d= -f2- | base64 -d > signature.bin
printf 'sirenic-v1:%s:%s:%s' "$kid" "$horodatage" "$(openssl dgst -sha256 -binary reponse.json | base64)" > message.txt
openssl pkeyutl -verify -pubin -inkey cle-publique.pem -rawin -in message.txt -sigfile signature.bin
\`\`\`

La seconde commande dérive trois fichiers de travail (\`cle-publique.pem\`,
\`signature.bin\`, \`message.txt\`) : ils se recalculent, seuls les trois fichiers
d'origine font foi. Toute modification d'un seul octet de \`reponse.json\` fait
échouer les deux commandes. Sirenic peut avoir changé de clé depuis l'achat :
\`kid\` dit laquelle a signé, et les deux recettes prennent sa clé dans ce
document, jamais la clé de sa racine (celle du jour où il a été lu). Une copie
plus récente de \`/.well-known/sirenic-signing-key\` garde toujours cette entrée :
elle revérifie ce dossier de la même façon.

## Portée

Aide à la décision déterministe (raisons en liste fermée, tracées à leur
source). Ce n'est ni un avis de conformité fiscale, ni une vérification du nom
du titulaire du compte, qui n'est jamais contrôlé. Sirenic n'est pas une
plateforme agréée (PDP) : elle n'émet, ne transmet ni ne route aucune facture,
et ne confirme pas l'enregistrement du destinataire sur le PPF ou une PDP.

*In English: this folder re-verifies offline with the two commands above. The
signed message is \`sirenic-v1:{kid}:{timestamp}:{base64(sha256(reponse.json))}\`;
the key is the entry of \`keys\` whose kid is the one in \`signature.txt\`, and
the UTC day of the timestamp must fall within its \`valid_from\` and
\`valid_until\`. The recipe is published at \`/.well-known/sirenic-signing-key\`.*
`;
}
