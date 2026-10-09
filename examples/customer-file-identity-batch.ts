/**
 * Complete and clean a French customer file in one call: SIREN, head-office SIRET, VAT number with its VIES status,
 * active or ceased, duplicates flagged. One route, `GET /v1/identite/lot`, $0.003 per line, 2 to 300 lines per call; a call
 * of up to 50 lines is one of the free monthly calls of a verified account's API key.
 *
 * Two questions, one answer:
 *   - before your first French e-invoice: "Here is my customer export: complete and correct SIREN, SIRET and VAT."
 *   - before a sales campaign: "Enrich and clean my CRM: SIREN, VAT, address, ceased companies and duplicates."
 *
 * Input: a CSV file with a header row and the columns ref, siren, siret, tva, nom, code_postal, separated by commas or by
 * semicolons (a French spreadsheet export; the output keeps the separator of the header row). Any column may be empty: the
 * first READABLE one, in that order, makes the line sent (a SIREN, a SIRET, a French VAT number, or name|postcode). A cell the
 * route would refuse (N/A, a town in code_postal) would make it refuse the whole batch: it is left out, named in the row's
 * note, and a row without any readable cell is not sent; a line the route still refuses (400 lignes_invalides, which names
 * its rank) is marked the same way, and the rest of its batch sent once more. Without a file, the script runs on its five
 * built-in neutral lines: companies of Sirenic's reference set, one line per input form, and one invented name. Output: the
 * same rows, plus what the route says of each, written to <input>.enrichi.csv (or customer-file-example.enrichi.csv for the
 * built-in lines). A duplicate points to the spreadsheet row of the first line of the same company, across batches.
 *
 * If a batch fails (402: no free call left this month and no credits; 503: a register or VIES is down; never billed; or no
 * answer at all), the script stops there and still writes the CSV: the rows of the batches already done, the others marked
 * "not sent". Every row not sent is also written to <input>.not-sent.csv, to run again alone, without paying twice for the
 * rows already done.
 *
 * Nothing is chosen for you: an ambiguous name comes back `a_confirmer` with up to 5 ranked candidates, an unknown one
 * `introuvable`. A VAT check that could not start in time says `non_verifie` with `budget_vies_epuise`: run those lines
 * again later, outside French business hours if you can. A refused or unavailable batch is never billed.
 * Sirenic is not an accredited e-invoicing platform: this prepares your file, it sends no invoice.
 *
 * Run with the API key of a verified account. A call of up to 50 lines is one of its 150 free calls a month, nothing
 * debited; a larger call, or any call once the month's free calls are used, is paid from prepaid credits. The script sends
 * 50 lines per call by default (BATCH_LINES), so that a file of up to 7,500 lines can go through the free calls of a month.
 * Create a key at https://api.sirenic.eu/compte?lang=en&utm_source=vitrine&utm_campaign=identite-lot
 * Card top-up of credits is not open yet: until it is, a call outside the free calls is paid per call over x402
 * (examples/pay-and-call.ts).
 *
 *   SIRENIC_KEY=srn_live_... npx tsx examples/customer-file-identity-batch.ts            # the five built-in lines, $0.015
 *   SIRENIC_KEY=srn_live_... npx tsx examples/customer-file-identity-batch.ts clients.csv
 *
 * Env: SIRENIC_URL (default https://api.sirenic.eu), MAX_USD (default 0.90: a file that would cost more, counted at $0.003
 * per line as if no call were free, is refused before any call; a number with a dot, anything else is refused before any
 * call too), BATCH_LINES (lines per call, 2 to 300, default 50: the largest call in the free monthly quota; anything else
 * is refused before any call).
 */
import { readFileSync, writeFileSync } from "node:fs";

const API = (process.env.SIRENIC_URL ?? "https://api.sirenic.eu").replace(/\/+$/, "");
const KEY = process.env.SIRENIC_KEY ?? "";
const PRICE_THOUSANDTHS = 3; // $0.003 per line, duplicates included (the route's price list: /en/offres)
const MIN_LINES = 2;
const MAX_LINES = 300;
const FREE_QUOTA_LINES = 50; // a call of up to 50 lines is one of a verified account's free monthly calls
const MAX_REQUEST_LINE = 10_900; // the route refuses a request line over 11,000 bytes (400 requete_trop_large)

