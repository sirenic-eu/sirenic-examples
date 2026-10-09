/**
 * Complete and clean a French customer file in one call: SIREN, head-office SIRET, VAT number with its VIES status,
 * active or ceased, duplicates flagged. One route, `GET /v1/identite/lot`, $0.003 per line, 2 to 300 lines per call.
 *
 * Two questions, one answer:
 *   - before your first French e-invoice: "Here is my customer export: complete and correct SIREN, SIRET and VAT."
 *   - before a sales campaign: "Enrich and clean my CRM: SIREN, VAT, address, ceased companies and duplicates."
 *
 * Input: a CSV file with a header row and the columns ref, siren, siret, tva, nom, code_postal. Any of them may be empty:
 * the first one filled, in that order, makes the line sent (a SIREN, a SIRET, a French VAT number, or name|postcode).
 * Without a file, the script runs on its five built-in neutral lines: companies of Sirenic's reference set, one
 * line per input form, and one invented name. Output: the same rows, plus what the route says of each, written to
 * <input>.enrichi.csv (or customer-file-example.enrichi.csv for the built-in lines).
 *
 * Nothing is chosen for you: an ambiguous name comes back `a_confirmer` with up to 5 ranked candidates, an unknown one
 * `introuvable`. A VAT check that could not start in time says `non_verifie` with `budget_vies_epuise`: run those lines
 * again later, outside French business hours if you can. A refused or unavailable batch is never billed.
 * Sirenic is not an accredited e-invoicing platform: this prepares your file, it sends no invoice.
 *
 * Run with an API key (prepaid credits; this route is not part of the free monthly calls). Create one at
 * https://api.sirenic.eu/compte?lang=en&utm_source=vitrine&utm_campaign=identite-lot
 * Card top-up of credits is not open yet: until it is, the same route is paid per call over x402 (examples/pay-and-call.ts).
 *
 *   SIRENIC_KEY=srn_live_... npx tsx examples/customer-file-identity-batch.ts            # the five built-in lines, $0.015
 *   SIRENIC_KEY=srn_live_... npx tsx examples/customer-file-identity-batch.ts clients.csv
 *
 * Env: SIRENIC_URL (default https://api.sirenic.eu), MAX_USD (default 0.90: a file that would cost more is refused
 * before any call).
 */
import { readFileSync, writeFileSync } from "node:fs";

const API = (process.env.SIRENIC_URL ?? "https://api.sirenic.eu").replace(/\/+$/, "");
const KEY = process.env.SIRENIC_KEY ?? "";
const MAX_USD = Number(process.env.MAX_USD ?? "0.90");
const PRICE_THOUSANDTHS = 3; // $0.003 per line, duplicates included (the route's price list: /en/offres)
const MIN_LINES = 2;
const MAX_LINES = 300;
const MAX_REQUEST_LINE = 10_900; // the route refuses a request line over 11,000 bytes (400 requete_trop_large)

const COLUMNS = ["ref", "siren", "siret", "tva", "nom", "code_postal"] as const;

/** Five neutral lines: SIREN, SIRET of a second site of the same company (a duplicate), VAT number of a ceased company,
 *  name and postcode, and an invented name. Legal entities only, no customer data. */
const EXAMPLE = `ref,siren,siret,tva,nom,code_postal
C-001,552032534,,,,
C-002,,55203253400711,,,
C-003,,,FR48056200454,,
C-004,,,,AIR LIQUIDE CO2 EUROPE,75007
C-005,,,,QXZJW VKPRT,33000
`;

// ---------------------------------------------------------------------------------------------------------------------
// CSV, the RFC 4180 subset a spreadsheet export uses: commas, double quotes, CRLF or LF
// ---------------------------------------------------------------------------------------------------------------------

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

function toCsv(rows: string[][]): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  return rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

// ---------------------------------------------------------------------------------------------------------------------
// The route's answer (closed lists: GET /v1/lecture)
// ---------------------------------------------------------------------------------------------------------------------

interface Candidate { siren: string; denomination: string; etat?: string; score_confiance: number | null }
interface Line {
  rang: number;
  identifiant_lu: "siren" | "siret" | "tva" | "nom_cp";
  resolution: "resolu" | "a_confirmer" | "introuvable" | "siren_invalide" | "siren_inconnu" | "non_diffusible";
  siren?: string;
  doublon_de?: number;
  motif_omission?: string;
  siret_siege?: string;
  denomination?: string;
  etat?: "actif" | "cesse";
  date_cessation?: string;
  motif_date_cessation?: string;
  adresse?: string;
  tva?: { numero: string; vies: string; motif?: string };
  candidats?: Candidate[];
  etages_abandonnes?: string[];
}
interface Batch { nombre_lignes: number; comptes: { resolution: Record<string, number>; doublons: number }; lignes: Line[]; citation?: string }

/** The line sent for one row, or why the row cannot be sent. */
function lineOf(row: Record<string, string>): string | { error: string } {
  const [siren, siret, tva, nom, cp] = [row.siren, row.siret, row.tva, row.nom, row.code_postal].map((v) => (v ?? "").trim());
  const line = siren || siret || tva || (nom && cp ? `${nom}|${cp}` : "");
  if (!line) return { error: "no SIREN, SIRET, VAT number, nor name and postcode" };
  if (line.includes(";")) return { error: "a ';' separates the lines of a batch: remove it from the row" };
  return line;
}

