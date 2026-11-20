// The Sirenic client on the API key, wallet (x402) and quote-only rails, without network.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generatePrivateKey } from "viem/accounts";
import {
  decodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
} from "@x402/core/http";
import { Sirenic, VERSION, DEFAULT_BASE_URL } from "../dist/index.js";
import { CLE_FACTICE, charger, faux, sansReseau } from "./harness.mjs";

const AIRVANCE = "490586708";
const BASE = DEFAULT_BASE_URL;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const EURC_BASE = "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42";
const EURC_ETHEREUM = "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c"; // EURC on Ethereum mainnet: not paid by the client

beforeEach(sansReseau);

/** A 402 fixture whose options are rewritten, in the body and in the PAYMENT-REQUIRED header. */
function devisModifie(nom, modifier) {
  const f = structuredClone(charger(nom));
  const entete = decodePaymentRequiredHeader(f.headers["payment-required"]);
  entete.accepts = modifier(entete.accepts);
  f.headers["payment-required"] = encodePaymentRequiredHeader(entete);
  f.body.accepts = modifier(f.body.accepts);
  f.origin = `written from ${nom}: options rewritten by the test`;
  return f;
}

test("version", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, "0.3.0");
  assert.equal(pkg.version, VERSION);
});

test("one rail per client, read from the options or the environment", () => {
  assert.equal(new Sirenic().rail, "quote");
  assert.equal(new Sirenic({ apiKey: CLE_FACTICE }).rail, "api_key");
  assert.equal(new Sirenic({ walletKey: generatePrivateKey() }).rail, "x402");
  process.env.SIRENIC_API_KEY = CLE_FACTICE;
  assert.equal(new Sirenic().rail, "api_key");
  assert.equal(new Sirenic({ walletKey: generatePrivateKey() }).rail, "x402", "a wallet given wins over the environment");
  assert.throws(() => new Sirenic({ apiKey: CLE_FACTICE, walletKey: generatePrivateKey() }), /not both/);
  assert.throws(() => new Sirenic({ apiKey: "srn_live_a b" }), /whitespace/);
});

test("caps and base URL are checked at construction", () => {
  for (const mauvais of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "1"]) {
    assert.throws(() => new Sirenic({ maxCredits: mauvais }), /maxCredits/);
    assert.throws(() => new Sirenic({ maxPriceUsd: mauvais }), /maxPriceUsd/);
  }
  assert.equal(new Sirenic({ maxCredits: null }).maxCredits, null);
  assert.equal(new Sirenic().maxCredits, 1.0);
  assert.throws(() => new Sirenic({ baseUrl: "http://api.sirenic.eu" }), /https/);
  assert.throws(() => new Sirenic({ baseUrl: "https://api.sirenic.eu/?x=1" }), /https/);
  assert.equal(new Sirenic({ baseUrl: "http://127.0.0.1:8787/" }).baseUrl, "http://127.0.0.1:8787");
});

test("key rail under the default cap: free quote without the key, then the call with the key", async () => {
  const fetch = faux([charger("entreprise-402"), charger("entreprise-200-cle")]);
  const client = new Sirenic({ apiKey: CLE_FACTICE, fetch });
  const sortie = JSON.parse(await client.get(`/v1/entreprise/${AIRVANCE}`));
  assert.deepEqual(sortie, charger("entreprise-200-cle").body);
  assert.equal(fetch.vues.length, 2);
  assert.equal(fetch.vues[0].headers["x-api-key"], undefined, "the quote request carries no key");
  assert.equal(fetch.vues[1].headers["x-api-key"], CLE_FACTICE);
  assert.match(fetch.vues[1].headers["user-agent"], /^sirenic-agents-js\/0\.3\.0$/);
  assert.ok(fetch.vues.every((v) => v.redirect === "manual"));
});