const COLUMNS = ["ref", "siren", "siret", "tva", "nom", "code_postal"] as const;

/** MAX_USD, a plain number with a dot. Anything else (0,90 or a word) refuses the run before any call: never NaN, which no
 *  cost exceeds, so that the cap would be skipped. */
function maxUsd(): number {
  const raw = (process.env.MAX_USD ?? "0.90").trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error(`MAX_USD must be a number with a dot, e.g. 0.90 (got "${raw}"): nothing sent`);
  return Number(raw);
}

/** BATCH_LINES, the lines sent per call: 50 by default (each call is then free while the month's free calls last), up to 300.
 *  Anything else refuses the run before any call. */
function batchLines(): number {
  const raw = (process.env.BATCH_LINES ?? String(FREE_QUOTA_LINES)).trim();
  const n = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(n >= MIN_LINES && n <= MAX_LINES)) throw new Error(`BATCH_LINES must be a whole number from ${MIN_LINES} to ${MAX_LINES} (got "${raw}"): nothing sent`);
  return n;
}

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
// CSV, the RFC 4180 subset a spreadsheet export uses: commas (or semicolons), double quotes, CRLF or LF
// ---------------------------------------------------------------------------------------------------------------------

/** The separator of the header row: a semicolon when it has more semicolons than commas (a French export), else a comma. */
function separatorOf(text: string): "," | ";" {
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  return (header.match(/;/g)?.length ?? 0) > (header.match(/,/g)?.length ?? 0) ? ";" : ",";
}