const requestPath = (lines: string[]) => `/v1/identite/lot?${new URLSearchParams({ lignes: lines.join(";") }).toString()}`;

/** Batches of 2 to 300 lines whose request line stays under the route's bound. */
function batches(lines: string[]): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  for (const l of lines) {
    if (current.length > 0 && (current.length === MAX_LINES || `GET ${requestPath([...current, l])} HTTP/1.1`.length > MAX_REQUEST_LINE)) {
      out.push(current);
      current = [];
    }
    current.push(l);
  }
  if (current.length > 0) out.push(current);
  const last = out[out.length - 1]!;
  if (last.length < MIN_LINES && out.length > 1) last.unshift(out[out.length - 2]!.pop()!);
  return out;
}

async function main(): Promise<void> {
  if (!KEY) throw new Error("set SIRENIC_KEY (an API key with prepaid credits): https://api.sirenic.eu/compte?lang=en&utm_source=vitrine&utm_campaign=identite-lot");
  const input = process.argv[2];
  const [header, ...body] = parseCsv(input ? readFileSync(input, "utf8") : EXAMPLE);
  if (!header) throw new Error("empty file");
  const names = header.map((h) => h.trim().toLowerCase());
  const missing = COLUMNS.filter((c) => !names.includes(c));
  if (missing.length > 0) throw new Error(`missing columns: ${missing.join(", ")} (expected: ${COLUMNS.join(", ")})`);
  const rows = body.map((cells) => Object.fromEntries(names.map((n, i) => [n, cells[i] ?? ""])) as Record<string, string>);

  const sent: Array<{ row: number; line: string }> = [];
  rows.forEach((r, i) => {
    const l = lineOf(r);
    if (typeof l === "string") sent.push({ row: i, line: l });
    else console.error(`row ${i + 2}: not sent, ${l.error}`);
  });
  if (sent.length < MIN_LINES) throw new Error(`a batch needs at least ${MIN_LINES} lines, the file has ${sent.length}`);
  const costThousandths = sent.length * PRICE_THOUSANDTHS;
  if (costThousandths > Math.round(MAX_USD * 1000)) {
    throw new Error(`${sent.length} lines cost $${(costThousandths / 1000).toFixed(3)}, over MAX_USD=${MAX_USD}: raise it to go on`);
  }
  console.log(`${sent.length} lines, $${(costThousandths / 1000).toFixed(3)} at most`);

  const results = new Map<number, Line>(); // file row -> the route's line
  const firstRowOf = new Map<string, number>(); // SIREN -> first file row that resolved it, across batches
  let offset = 0;
  for (const batch of batches(sent.map((s) => s.line))) {
    const res = await fetch(`${API}${requestPath(batch)}`, { headers: { "X-Api-Key": KEY } });
    const text = await res.text();
    if (res.status !== 200) {
      // 400 (lot_invalide, lignes_invalides with the refused ranks, requete_trop_large), 402 (no credits left),
      // 503 (a register or VIES is down: nothing billed, run again later). Never billed.
      throw new Error(`HTTP ${res.status}, not billed: ${text.slice(0, 600)}`);
    }
    const answer = JSON.parse(text) as Batch;
    console.log(`batch of ${batch.length}: billed ${res.headers.get("x-credits-charged") ?? "?"} credits; ${JSON.stringify(answer.comptes.resolution)}`);
    if (answer.citation) console.log(`source: ${answer.citation}`);
    for (const l of answer.lignes) {
      const row = sent[offset + l.rang - 1]!.row;
      const line: Line = { ...l };
      if (l.doublon_de !== undefined) line.doublon_de = sent[offset + l.doublon_de - 1]!.row;
      else if (l.siren && l.resolution === "resolu") {
        const first = firstRowOf.get(l.siren);
        if (first !== undefined) line.doublon_de = first; // same company in an earlier batch
        else firstRowOf.set(l.siren, row);
      }
      results.set(row, line);
    }
    offset += batch.length;
  }

  const added = ["resolution", "siren_resolu", "siret_siege", "denomination", "etat", "date_cessation", "adresse",
    "tva_numero", "tva_vies", "tva_motif", "doublon_de_ligne", "candidats", "note"];
  const out: string[][] = [[...header, ...added]];
  rows.forEach((r, i) => {
    const l = results.get(i);
    const note = [
      l?.etages_abandonnes?.length ? `index stages not read: ${l.etages_abandonnes.join(" ")}` : "",
      l?.motif_omission ?? "",
      l?.motif_date_cessation ? `cessation date: ${l.motif_date_cessation}` : "",
      l ? "" : "not sent",
    ].filter(Boolean).join("; ");
    out.push([
      ...names.map((n) => r[n] ?? ""),
      l?.resolution ?? "",
      l?.siren ?? "",
      l?.siret_siege ?? "",
      l?.denomination ?? "",
      l?.etat ?? "",
      l?.date_cessation ?? "",
      l?.adresse ?? "",
      l?.tva?.numero ?? "",
      l?.tva?.vies ?? "",
      l?.tva?.motif ?? "",
      l?.doublon_de !== undefined ? String(l.doublon_de + 2) : "", // spreadsheet row number (header is row 1)
      (l?.candidats ?? []).map((c) => `${c.siren}:${c.score_confiance ?? ""}`).join(" "),
      note,
    ]);
  });
  const target = input ? input.replace(/\.csv$/i, "") + ".enrichi.csv" : "customer-file-example.enrichi.csv";
  writeFileSync(target, toCsv(out));
  console.log(`written: ${target}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
