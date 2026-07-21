# Sirenic Examples

> 🚀 Sirenic launches on Product Hunt this Wednesday (July 22). Take a look and say hi: https://www.producthunt.com/products/sirenic?launch=sirenic

[![smithery badge](https://smithery.ai/badge/contact-erkc/sirenic)](https://smithery.ai/servers/contact-erkc/sirenic)

Working examples for [Sirenic](https://api.sirenic.eu) — official French and
European company data for AI agents. Pay-per-call in **USDC or EURC** via the
[x402 protocol](https://github.com/x402-foundation/x402): **no account, no
API key** — your agent pays each request on Base. Every paid response is
**Ed25519-signed** and verifiable offline
([recipe](https://api.sirenic.eu/.well-known/sirenic-signing-key)).

- Landing & pricing: https://api.sirenic.eu
- OpenAPI: https://api.sirenic.eu/openapi.json
- For LLMs: https://api.sirenic.eu/llms.txt
- MCP server: `https://api.sirenic.eu/mcp` (streamable HTTP)

Data sources: INSEE Sirene / INPI RNE and other official registers, open
licenses (Etalab 2.0, NLOD, CC-BY 4.0, OGL, CC0). Data is redistributed
as published — every response carries `source` and `disclaimer` fields.

## Quickstart 1 — see a payment quote (no wallet needed)

```bash
curl -i "https://api.sirenic.eu/v1/entreprise/552032534" -H "Accept: application/json"
```

You get `HTTP 402` with the x402 payment requirements in the
`PAYMENT-REQUIRED` header and a JSON body. Each quote carries **two payment
options at the same numeric amount** — USDC (first, the default for existing
clients) or EURC — with the official Circle contracts, receiving address and
network.

## Quickstart 2 — pay and call in ~10 lines (TypeScript)

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

## Quickstart 3 — plug into Claude / Cursor (MCP)

Claude Code:

```bash
claude mcp add --transport http sirenic https://api.sirenic.eu/mcp
```

Cursor / any MCP client (`mcpServers` config):

```json
{ "mcpServers": { "sirenic": { "url": "https://api.sirenic.eu/mcp" } } }
```

28 tools are exposed (search with 0-1 confidence scores, company profiles,
KYB files, sanctions screening, financials, capital structure, sector
benchmarks, failure-risk score, Belgian annual accounts…). Each tool accepts
an optional `x_payment` parameter: without it you get the 402 quote; sign it
with an x402 client and call again.

## Endpoints and prices (USDC or EURC per call, same amount)

| Endpoint | Price | What you get |
|---|---|---|
| `GET /v1/recherche?q=` | $0.001 | Search 30M French companies |
| `GET /v1/entreprise/{siren}` | $0.005 | Full official French profile |
| `GET /v1/entreprise/{siren}/etablissements` | $0.003 | All establishments (SIRET) |
| `GET /v1/entreprise/{siren}/alertes` | $0.01 | BODACC legal alerts (insolvency…) |
| `GET /v1/entreprise/{siren}/finances` | $0.01 | Filed financials + ratios |
| `GET /v1/entreprise/{siren}/marches-publics` | $0.01 | Public procurement won |
| `GET /v1/entreprise/{siren}/changements?depuis=` | $0.01 | New BODACC events since a date |
| `GET /v1/entreprise/{siren}/pi` | $0.03 | Industrial property (trademarks, patents, designs) |
| `GET /v1/entreprise/{siren}/comptes-pdf` | $0.15 | Accounts annexe notes, AI-extracted (structured) |
| `GET /v1/entreprise/{siren}/capital` | $0.25 | Ownership from public articles, AI-extracted |
| `GET /v1/entreprise/{siren}/liens-capitalistiques` | $0.15 | Single-level capital links between legal entities |
| `GET /v1/entreprise/{siren}/sante` | $0.15 | AI health summary (7-day cache) |
| `GET /v1/score/defaillance/{siren}` | $0.10 | Failure-risk score (deterministic) |
| `GET /v1/secteur/{code_naf}/benchmarks` | $0.05 | Sector aggregates (k-anonymised) |
| `GET /v1/kyb/{siren}` | $0.15 | Full KYB file + sanctions screening |
| `GET /v1/kyb/batch?sirens=` | $0.105/co | Batch KYB (2–100 companies) |
| `GET /v1/sanctions/check?name=` | $0.02 | 6 official sanctions lists (UN, EU, OFAC, UK, FR, Swiss SECO), scored |
| `GET /v1/dirigeant/recherche?nom=` | $0.02 | Reverse director search |
| `GET /v1/prospection?...` | $0.02/page | Multi-criteria prospecting |
| `GET /v1/rapport/{siren}` | $0.50 | PDF report |
| `GET /v1/entreprise/{siren}/documents` | $0.02 | List filed documents (INPI) |
| `GET /v1/documents/{type}/{id}` | $0.10 | Download a filed document (PDF) |
| `GET /v1/tva/verifier/{numero}` | $0.003 | EU VAT validation (VIES) |
| `GET /v1/eu/recherche?q=` | $0.003 | Search European registers + GLEIF |
| `GET /v1/eu/entreprise/{pays}/{id}` | $0.01 | Unified European profile (BE: + NACEBEL activities & establishment units) |
| `GET /v1/eu/entreprise/BE/{id}/comptes` | $0.01 | Belgian filings list (official NBB Central Balance Sheet Office) |
| `GET /v1/eu/entreprise/BE/{id}/comptes/{ref}` | $0.15 | One Belgian annual-account deposit (JSON since 2022, PDF before) |

Free: `GET /` (landing), `GET /preview/entreprise/55203253400646` (sample
response), `GET /openapi.json`, `GET /llms.txt`, `GET /healthz`.

## In this repo

- [`examples/quote.sh`](examples/quote.sh) — inspect a 402 quote with curl.
- [`examples/pay-and-call.ts`](examples/pay-and-call.ts) — pay one request end to end.
- [`examples/verify-signature.ts`](examples/verify-signature.ts) — **verify the Ed25519 signature** of a paid response offline (~$0.001).
- [`examples/smoke-test.ts`](examples/smoke-test.ts) — pay and call every endpoint once (~$1.80 total).
- [`examples/agent-demo.ts`](examples/agent-demo.ts) — a small autonomous agent that searches, pays and reads profiles.
- [`examples/mcp-setup.md`](examples/mcp-setup.md) — MCP configuration for Claude, Cursor and generic clients.
- [`tutorial-kyb-agent/`](tutorial-kyb-agent/) — **Build a KYB agent in 20 lines**.

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
