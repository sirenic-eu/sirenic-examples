// Test harness: no network, ever.
//
// Every HTTP exchange is served by `faux()` from the fixtures of the Python
// client (sdk/python-sirenic/tests/fixtures): responses recorded from the live
// service on 2026-10-05, or written from the served code when a status cannot
// be provoked, and marked so in their `origin` field. Any address that was
// not recorded is refused, and the global fetch throws for the whole run.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(ICI, "..", "..", "python-sirenic", "tests", "fixtures");
export const CLE_FACTICE = "srn_live_placeholder_for_tests"; // not a key: the fake accepts any value

export function charger(nom) {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${nom}.json`), "utf8"));
}

export function chargerIci(nom) {
  return JSON.parse(readFileSync(path.join(ICI, "fixtures", `${nom}.json`), "utf8"));
}

/** No test reaches the network: the global fetch throws, and no key comes from the environment. */
export function sansReseau() {
  globalThis.fetch = async () => {
    throw new Error("network access attempted during the tests");
  };
  delete process.env.SIRENIC_API_KEY;
}

function cle(url) {
  const u = new URL(url);
  const q = [...u.searchParams.entries()].sort(([a, x], [b, y]) => (a + x < b + y ? -1 : 1));
  return `${u.protocol}//${u.host.toLowerCase()}${u.pathname}?${new URLSearchParams(q)}`;
}

/**
 * A fetch that only serves recorded fixtures.
 *
 * `paiement` decides how a retried call that carries an x402 payment header is
 * answered: null refuses it, "accepte" serves the response recorded with the
 * API key for the same address (same route, same content: a simulation, no
 * payment was ever made), "refuse" serves the recorded 402 quote again.
 * `redirections` maps an exact address to a Location served with a 302.
 */
export function faux(fixtures, { paiement = null, redirections = {} } = {}) {
  const table = new Map();
  for (const f of fixtures) {
    const k = `${f.request.auth}|${f.request.x_api_key ?? ""}|${cle(f.request.url)}`;
    if (table.has(k)) throw new Error(`two fixtures for ${k}`);
    table.set(k, f);
  }
  const vues = [];
  const fn = async (adresse, init = {}) => {
    const url = String(adresse);
    const h = new Headers(init.headers);
    vues.push({ url, headers: Object.fromEntries(h.entries()), redirect: init.redirect });
    if (redirections[url]) {
      return new Response(null, { status: 302, headers: { location: redirections[url] } });
    }
    const k = cle(url);
    let f;
    if (h.has("payment-signature") || h.has("x-payment")) {
      if (paiement === "accepte") f = table.get(`api_key||${k}`);
      else if (paiement === "refuse") f = table.get(`none||${k}`);
    } else if (h.has("x-api-key")) {
      f = table.get(`api_key|${h.get("x-api-key")}|${k}`) ?? table.get(`api_key||${k}`);
    } else {
      f = table.get(`none||${k}`);
    }
    if (!f) throw new Error(`UnrecordedRequest: no recorded response for GET ${url}`);
    const corps = typeof f.body === "string" ? f.body : JSON.stringify(f.body);
    return new Response(corps, { status: f.status, headers: f.headers });
  };
  fn.vues = vues;
  return fn;
}
