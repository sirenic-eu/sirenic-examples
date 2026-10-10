/**
 * Offline check of the API-key option of the two proof scripts (examples/smoke-test.ts and
 * scripts/payer-un-endpoint.ts), against a FAKE local server: no network, no purchase, no real key.
 *
 *   npx tsx scripts/essai-cle-hors-reseau.ts
 *
 * Each script runs as a child process with SIRENIC_URL pointed at http://127.0.0.1:<port>, in a
 * throwaway working directory, with a preload that REFUSES any fetch to another host (a refused call is
 * counted and fails the check). The fake key and the fake wallet are generated here and never leave the
 * machine; the fake server never answers 402 to the wallet rail, so nothing is ever signed for payment.
 *
 * Checked (kopko13/sirenic ticket 166):
 *   A. key rail: every request carries X-Api-Key, none carries a payment header or the motif header, the
 *      rail is said at the top, the key is never printed, files keep the NN-<rail>-<path> naming, recap.json
 *      says rail "cle" and the credits read from x-credits-charged; a 402 under the key is a reported
 *      failure, never a payment (one request only on that path);
 *   B. key and wallet both set: the key wins, and the output says so;
 *   C. neither key nor wallet: refused before any request;
 *   D. wallet rail: every request carries x-sirenic-motif: smoke-paye and no X-Api-Key, recap.json says "x402";
 *   E. to G. the same for payer-un-endpoint (key, 402, 401 and 403 under the key, debit above the cap, wallet,
 *      neither).
 * Exit code 0 when every check passes, 1 otherwise.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const racine = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsx = join(racine, "node_modules", ".bin", "tsx");
const SMOKE = join(racine, "examples", "smoke-test.ts");
const PAYER = join(racine, "scripts", "payer-un-endpoint.ts");

const FAUSSE_CLE = `sk_essai_${randomBytes(12).toString("hex")}`;
const FAUX_WALLET = `0x${randomBytes(32).toString("hex")}`;
const CHEMIN_402 = "/v1/kyb/552032534";
const ENTETES_PAIEMENT = ["payment-signature", "x-payment"];

// -- Preload: any fetch to a host other than 127.0.0.1 is refused and counted on stderr --------------
const GARDE = `const vrai = globalThis.fetch;
globalThis.fetch = (entree, init) => {
  const brut = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
  const hote = new URL(brut).hostname;
  if (hote !== "127.0.0.1") {
    process.stderr.write("RESEAU REFUSE " + hote + "\\n");
    return Promise.reject(new Error("network refused outside 127.0.0.1: " + hote));
  }
  return vrai(entree, init);
};`;
const PRECHARGE = `--import=data:text/javascript;base64,${Buffer.from(GARDE).toString("base64")}`;

// -- Fake server --------------------------------------------------------------------------------------
interface Requete { url: string; entetes: IncomingMessage["headers"] }
let journal: Requete[] = [];
let mode: { repondre402: boolean; credits: string; refus?: 401 | 403 } = { repondre402: false, credits: "0.010" };

function repondre(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? "/";
  journal.push({ url, entetes: req.headers });
  const chemin = url.split("?")[0] ?? url;
  const json = (statut: number, corps: unknown, credits: string | null = mode.credits): void => {
    const entetes: Record<string, string> = { "content-type": "application/json" };
    if (credits !== null) entetes["x-credits-charged"] = credits;
    res.writeHead(statut, entetes);
    res.end(JSON.stringify(corps));
  };
  const provenance = [{ etat: "servi" }];
  if (mode.repondre402 && chemin === CHEMIN_402) return json(402, { error: "payment_required" }, null);
  if (mode.refus && chemin === CHEMIN_402) return json(mode.refus, { error: mode.refus === 401 ? "cle_invalide" : "acces_refuse" }, null);
  if (chemin.startsWith("/v1/documents/") || chemin.startsWith("/v1/rapport/")) {
    res.writeHead(200, { "content-type": "application/pdf", "x-credits-charged": mode.credits });
    res.end("%PDF-1.4 essai");
    return;
  }
  if (chemin.endsWith("/documents")) return json(200, { provenance, actes: [], bilans: [{ id: "B1" }] });
  if (chemin.endsWith("/comptes")) return json(200, { provenance, nombre_depots: 1, depots: [{ reference: "2025-00000001" }] });
  if (chemin.includes("/comptes/") && url.includes("format=json")) return json(406, { error: "json_indisponible" }, "0");
  if (chemin.includes("/comptes/")) return json(200, { provenance, reference: "2025-00000001" });
  if (chemin === "/v1/marches/expirations") return json(200, { provenance, marches: [{ id: 1 }], total_marches: 1 });
  if (chemin === "/v1/surveillance/creer") return json(200, { provenance, surveillance_id: "jeton-essai" });
  if (chemin.endsWith("/renouveler")) return json(200, { provenance, expire_le: "2026-11-10" });
  if (chemin.endsWith("/arreter")) return json(200, { arretee: true }, null);
  return json(200, { provenance, denomination: "ESSAI" });
}

const serveur = createServer(repondre);
await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", () => ok()));
const adresse = serveur.address();
if (!adresse || typeof adresse === "string") throw new Error("fake server without a port");
const URL_LOCALE = `http://127.0.0.1:${adresse.port}`;

// -- Child runs ---------------------------------------------------------------------------------------
interface Execution { code: number | null; sortie: string; erreurs: string; dossier: string }
function lancer(script: string, args: string[], env: Record<string, string>): Promise<Execution> {
  const dossier = mkdtempSync(join(tmpdir(), "essai-cle-"));
  const propre: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !["SIRENIC_API_KEY", "TEST_WALLET_KEY", "ASSET", "MAX_PRICE"].includes(k)) propre[k] = v;
  }
  return new Promise((ok) => {
    const enfant = spawn(tsx, [script, ...args], {
      cwd: dossier,
      env: { ...propre, NODE_OPTIONS: PRECHARGE, SIRENIC_URL: URL_LOCALE, ...env },
    });
    let sortie = "";
    let erreurs = "";
    enfant.stdout.on("data", (d: Buffer) => (sortie += d.toString()));
    enfant.stderr.on("data", (d: Buffer) => (erreurs += d.toString()));
    enfant.on("close", (code) => ok({ code, sortie, erreurs, dossier }));
  });
}

let echecs = 0;
function verifier(nom: string, condition: boolean, detail = ""): void {
  if (!condition) echecs++;
  console.log(`${condition ? "ok  " : "FAIL"} ${nom}${condition || !detail ? "" : ` (${detail})`}`);
}
const entete = (r: Requete, nom: string): string | undefined => {
  const v = r.entetes[nom];
  return Array.isArray(v) ? v.join(",") : v;
};
const reseauRefuse = (e: Execution): number => (e.erreurs.match(/RESEAU REFUSE/g) ?? []).length;
function fichiersResultats(e: Execution): { noms: string[]; recap: Record<string, unknown> | null } {
  const base = join(e.dossier, "resultats");
  if (!existsSync(base)) return { noms: [], recap: null };
  const sous = readdirSync(base);
  const dossier = sous[0] ? join(base, sous[0]) : null;
  if (!dossier) return { noms: [], recap: null };
  const noms = readdirSync(dossier);
  const recap = noms.includes("recap.json") ? (JSON.parse(readFileSync(join(dossier, "recap.json"), "utf8")) as Record<string, unknown>) : null;
  return { noms, recap };
}
const executions: Execution[] = [];

// A. smoke-test, key rail, one path answered 402
journal = [];
mode = { repondre402: true, credits: "0.010" };
const a = await lancer(SMOKE, [], { SIRENIC_API_KEY: FAUSSE_CLE });
executions.push(a);
console.log("\nA. smoke-test, key rail");
verifier("A exits 0", a.code === 0, `code ${a.code}, stderr ${a.erreurs.slice(0, 200)}`);
verifier("A no network outside 127.0.0.1", reseauRefuse(a) === 0, `${reseauRefuse(a)} refused`);
verifier("A requests reached the fake server", journal.length > 40, `${journal.length} requests`);
verifier("A every request carries X-Api-Key", journal.length > 0 && journal.every((r) => entete(r, "x-api-key") === FAUSSE_CLE));
verifier("A no payment header", journal.every((r) => ENTETES_PAIEMENT.every((h) => entete(r, h) === undefined)));
verifier("A no motif header under the key", journal.every((r) => entete(r, "x-sirenic-motif") === undefined));
verifier("A rail said at the top", /^Rail: API key/m.test(a.sortie.split("\n").slice(0, 3).join("\n")));
verifier("A key never printed", !a.sortie.includes(FAUSSE_CLE) && !a.erreurs.includes(FAUSSE_CLE));
verifier("A 402 under the key reported as a failure", /✗ \[KEY\] \/v1\/kyb\/552032534 → HTTP 402/.test(a.sortie));
verifier("A 402 path requested once (never paid)", journal.filter((r) => r.url === CHEMIN_402).length === 1);
const fa = fichiersResultats(a);
verifier("A files keep the NN-<rail>-<path> naming", fa.noms.some((n) => /^\d{2}-key-entreprise_552032534\.json$/.test(n)), fa.noms.slice(0, 3).join(","));
verifier("A recap.json says rail cle", fa.recap?.rail === "cle", JSON.stringify(fa.recap));
verifier("A recap.json sums x-credits-charged", typeof fa.recap?.credits_debites_usd === "number" && (fa.recap.credits_debites_usd as number) > 0);
verifier("A one failure counted", fa.recap?.echecs === 1, String(fa.recap?.echecs));

// B. smoke-test, key AND wallet: the key wins
journal = [];
mode = { repondre402: false, credits: "0.010" };
const b = await lancer(SMOKE, [], { SIRENIC_API_KEY: FAUSSE_CLE, TEST_WALLET_KEY: FAUX_WALLET, MAX_PRICE: "0.003" });
executions.push(b);
console.log("\nB. smoke-test, key and wallet both set");
verifier("B exits 0", b.code === 0, `code ${b.code}`);
verifier("B the key wins, said in the output", /TEST_WALLET_KEY ignored/.test(b.sortie));
verifier("B every request carries X-Api-Key", journal.length > 0 && journal.every((r) => entete(r, "x-api-key") === FAUSSE_CLE));
verifier("B no network outside 127.0.0.1", reseauRefuse(b) === 0);

// C. smoke-test, neither key nor wallet
journal = [];
const c = await lancer(SMOKE, [], {});
executions.push(c);
console.log("\nC. smoke-test, neither key nor wallet");
verifier("C refused with code 2", c.code === 2, `code ${c.code}`);
verifier("C no request at all", journal.length === 0, `${journal.length} requests`);

// D. smoke-test, wallet rail (the fake server never answers 402: nothing is signed)
journal = [];
const d = await lancer(SMOKE, [], { TEST_WALLET_KEY: FAUX_WALLET });
executions.push(d);
console.log("\nD. smoke-test, wallet rail");
verifier("D exits 0", d.code === 0, `code ${d.code}, stderr ${d.erreurs.slice(0, 200)}`);
verifier("D no network outside 127.0.0.1", reseauRefuse(d) === 0);
verifier("D every request carries x-sirenic-motif: smoke-paye", journal.length > 40 && journal.every((r) => entete(r, "x-sirenic-motif") === "smoke-paye"));
verifier("D no X-Api-Key on the wallet rail", journal.every((r) => entete(r, "x-api-key") === undefined));
verifier("D rail said at the top", /^Rail: x402/m.test(d.sortie.split("\n").slice(0, 3).join("\n")));
const fd = fichiersResultats(d);
verifier("D files keep the NN-<rail>-<path> naming", fd.noms.some((n) => /^\d{2}-usdc-entreprise_552032534\.json$/.test(n)), fd.noms.slice(0, 3).join(","));
verifier("D recap.json says rail x402", fd.recap?.rail === "x402", JSON.stringify(fd.recap));

// E. payer-un-endpoint, key rail
journal = [];
mode = { repondre402: true, credits: "0.010" };
const e = await lancer(PAYER, ["/v1/entreprise/552032534", "0.05"], { SIRENIC_API_KEY: FAUSSE_CLE });
executions.push(e);
console.log("\nE. payer-un-endpoint, key rail");
verifier("E exits 0", e.code === 0, `code ${e.code}, ${e.erreurs.slice(0, 200)}`);
verifier("E one request, with X-Api-Key, no payment header", journal.length === 1 && entete(journal[0]!, "x-api-key") === FAUSSE_CLE && ENTETES_PAIEMENT.every((h) => entete(journal[0]!, h) === undefined));
verifier("E rail said first, then the same HTTP line", /^Rail: API key/.test(e.sortie) && /HTTP 200 en \d+ ms/.test(e.sortie));
verifier("E credits read", /x-credits-charged: 0\.010/.test(e.sortie));
verifier("E key never printed", !e.sortie.includes(FAUSSE_CLE));
journal = [];
const e2 = await lancer(PAYER, [CHEMIN_402, "0.20"], { SIRENIC_API_KEY: FAUSSE_CLE });
executions.push(e2);
verifier("E 402 under the key: failure, code 1, one request", e2.code === 1 && /402/.test(e2.sortie + e2.erreurs) && journal.length === 1);
for (const refus of [401, 403] as const) {
  journal = [];
  mode = { repondre402: false, credits: "0.010", refus };
  const er = await lancer(PAYER, [CHEMIN_402, "0.20"], { SIRENIC_API_KEY: FAUSSE_CLE });
  executions.push(er);
  verifier(
    `E ${refus} under the key: failure, code 1, one request, no payment header`,
    er.code === 1 && new RegExp(`HTTP ${refus}`).test(er.sortie + er.erreurs) && journal.length === 1 && ENTETES_PAIEMENT.every((h) => entete(journal[0]!, h) === undefined),
    `code ${er.code}, ${journal.length} requests`,
  );
}
journal = [];
mode = { repondre402: false, credits: "0.500" };
const e3 = await lancer(PAYER, ["/v1/entreprise/552032534", "0.05"], { SIRENIC_API_KEY: FAUSSE_CLE });
executions.push(e3);
verifier("E debit above the cap: reported, code 1", e3.code === 1 && /0\.500/.test(e3.sortie + e3.erreurs));

// F. payer-un-endpoint, wallet rail
journal = [];
mode = { repondre402: false, credits: "0.010" };
const f = await lancer(PAYER, ["/v1/entreprise/552032534", "0.05"], { TEST_WALLET_KEY: FAUX_WALLET });
executions.push(f);
console.log("\nF. payer-un-endpoint, wallet rail");
verifier("F exits 0", f.code === 0, `code ${f.code}, ${f.erreurs.slice(0, 200)}`);
verifier("F SIRENIC_URL honoured, no network outside 127.0.0.1", reseauRefuse(f) === 0 && journal.length === 1, `${reseauRefuse(f)} refused, ${journal.length} local`);
verifier("F motif header, no X-Api-Key", journal.length === 1 && entete(journal[0]!, "x-sirenic-motif") === "smoke-paye" && entete(journal[0]!, "x-api-key") === undefined);
verifier("F rail said first", /^Rail: x402/.test(f.sortie));

// G. payer-un-endpoint, neither
journal = [];
const g = await lancer(PAYER, ["/v1/entreprise/552032534", "0.05"], {});
executions.push(g);
console.log("\nG. payer-un-endpoint, neither key nor wallet");
verifier("G refused with code 2, no request", g.code === 2 && journal.length === 0, `code ${g.code}, ${journal.length} requests`);

serveur.close();
for (const x of executions) rmSync(x.dossier, { recursive: true, force: true });
console.log(`\n${echecs === 0 ? "ALL CHECKS PASS" : `${echecs} CHECK(S) FAILED`}`);
process.exit(echecs === 0 ? 0 : 1);