test("key rail: a price above maxCredits is not called, nothing is charged", async () => {
  const fetch = faux([charger("kyb-402"), charger("kyb-200-cle")]);
  const client = new Sirenic({ apiKey: CLE_FACTICE, maxCredits: 0.1, fetch });
  const sortie = JSON.parse(await client.get(`/v1/kyb/${AIRVANCE}`));
  assert.equal(sortie.payment_required, true);
  assert.equal(sortie.price_cap_exceeded, true);
  assert.equal(sortie.credits, 0.15);
  assert.equal(sortie.max_credits, 0.1);
  assert.ok(Array.isArray(sortie.quote.accepts));
  assert.equal(fetch.vues.length, 1);
  assert.equal(fetch.vues[0].headers["x-api-key"], undefined);
});

test("key rail: a price equal to maxCredits is called", async () => {
  const fetch = faux([charger("kyb-402"), charger("kyb-200-cle")]);
  const client = new Sirenic({ apiKey: CLE_FACTICE, maxCredits: 0.15, fetch });
  const sortie = JSON.parse(await client.get(`/v1/kyb/${AIRVANCE}`));
  assert.deepEqual(sortie, charger("kyb-200-cle").body);
  assert.equal(fetch.vues.length, 2);
});

test("key rail with maxCredits null: one request, with the key", async () => {
  const fetch = faux([charger("facturation-200-cle")]);
  const client = new Sirenic({ apiKey: CLE_FACTICE, maxCredits: null, fetch });
  const sortie = JSON.parse(await client.get(`/v1/facturation/dossier?siren=${AIRVANCE}`));
  assert.deepEqual(sortie, charger("facturation-200-cle").body);
  assert.equal(fetch.vues.length, 1);
  assert.equal(fetch.vues[0].headers["x-api-key"], CLE_FACTICE);
});

test("key rail: a free route is answered by the quote request, the key is never sent", async () => {
  const fetch = faux([charger("suggestions-nom-200")]);
  const client = new Sirenic({ apiKey: CLE_FACTICE, fetch });
  const sortie = JSON.parse(await client.get("/v1/suggestions?q=airvance"));
  assert.deepEqual(sortie, charger("suggestions-nom-200").body);
  assert.equal(fetch.vues.length, 1);
  assert.equal(fetch.vues[0].headers["x-api-key"], undefined);
});

test("key rail: an error of the quote request is returned, the paid call is not made", async () => {
  const fetch = faux([charger("suggestions-400")]);
  const client = new Sirenic({ apiKey: CLE_FACTICE, fetch });
  const sortie = JSON.parse(await client.get("/v1/suggestions?q=ai"));
  assert.equal(sortie.error, "http_error");
  assert.equal(sortie.status, 400);
  assert.equal(sortie.code, "parametre_invalide");
  assert.equal(fetch.vues.length, 1);
});

test("key rail: a price not quoted without a key (401 compte_requis) is not called under a cap", async () => {
  const fetch = faux([charger("actes-401")]);
  const client = new Sirenic({ apiKey: CLE_FACTICE, fetch });
  const sortie = JSON.parse(await client.get("/v1/documents/actes/000000000000000000000000"));
  assert.equal(sortie.price_cap_exceeded, true);
  assert.equal(sortie.credits, null);
  assert.match(sortie.hint, /maxCredits: null/);
  assert.equal(fetch.vues.length, 1);
});

test("key rail: insufficient credits, invalid key, suspended account and outages are errors", async () => {
  const cas = [
    ["kyb-402-credits-insuffisants", `/v1/kyb/${AIRVANCE}`, CLE_FACTICE, "insufficient_credits", "credits_insuffisants"],
    ["entreprise-401-cle-invalide", `/v1/entreprise/${AIRVANCE}`, "srn_live_0000000000000000", "http_error", "cle_invalide"],
    ["entreprise-403-cle", `/v1/entreprise/${AIRVANCE}`, CLE_FACTICE, "http_error", "compte_suspendu"],
    ["entreprise-503-cle", `/v1/entreprise/${AIRVANCE}`, CLE_FACTICE, "http_error", "amont_indisponible"],
  ];
  for (const [nom, chemin, cle, erreur, code] of cas) {
    const fetch = faux([charger(nom)]);
    const client = new Sirenic({ apiKey: cle, maxCredits: null, fetch });
    const sortie = JSON.parse(await client.get(chemin));
    assert.equal(sortie.error, erreur, nom);
    assert.equal(sortie.code, code, nom);
    assert.equal(sortie.status, charger(nom).status, nom);
  }
});