function parseCsv(text: string, separator: string): string[][] {
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
    else if (c === separator) { row.push(field); field = ""; }
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

function toCsv(rows: string[][], separator: string): string {
  const cell = (v: string) => (v.includes('"') || v.includes(separator) || /[\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  return rows.map((r) => r.map(cell).join(separator)).join("\n") + "\n";
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

/** An identifier cell as the route reads it: 9 digits (SIREN), 14 (SIRET) or FR and 11 digits (VAT), spaces, dots and hyphens
 *  between groups allowed. */
const readableId = (cell: string): boolean => /^(?:\d{9}|\d{14}|FR\d{11})$/i.test(cell.replace(/[\s.\-]/gu, ""));

/** A name and postcode as the route reads them: a postcode of 5 digits (4 when a spreadsheet dropped the leading zero), a name
 *  of at most 100 characters with a letter or a digit, and no ";" (it separates the lines of a batch). */
const readableName = (nom: string, cp: string): boolean => /^\d{4,5}$/.test(cp) && /[\p{L}\p{N}]/u.test(nom) && !nom.includes(";") && [...nom].length <= 100;

/** The line sent for one row (the first readable cell among siren, siret, tva, then nom with code_postal), or none; and the
 *  cells left out, for the row's note. */
function lineOf(row: Record<string, string>): { line: string | null; unreadable: string[] } {
  const unreadable: string[] = [];
  for (const column of ["siren", "siret", "tva"] as const) {
    const cell = (row[column] ?? "").trim();
    if (!cell) continue;
    if (readableId(cell)) return { line: cell, unreadable };
    unreadable.push(`${column} "${cell}" unreadable`);
  }
  const [nom, cp] = [(row.nom ?? "").trim(), (row.code_postal ?? "").trim()];
  if (nom || cp) {
    if (readableName(nom, cp)) return { line: `${nom}|${cp}`, unreadable };
    unreadable.push(`nom and code_postal "${nom}|${cp}" unreadable`);
  }
  if (unreadable.length === 0) unreadable.push("no SIREN, SIRET, VAT number, nor name and postcode");
  return { line: null, unreadable };
}

const requestPath = (lines: string[]) => `/v1/identite/lot?${new URLSearchParams({ lignes: lines.join(";") }).toString()}`;

interface Sent { row: number; line: string }

/** Batches of 2 to `perCall` lines whose request line stays under the route's bound. */
function batches(lines: Sent[], perCall: number): Sent[][] {
  const out: Sent[][] = [];
  let current: Sent[] = [];
  for (const l of lines) {
    if (current.length > 0 && (current.length === perCall || `GET ${requestPath([...current, l].map((s) => s.line))} HTTP/1.1`.length > MAX_REQUEST_LINE)) {
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

/** One call of the route; the body read as JSON when it is JSON. Never throws: no answer (network down, connection cut)
 *  comes back as status 0, so that the batches already done are still written. */
async function call(batch: Sent[]): Promise<{ status: number; text: string; json: Record<string, unknown> | null; charged: string | null }> {
  try {
    const res = await fetch(`${API}${requestPath(batch.map((s) => s.line))}`, { headers: { "X-Api-Key": KEY } });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = null; }
    return { status: res.status, text, json, charged: res.headers.get("x-credits-charged") };
  } catch (e: unknown) {
    return { status: 0, text: e instanceof Error ? e.message : String(e), json: null, charged: null };
  }
}

async function main(): Promise<void> {
  const cap = maxUsd();
  const perCall = batchLines();
  if (!KEY) throw new Error("set SIRENIC_KEY (the API key of a verified account: a call of up to 50 lines is one of its free monthly calls): https://api.sirenic.eu/compte?lang=en&utm_source=vitrine&utm_campaign=identite-lot");
  const input = process.argv[2];
  const text = input ? readFileSync(input, "utf8") : EXAMPLE;
  const separator = separatorOf(text);
  const [header, ...body] = parseCsv(text, separator);
  if (!header) throw new Error("empty file");
  const names = header.map((h) => h.trim().toLowerCase());
  const missing = COLUMNS.filter((c) => !names.includes(c));
  if (missing.length > 0) throw new Error(`missing columns: ${missing.join(", ")} (expected: ${COLUMNS.join(", ")}, separated by commas or semicolons)`);
  const rows = body.map((cells) => Object.fromEntries(names.map((n, i) => [n, cells[i] ?? ""])) as Record<string, string>);

  const sent: Sent[] = [];
  const unreadable = new Map<number, string[]>(); // file row -> cells left out
  rows.forEach((r, i) => {
    const { line, unreadable: left } = lineOf(r);
    if (left.length > 0) unreadable.set(i, left);
    if (line !== null) sent.push({ row: i, line });
    else console.error(`row ${i + 2}: not sent, ${left.join("; ")}`);
  });
  if (sent.length < MIN_LINES) throw new Error(`a batch needs at least ${MIN_LINES} readable lines, the file has ${sent.length}`);
  const costThousandths = sent.length * PRICE_THOUSANDTHS;
  if (costThousandths > Math.round(cap * 1000)) {
    throw new Error(`${sent.length} lines cost $${(costThousandths / 1000).toFixed(3)}, over MAX_USD=${cap}: raise it to go on`);
  }
  const plan = batches(sent, perCall);
  const calls = `${plan.length} call${plan.length > 1 ? "s" : ""}`;
  const free = plan.every((b) => b.length <= FREE_QUOTA_LINES) ? ", nothing for the calls that are free calls of a verified account this month" : "";
  console.log(`${sent.length} lines in ${calls} of up to ${perCall} lines: $${(costThousandths / 1000).toFixed(3)} at most${free}`);

  const results = new Map<number, Line>(); // file row -> the route's line
  const notSent = new Map<number, string>(); // file row -> why it was not sent
  const firstRowOf = new Map<string, number>(); // SIREN -> first file row that identified it, across batches
  let failure: string | null = null;
  for (const batch of plan) {
    if (failure !== null) {
      for (const s of batch) notSent.set(s.row, failure);
      continue;
    }
    let lines = batch;
    let res = await call(lines);
    // A cell read differently from the route: the refused ranks, named in the body, are left out and the rest sent once more.
    const refused = res.status === 400 && res.json?.error === "lignes_invalides" ? (res.json.lignes_refusees as Array<{ rang: number; motif: string }> | undefined) ?? [] : null;
    if (refused !== null && refused.length > 0 && refused.length === res.json?.nombre_lignes_refusees) {
      for (const r of refused) notSent.set(lines[r.rang - 1]!.row, `refused by the route: ${r.motif}`);
      const ranks = new Set(refused.map((r) => r.rang));
      lines = lines.filter((_, i) => !ranks.has(i + 1));
      if (lines.length < MIN_LINES) {
        for (const s of lines) notSent.set(s.row, `fewer than ${MIN_LINES} readable lines left in its batch`);
        continue;
      }
      res = await call(lines);
    }
    if (res.status !== 200) {
      // 400 (lot_invalide, lignes_invalides, requete_trop_large), 402 (no free call nor credits left), 503 (a register or VIES is down: run
      // these rows again later). Never billed. The batches already done are kept and written below.
      const error = typeof res.json?.error === "string" ? ` ${res.json.error}` : "";
      // No answer at all: the batch may have been served and billed before the connection broke; the account says.
      failure = res.status === 0 ? `no answer (${res.text}), check the credits charged before sending these rows again` : `HTTP ${res.status}${error}, not billed`;
      console.error(`batch of ${lines.length}: ${failure}: ${res.text.slice(0, 600)}`);
      for (const s of lines) notSent.set(s.row, failure);
      continue;
    }
    const answer = res.json as unknown as Batch;
    console.log(`batch of ${lines.length}: billed ${res.charged ?? "?"} credits; ${JSON.stringify(answer.comptes.resolution)}`);
    if (answer.citation) console.log(`source: ${answer.citation}`);
    for (const l of [...answer.lignes].sort((a, b) => a.rang - b.rang)) {
      const row = lines[l.rang - 1]!.row;
      const line: Line = { ...l };
      // The route's doublon_de is a rank in this batch. A line that identifies a company (resolu or non_diffusible: the route
      // names its SIREN, duplicates included) points instead to the first row of that SIREN in the whole file, in this batch
      // or an earlier one.
      delete line.doublon_de;
      if (l.siren && (l.resolution === "resolu" || l.resolution === "non_diffusible")) {
        const first = firstRowOf.get(l.siren);
        if (first !== undefined) line.doublon_de = first;
        else firstRowOf.set(l.siren, row);
      }
      results.set(row, line);
    }
  }

  const added = ["resolution", "siren_resolu", "siret_siege", "denomination", "etat", "date_cessation", "adresse",
    "tva_numero", "tva_vies", "tva_motif", "doublon_de_ligne", "candidats", "note"];
  const out: string[][] = [[...header, ...added]];
  const rest: string[][] = [header];
  rows.forEach((r, i) => {
    const l = results.get(i);
    const note = [
      ...(unreadable.get(i) ?? []),
      l?.etages_abandonnes?.length ? `index stages not read: ${l.etages_abandonnes.join(" ")}` : "",
      l?.motif_omission ?? "",
      l?.motif_date_cessation ? `cessation date: ${l.motif_date_cessation}` : "",
      l ? "" : `not sent${notSent.has(i) ? `: ${notSent.get(i)}` : ""}`,
    ].filter(Boolean).join("; ");
    if (!l) rest.push(names.map((n) => r[n] ?? ""));
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
  const base = input ? input.replace(/\.csv$/i, "") : "customer-file-example";
  writeFileSync(`${base}.enrichi.csv`, toCsv(out, separator));
  console.log(`written: ${base}.enrichi.csv`);
  if (rest.length > 1) {
    writeFileSync(`${base}.not-sent.csv`, toCsv(rest, separator));
    console.log(`${rest.length - 1} rows not sent, written to ${base}.not-sent.csv: fix the unreadable ones, then run that file alone (the rows already done are not billed twice)`);
  }
  if (failure !== null) throw new Error(`stopped at a failed batch (${failure}); the batches already done are written`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
