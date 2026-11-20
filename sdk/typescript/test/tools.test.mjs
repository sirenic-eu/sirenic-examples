// The LangChain.js tools: names, the path each one calls, and the prices their descriptions state.
//
// Prices are compared with the `x-price` of each route in the OpenAPI served by
// api.sirenic.eu: the copy recorded in test/fixtures/openapi-prix.json by
// default, the live document with SIRENIC_OPENAPI_LIVE=1 (one free GET, no key).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Sirenic, sirenicTools } from "../dist/index.js";
import { CLE_FACTICE, charger, chargerIci, sansReseau } from "./harness.mjs";

const LIVE = process.env.SIRENIC_OPENAPI_LIVE === "1";
const fetchReel = globalThis.fetch;

beforeEach(sansReseau);

const ROUTES = {
  sirenic_search_companies: "/v1/recherche",
  sirenic_company_profile: "/v1/entreprise/{siren}",
  sirenic_kyb_file: "/v1/kyb/{siren}",
  sirenic_screen_sanctions: "/v1/sanctions/check",
  sirenic_amf_alerts: "/v1/regulateurs/fr/alertes",
  sirenic_eu_financial_authorisations: "/v1/eu/agrements",
  sirenic_invoice_file_france: "/v1/facturation/dossier",
  sirenic_invoice_file_europe: "/v1/eu/facturation/dossier",
  sirenic_company_licences: "/v1/entreprise/{siren}/agrements",
  sirenic_belgian_insider_transactions: "/v1/eu/entreprise/{pays}/{id}/transactions-dirigeants",
  sirenic_company_intelligence: "/v1/intelligence/{siren}",
  sirenic_create_watch: "/v1/surveillance/creer",
};

/** Every request answers the same recorded quote: the tools run on the quote-only rail. */
function devisPartout() {
  const devis = charger("entreprise-402");
  const vues = [];
  const fn = async (adresse) => {
    vues.push(String(adresse));
    return new Response(JSON.stringify(devis.body), { status: 402, headers: devis.headers });
  };
  fn.vues = vues;
  return fn;
}

function outil(tools, nom) {
  const t = tools.find((x) => x.name === nom);
  assert.ok(t, nom);
  return t;
}

test("thirteen tools, built from options or from a client", () => {
  const noms = sirenicTools().map((t) => t.name);
  assert.deepEqual(new Set(noms), new Set([...Object.keys(ROUTES), "sirenic_get"]));
  assert.equal(noms.length, 13);
  const client = new Sirenic({ apiKey: CLE_FACTICE });
  assert.equal(sirenicTools(client).length, 13);
});

test("each tool calls its route, arguments encoded", async () => {
  const fetch = devisPartout();
  const tools = sirenicTools({ fetch });
  const appels = [
    ["sirenic_search_companies", { q: "danone sa" }, "/v1/recherche?q=danone%20sa"],
    ["sirenic_company_profile", { siren: "552032534", geo: true }, "/v1/entreprise/552032534?geo=true"],
    ["sirenic_kyb_file", { siren: "552032534" }, "/v1/kyb/552032534"],
    ["sirenic_screen_sanctions", { name: "Jean Dupont", birth_year: "1970" }, "/v1/sanctions/check?name=Jean+Dupont&birth_year=1970"],
    ["sirenic_amf_alerts", { nom: "Exemple" }, "/v1/regulateurs/fr/alertes?nom=Exemple"],
    ["sirenic_eu_financial_authorisations", { q: "Natixis", pays: "FR" }, "/v1/eu/agrements?q=Natixis&pays=FR"],
    ["sirenic_invoice_file_france", { siren: "552032534" }, "/v1/facturation/dossier?siren=552032534"],
    ["sirenic_invoice_file_europe", { pays: "BE", id: "0403170701" }, "/v1/eu/facturation/dossier?pays=BE&id=0403170701"],
    ["sirenic_company_licences", { siren: "552032534" }, "/v1/entreprise/552032534/agrements"],
    ["sirenic_belgian_insider_transactions", { id: "0403170701" }, "/v1/eu/entreprise/BE/0403170701/transactions-dirigeants"],
    ["sirenic_company_intelligence", { siren: "552032534" }, "/v1/intelligence/552032534"],
    ["sirenic_create_watch", { cibles: "552032534", duree: 90 }, "/v1/surveillance/creer?cibles=552032534&duree=90"],
    ["sirenic_get", { path: "/v1/entreprise/552032534/lobbying" }, "/v1/entreprise/552032534/lobbying"],
  ];
  for (const [nom, args, chemin] of appels) {
    const sortie = JSON.parse(await outil(tools, nom).invoke(args));
    assert.equal(sortie.payment_required, true, nom);
    assert.equal(fetch.vues.at(-1), `https://api.sirenic.eu${chemin}`, nom);
  }
  assert.equal(fetch.vues.length, appels.length);
});

async function prixServis() {
  if (!LIVE) return chargerIci("openapi-prix").body.paths;
  const reponse = await fetchReel("https://api.sirenic.eu/openapi.json");
  assert.equal(reponse.status, 200);
  return (await reponse.json()).paths;
}

const DOLLARS = /\$\d+(?:\.\d+)?/g;

test(`prices in the descriptions are the served prices (${LIVE ? "live OpenAPI" : "recorded OpenAPI"})`, async () => {
  const paths = await prixServis();
  const tools = sirenicTools();
  for (const [nom, route] of Object.entries(ROUTES)) {
    const servi = paths[route]?.get?.["x-price"];
    assert.ok(servi, `${route} has an x-price`);
    const dits = outil(tools, nom).description.match(DOLLARS) ?? [];
    assert.ok(dits.length > 0, `${nom} states a price`);
    const servis = new Set(servi.match(DOLLARS));
    for (const d of dits) assert.ok(servis.has(d), `${nom}: ${d} is not in the served price "${servi}"`);
    if (nom !== "sirenic_create_watch") assert.deepEqual(dits, [servi], nom);
  }
  // The generic tool names routes with their price: "/v1/... $0.01".
  const generique = outil(tools, "sirenic_get").description;
  const paires = [...generique.matchAll(/(\/v1\/\S+) (\$\d+(?:\.\d+)?)/g)];
  assert.ok(paires.length >= 8);
  for (const [, route, prix] of paires) {
    assert.equal(paths[route]?.get?.["x-price"], prix, route);
  }
  const exemple = generique.match(/Free sample: (\/preview\/\S+?)\.?$/)?.[1];
  assert.ok(exemple && paths[exemple], "the free sample is a served route");
});

test("no long dash and no stale wording in the descriptions", () => {
  for (const t of sirenicTools()) {
    assert.ok(!t.description.includes("—"), t.name);
    assert.ok(!/telecom operator/i.test(t.description), t.name);
  }
});