test("quote-only rail: the quote is returned with its hint", async () => {
  const fetch = faux([charger("entreprise-402")]);
  const client = new Sirenic({ fetch });
  const sortie = JSON.parse(await client.get(`/v1/entreprise/${AIRVANCE}`));
  assert.equal(sortie.payment_required, true);
  assert.match(sortie.hint, /No API key or wallet/);
  assert.equal(sortie.quote.price, "$0.005");
});

test("a redirect to another host is not followed: the key never leaves api.sirenic.eu", async () => {
  const fetch = faux([charger("entreprise-200-cle")], {
    redirections: { [`${BASE}/v1/entreprise/${AIRVANCE}`]: "https://ailleurs.example/v1/entreprise/490586708" },
  });
  const client = new Sirenic({ apiKey: CLE_FACTICE, maxCredits: null, fetch });
  const sortie = JSON.parse(await client.get(`/v1/entreprise/${AIRVANCE}`));
  assert.equal(sortie.error, "redirect_refused");
  assert.ok(fetch.vues.every((v) => v.url.startsWith(`${BASE}/`)));
});

test("a redirect within api.sirenic.eu is followed", async () => {
  const fetch = faux([charger("entreprise-200-cle")], {
    redirections: { [`${BASE}/v1/ancienne/${AIRVANCE}`]: `/v1/entreprise/${AIRVANCE}` },
  });
  const client = new Sirenic({ apiKey: CLE_FACTICE, maxCredits: null, fetch });
  const sortie = JSON.parse(await client.get(`/v1/ancienne/${AIRVANCE}`));
  assert.deepEqual(sortie, charger("entreprise-200-cle").body);
  assert.deepEqual(
    fetch.vues.map((v) => v.headers["x-api-key"]),
    [CLE_FACTICE, CLE_FACTICE],
  );
});

test("paths: a full URL or another prefix is refused before any request, a space is encoded", async () => {
  const fetch = faux([charger("suggestions-nom-200")]);
  const client = new Sirenic({ fetch });
  for (const mauvais of ["https://ailleurs.example/v1/x", "/v2/x", "v1/x", "", 42]) {
    assert.equal(JSON.parse(await client.get(mauvais)).error, "invalid_path");
  }
  assert.equal(fetch.vues.length, 0);
  await client.get("/v1/recherche?q=danone sa&x=%41%zz").catch(() => {});
  assert.equal(fetch.vues[0].url, `${BASE}/v1/recherche?q=danone%20sa&x=%41%25zz`);
});

test("a binary body is described, a network error is reported", async () => {
  const pdf = async () => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "content-type": "application/pdf" } });
  const sortie = JSON.parse(await new Sirenic({ fetch: pdf }).get(`/v1/rapport/${AIRVANCE}`));
  assert.deepEqual([sortie.content_type, sortie.size_bytes], ["application/pdf", 4]);
  const panne = async () => {
    throw new TypeError("fetch failed");
  };
  const erreur = JSON.parse(await new Sirenic({ fetch: panne }).get(`/v1/kyb/${AIRVANCE}`));
  assert.equal(erreur.error, "network");
});

test("wallet rail: a quote under the cap is signed locally and sent once", async () => {
  const fetch = faux([charger("entreprise-402"), charger("entreprise-200-cle")], { paiement: "accepte" });
  const client = new Sirenic({ walletKey: generatePrivateKey(), maxPriceUsd: 0.01, fetch });
  const sortie = JSON.parse(await client.get(`/v1/entreprise/${AIRVANCE}`));
  assert.deepEqual(sortie, charger("entreprise-200-cle").body);
  assert.equal(fetch.vues.length, 2);
  const signature = fetch.vues[1].headers["payment-signature"];
  assert.ok(signature, "the second request carries the x402 payment");
  const paiement = decodePaymentSignatureHeader(signature);
  assert.equal(paiement.accepted.amount, "5000");
  assert.equal(paiement.accepted.asset.toLowerCase(), USDC_BASE.toLowerCase());
  assert.equal(paiement.accepted.network, "eip155:8453");
  assert.equal(fetch.vues[1].headers["x-api-key"], undefined);
});

