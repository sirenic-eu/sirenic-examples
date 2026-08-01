# Sirenic Examples

> 🚀 Sirenic is live on Product Hunt today. Take a look and say hi: https://www.producthunt.com/products/sirenic?launch=sirenic

[![smithery badge](https://smithery.ai/badge/contact-erkc/sirenic)](https://smithery.ai/servers/contact-erkc/sirenic)
[![Listed on x402-list](https://x402-list.com/badge/sirenic.svg)](https://x402-list.com/services/sirenic?utm_source=badge&utm_medium=referral&utm_campaign=embed)

Working examples for [Sirenic](https://api.sirenic.eu) — official French and
European company data for AI agents. Pay-per-call in **USDC or EURC** via the
[x402 protocol](https://github.com/x402-foundation/x402): **no account, no
API key** — your agent pays each request on Base. Every paid response is
**Ed25519-signed** and verifiable offline
([recipe](https://api.sirenic.eu/.well-known/sirenic-signing-key)) — and carries
its **per-block provenance**: which official register each block came from, its
licence, its version and its `as_of` date, with the exact meaning of that date
(upstream official publication, Sirenic ingestion, or live consultation).
Verify the signature, then read the provenance: your agent can prove to an
auditor what it knew when it paid. Codes are resolved for free at
[`/v1/provenance/registres`](https://api.sirenic.eu/v1/provenance/registres).

- Landing & pricing: https://api.sirenic.eu
- OpenAPI: https://api.sirenic.eu/openapi.json
- For LLMs: https://api.sirenic.eu/llms.txt
- MCP server: `https://api.sirenic.eu/mcp` (streamable HTTP)
- A2A agent: `POST https://api.sirenic.eu/a2a` (JSON-RPC, a2a-x402 payment
  extension) — card at `https://api.sirenic.eu/.well-known/agent-card.json`

Data sources: INSEE Sirene / INPI RNE and other official registers, open
licenses (Etalab 2.0, NLOD, CC-BY 4.0, OGL, CC0). Data is redistributed
as published — every response carries `source` and `disclaimer` fields.

## Quickstart 1 — "Can you safely invoice or pay this company?"

One call, three answers: is the supplier still active, is its VAT number valid
**today**, and is that IBAN a real account at an identified bank. Start with the
quote — free, no wallet, no account:

```bash
curl -i "https://api.sirenic.eu/v1/facturation/dossier?siren=552032534&iban=FR1420041010050500013M02606"
```

Then pay the $0.03 and get the file, with a deterministic verdict:

```ts
const res = await payingFetch(
  "https://api.sirenic.eu/v1/facturation/dossier?siren=552032534&iban=FR1420041010050500013M02606",
);
const dossier = await res.json();
dossier.verdict.pret_a_facturer; // true | false
dossier.verdict.raisons;         // closed list: entreprise_cessee, tva_invalide_vies, iban_invalide…
```

`payingFetch` is the six-line x402 wrapper of Quickstart 3. Belgium and Poland:
`GET /v1/eu/facturation/dossier?pays=&id=&iban=` (same price, same verdict).
The response is Ed25519-signed and carries its provenance inside the signed
bytes — [`examples/verify-invoice-file.ts`](examples/verify-invoice-file.ts)
turns one call into an audit file that still re-verifies offline years later.
Why this matters in 2026: see [the section below](#verify-a-supplier-before-you-pay--the-2026-e-invoicing-window).

## Quickstart 2 — see a payment quote (no wallet needed)

```bash
curl -i "https://api.sirenic.eu/v1/entreprise/552032534" -H "Accept: application/json"
```

You get `HTTP 402` with the x402 payment requirements in the
`PAYMENT-REQUIRED` header and a JSON body. Each quote carries **two payment
options at the same numeric amount** — USDC (first, the default for existing
clients) or EURC — with the official Circle contracts, receiving address and
network.

## Quickstart 3 — pay and call in ~10 lines (TypeScript)

```bash
npm install @x402/fetch @x402/core @x402/evm viem
```

```ts
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const account = privateKeyToAccount(process.env.TEST_WALLET_KEY as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const payingFetch = wrapFetchWithPayment(fetch, client);

const res = await payingFetch("https://api.sirenic.eu/v1/entreprise/552032534");
console.log(await res.json()); // paid, settled, delivered
```

`TEST_WALLET_KEY` is the private key of **your client test wallet** (the
payer). The server never holds any key. The `exact` scheme uses signed
authorizations, so the client pays no gas.

## Quickstart 4 — plug into Claude / Cursor (MCP)

Claude Code:

```bash
claude mcp add --transport http sirenic https://api.sirenic.eu/mcp
```

Cursor / any MCP client (`mcpServers` config):

```json
{ "mcpServers": { "sirenic": { "url": "https://api.sirenic.eu/mcp" } } }
```

44 tools are exposed — including the FREE detect_company_identifiers (paste any text, get SIREN/SIRET/VAT/LEI with the right call to make) and verify_iban_bank. Search with 0-1 confidence scores, company profiles,
KYB files, a $1 company-intelligence report, sanctions screening, AMF
regulator alerts, **regulatory authorisations by SIREN (EBA PSD2 register,
EIOPA, ARCEP)**, EU financial authorisations (ESMA), industrial risk
(Seveso/ICPE), lobbying register, EU procurement awards (TED), **watchlists
with daily checks and Ed25519-signed webhooks**, financials, capital
structure, sector benchmarks, failure-risk score, Belgian annual
accounts…). Each tool accepts
an optional `x_payment` parameter: without it you get the 402 quote; sign it
with an x402 client and call again. Every tool declares an **output schema**
and returns `structuredContent`, plus MCP annotations (read-only vs. state-
changing), so a client can type-check responses instead of parsing prose. The
quote you get back is the **signable x402 payment requirements**
(`{x402Version, accepts[]}`) — an agent can pay entirely from MCP, without
touching the REST API.

## Quickstart 5 — A2A (Agent2Agent)

Sirenic is also an A2A 1.0 agent with the official crypto payment extension
(a2a-x402). Discover it from the card, send a JSON data part, get the quote
as task metadata, pay on the same task:

```bash
curl -s https://api.sirenic.eu/.well-known/agent-card.json -H "A2A-Version: 1.0"
npx tsx examples/a2a.ts   # quote for free; add TEST_WALLET_KEY to pay
```

## Quickstart 6 — LangChain & CrewAI SDKs

Ready-made paying tools with a hard price cap ([sdk/typescript](sdk/typescript),
[sdk/python](sdk/python)):

```ts
import { sirenicTools } from "sirenic-agents";           // LangChain.js
const tools = sirenicTools({ walletKey, maxPriceUsd: 0.25 });
```

```python
from sirenic_agents import SirenicClient, build_crewai_tools   # CrewAI / LangChain
tools = build_crewai_tools(SirenicClient(wallet_key=key, max_price_usd=0.25))
```

CrewAI can also use Sirenic's MCP server directly, no SDK:
`Agent(..., mcps=["https://api.sirenic.eu/mcp"])`.

## Verify a supplier before you pay — the 2026 e-invoicing window

Three dates make this urgent, and only one of them is French:

- **France — September 1, 2026.** Every company subject to VAT must be able to
  RECEIVE electronic invoices; issuance is phased (large and mid-size companies
  September 2026, SMEs and micro-businesses September 2027). Art. 91, Loi de
  finances 2024.
- **Belgium — in force since January 1, 2026.** Structured e-invoicing is
  mandatory between Belgian VAT-registered businesses.
- **Poland — no deadline, a standing tax rule.** Paying more than PLN 15,000
  into an account the supplier has *not* declared in the official White List
  (wykaz podatników VAT) costs the buyer the deduction and exposes it to joint
  liability for the VAT (art. 117ba Ordynacja podatkowa).

Five routes cover it — no account, no API key:

| Route | Price | What it answers |
|---|---|---|
| **`GET /v1/facturation/dossier?siren=&iban=`** | **$0.03** | France: identity, VAT and IBAN in a single call, plus a deterministic `pret_a_facturer` verdict |
| `GET /v1/eu/facturation/dossier?pays=&id=&iban=` | $0.03 | Belgium & Poland: registry identity, VIES, Peppol reachability (BE), White List account check (PL) |
| `GET /v1/entreprise/{siren}/facturation-prep` | $0.02 | Legal name & form, computed intra-EU VAT number, SIRET establishments, indicative obligation dates |
| `GET /v1/iban/verifier/{iban}` | $0.005 | IBAN structure (ISO 13616, mod 97-10) + the bank identified from official registers, BIC via the GLEIF/SWIFT mapping |
| `GET /v1/tva/verifier/{numero}` | $0.003 | An EU VAT number, checked live against VIES |

One free call to `/v1/reperer?texte=` tells your agent which of them to use on
any raw text. The verdict's reasons are a **closed list** (`entreprise_cessee`,
`tva_invalide_vies`, `iban_invalide`…), so an agent branches on codes instead of
parsing prose — and a VIES outage yields an honest `tva_non_verifiable`, never a
false invalid.

Every one of these responses is Ed25519-signed, and the **provenance travels
inside the signed bytes**: which official register served each block, and its
`as_of` date. Verify the signature, then read the provenance — that is an audit
trail you can hand to an accountant.
[`examples/verify-invoice-file.ts`](examples/verify-invoice-file.ts) writes one
to disk and re-verifies it from the files alone.

Two things this is **not**:

- **Not a check of the account holder's name.** Sirenic validates the IBAN and
  identifies the bank from official registers; it never confirms that the
  account belongs to the company you are about to pay.
- **Not an accredited platform (PDP).** Sirenic does not issue, transmit or
  route any invoice, and does not confirm a recipient's registration on the PPF
  or any accredited platform. It gives your agent the checks to run *before* the
  invoice exists.

## Endpoints and prices (USDC or EURC per call, same amount)

| Endpoint | Price | What you get |
|---|---|---|
| **`GET /v1/facturation/dossier?siren=&iban=`** | **$0.03** | **Verify a French supplier before payment**: e-invoicing prep + live VIES + IBAN/bank check + a deterministic `pret_a_facturer` verdict |
| `GET /v1/eu/facturation/dossier?pays=&id=&iban=` | $0.03 | Verify a Belgian or Polish supplier before payment: registry identity + VIES + Peppol reachability (BE) + White List account check (PL) + the same verdict |
| `GET /v1/recherche?q=` | $0.001 | Search 30M French companies |
| `GET /v1/entreprise/{siren}` | $0.005 | Full official French profile |
| `GET /v1/entreprise/{siren}/etablissements` | $0.003 | All establishments (SIRET) |
| `GET /v1/entreprise/{siren}/alertes` | $0.01 | BODACC legal alerts (insolvency…) |
| `GET /v1/entreprise/{siren}/finances` | $0.01 | Filed financials + ratios |
| `GET /v1/entreprise/{siren}/marches-publics` | $0.01 | Public procurement won (French DECP) |
| `GET /v1/entreprise/{siren}/marches-publics-ue` | $0.02 | EU procurement awards (TED, identifier-matched) |
| `GET /v1/entreprise/{siren}/risques-industriels` | $0.01 | Industrial risk: Seveso/ICPE facilities + synthesis |
| `GET /v1/entreprise/{siren}/lobbying` | $0.01 | HATVP lobbying register (org-level: budgets, subjects, clients) |
| `GET /v1/entreprise/{siren}/changements?depuis=` | $0.01 | New BODACC events since a date |
| `GET /v1/entreprise/{siren}/pi` | $0.03 | Industrial property (trademarks, patents, designs) |
| `GET /v1/entreprise/{siren}/comptes-pdf` | $2.00 | Accounts annexe notes, AI-extracted (structured) |
| `GET /v1/entreprise/{siren}/capital` | $0.35 | Ownership from public articles, AI-extracted |
| `GET /v1/entreprise/{siren}/liens-capitalistiques` | $2.00 | Single-level capital links between legal entities |
| `GET /v1/entreprise/{siren}/sante` | $0.15 | AI health summary (7-day cache) |
| `GET /v1/score/defaillance/{siren}` | $0.10 | Failure-risk score (deterministic) |
| `GET /v1/secteur/{code_naf}/benchmarks` | $0.05 | Sector aggregates (k-anonymised) |
| `GET /v1/kyb/{siren}` | $0.15 | Full KYB file + sanctions screening |
| `GET /v1/kyb/batch?sirens=` | $0.105/co | Batch KYB (2–100 companies) |
| `GET /v1/sanctions/check?name=` | $0.02 | 6 official sanctions lists (UN, EU, OFAC, UK, FR, Swiss SECO), scored |
| `GET /v1/regulateurs/fr/alertes?nom=\|siren=` | $0.01 | AMF blacklists + PSAN/SGP registers (scam check, crypto providers) |
| `GET /v1/eu/agrements?q=` | $0.01 | EU financial authorisations (ESMA, all EU/EEA, by name or LEI) |
| `GET /v1/entreprise/{siren}/agrements` | $0.02 | Regulatory licences by SIREN: payment institution, e-money, account information, payment agent or exempt entity (EBA PSD2 register, daily), insurer (EIOPA), telecom operator (ARCEP) — with licensed services, EEA passporting and withdrawals |
| `GET /v1/dirigeant/recherche?nom=` | $0.02 | Reverse director search |
| `GET /v1/prospection?...` | $0.02/page | Multi-criteria prospecting |
| `GET /v1/rapport/{siren}` | $0.50 | PDF report |
| `GET /v1/intelligence/{siren}` | $1.00 | Intelligence report: every block cross-referenced — executive summary, officers´ network, filings, trends, closed-list signals, rule-based verdict |
| `GET /v1/entreprise/{siren}/documents` | $0.02 | List filed documents (INPI) |
| `GET /v1/documents/{type}/{id}` | $0.10 | Download a filed document (PDF) |
| `GET /v1/tva/verifier/{numero}` | $0.003 | EU VAT validation (VIES) |
| `GET /v1/iban/verifier/{iban}` | $0.005 | IBAN check + bank identification (FR/BE/AT/NL, incl. LEI) — not a Verification of Payee |
| `GET /v1/surveillance/creer?cibles=` | $0.05/target/30d | **Watchlist**: daily checks on companies & directors, signed webhooks + e-mail digests |
| `GET /v1/surveillance/{token}/renouveler` | $0.05/target/30d | Renew a watchlist (grace: 7 days after expiry) |
| `GET /v1/eu/recherche?q=` | $0.003 | Search European registers (BE, NO, EE, LV local; CZ, SK, FI, PL, CH live) + GLEIF |
| `GET /v1/eu/entreprise/{pays}/{id}` | $0.01 | Unified European profile — 12 countries: BE (KBO, NACEBEL + establishments), CH (Zefix), NO (Brønnøysund), CZ (ARES), SK (RPO), FI (PRH), PL (KRS), EE, LV… Each live country also has its own dedicated path (e.g. `/v1/eu/entreprise/CH/CHE-107.480.920`) |
| `GET /v1/eu/entreprise/BE/{id}/comptes` | $0.01 | Belgian filings list (official NBB Central Balance Sheet Office) |
| `GET /v1/eu/entreprise/BE/{id}/comptes/{ref}` | $0.15 | One Belgian annual-account deposit (JSON since 2022, PDF before) |
| `GET /v1/eu/entreprise/BE/{id}/transactions-dirigeants` | $0.02 | Insider dealing at a Belgian listed company (FSMA, Art. 19 MAR): are its managers buying or selling? Issuer-level aggregate — **no individual is ever named** |

Free: `GET /` (landing), `GET /preview/entreprise/55203253400646` (sample
response), `GET /v1/reperer?texte=` (**detect SIREN/SIRET/VAT/LEI in any text**,
with the suggested paid call and its price), `GET /openapi.json`,
`GET /llms.txt`, `GET /healthz`; watchlist
status `GET /v1/surveillance/{token}` and stop `…/{token}/arreter` (the token
returned at creation is the capability — no account).

## In this repo

- [`examples/quote.sh`](examples/quote.sh) — inspect a 402 quote with curl.
- [`examples/pay-and-call.ts`](examples/pay-and-call.ts) — pay one request end to end.
- [`examples/verify-invoice-file.ts`](examples/verify-invoice-file.ts) — **verify a supplier before you pay, and keep the proof** (~$0.03): buy the invoicing file, verify its signature offline, read the `pret_a_facturer` verdict and its provenance only once authenticated, then write a timestamped audit folder (raw bytes, signature, public key, `LISEZ-MOI.md`) and re-verify it from those files alone.
- [`examples/verify-signature.ts`](examples/verify-signature.ts) — **the full audit loop**: verify the Ed25519 signature of a paid response offline, then read its **per-block provenance** (official register + `as_of` date) from inside the signed bytes (~$0.02).
- [`examples/smoke-test.ts`](examples/smoke-test.ts) — pay and call **every paid endpoint** once (~$7.40 total, USDC and/or EURC; the watchlist it creates is stopped again for free).
- [`examples/agent-demo.ts`](examples/agent-demo.ts) — a small autonomous agent that searches, pays and reads profiles.
- [`examples/mcp-setup.md`](examples/mcp-setup.md) — MCP configuration for Claude, Cursor and generic clients.
- [`examples/a2a.ts`](examples/a2a.ts) — call Sirenic as an **A2A agent** (quote for free, then pay on the same task via the a2a-x402 extension).
- [`tutorial-kyb-agent/`](tutorial-kyb-agent/) — **Build a KYB agent in 20 lines**.
- **n8n community node** — moved to its own repository (n8n verification requires credentials/ at the repo root): https://github.com/sirenic-eu/n8n-nodes-sirenic — `npm i n8n-nodes-sirenic`

## Test wallet setup

1. Create a throwaway wallet (e.g. in MetaMask) and export its private key.
2. Fund it with a couple of dollars of USDC on **Base** (any exchange can withdraw to Base network).
3. `export TEST_WALLET_KEY=0x...` — never commit it anywhere.

Sirenic settles on Base mainnet.

## Disclaimer

Sirenic redistributes official open data as published (Etalab 2.0 and other
open licenses). It does not guarantee accuracy or completeness, and outputs
(including sanctions screening and AI summaries) are decision aids — not
legal, financial or compliance advice.

License: MIT.