test("wallet rail: a quote above maxPriceUsd is never signed", async () => {
  const fetch = faux([charger("kyb-402")], { paiement: "accepte" });
  const client = new Sirenic({ walletKey: generatePrivateKey(), maxPriceUsd: 0.1, fetch });
  const sortie = JSON.parse(await client.get(`/v1/kyb/${AIRVANCE}`));
  assert.equal(sortie.price_cap_exceeded, true);
  assert.equal(sortie.max_price_usd, 0.1);
  assert.equal(fetch.vues.length, 1);
});

test("wallet rail: a quote in no asset the client pays is never signed", async () => {
  const devis = devisModifie("entreprise-402", (accepts) =>
    accepts.filter((o) => o.asset === EURC_BASE).map((o) => ({ ...o, network: "eip155:1", asset: EURC_ETHEREUM })),
  );
  const fetch = faux([devis], { paiement: "accepte" });
  const client = new Sirenic({ walletKey: generatePrivateKey(), fetch });
  const sortie = JSON.parse(await client.get(`/v1/entreprise/${AIRVANCE}`));
  assert.equal(sortie.unsupported_asset, true);
  assert.deepEqual(sortie.assets, ["EURC on eip155:1"]);
  assert.equal(fetch.vues.length, 1);
});

test("wallet rail: EURC on Base is paid when it is the only option", async () => {
  const devis = devisModifie("entreprise-402", (accepts) => accepts.filter((o) => o.asset === EURC_BASE));
  const fetch = faux([devis, charger("entreprise-200-cle")], { paiement: "accepte" });
  const client = new Sirenic({ walletKey: generatePrivateKey(), maxPriceUsd: 0.01, fetch });
  const sortie = JSON.parse(await client.get(`/v1/entreprise/${AIRVANCE}`));
  assert.deepEqual(sortie, charger("entreprise-200-cle").body);
  const paiement = decodePaymentSignatureHeader(fetch.vues[1].headers["payment-signature"]);
  assert.equal(paiement.accepted.asset, EURC_BASE);
});

test("wallet rail: a cap above $1 replaces the default spend cap of @x402/core", async () => {
  const cherement = (accepts) => accepts.map((o) => ({ ...o, amount: "1500000", maxAmountRequired: "1500000" }));
  const devis = devisModifie("entreprise-402", cherement);
  const fetch = faux([devis, charger("entreprise-200-cle")], { paiement: "accepte" });
  const client = new Sirenic({ walletKey: generatePrivateKey(), maxPriceUsd: 2, fetch });
  const sortie = JSON.parse(await client.get(`/v1/entreprise/${AIRVANCE}`));
  assert.deepEqual(sortie, charger("entreprise-200-cle").body);
  assert.equal(decodePaymentSignatureHeader(fetch.vues[1].headers["payment-signature"]).accepted.amount, "1500000");
  const prudent = faux([devis], { paiement: "accepte" });
  const refus = JSON.parse(await new Sirenic({ walletKey: generatePrivateKey(), fetch: prudent }).get(`/v1/entreprise/${AIRVANCE}`));
  assert.equal(refus.price_cap_exceeded, true, "under the default cap of 1.0, $1.50 is not signed");
});

test("wallet rail: a refused payment is reported, never retried", async () => {
  const fetch = faux([charger("entreprise-402")], { paiement: "refuse" });
  const client = new Sirenic({ walletKey: generatePrivateKey(), fetch });
  const sortie = JSON.parse(await client.get(`/v1/entreprise/${AIRVANCE}`));
  assert.equal(sortie.error, "payment_failed");
  assert.equal(fetch.vues.length, 2);
});
