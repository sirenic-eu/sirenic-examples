# sirenic-agents (TypeScript): LangChain.js tools for Sirenic

Company data from the official French and European registers in your agent: search, profile, KYB, sanctions
screening, regulator checks (AMF, ESMA, EBA, EIOPA, ARCEP), invoicing checks (France, Belgium, Poland), Belgian
insider transactions, intelligence report and watchlists, plus a generic tool for any other route. Three ways to
pay a call:

- an **API key** (prepaid credits, 1 credit = 1 EUR): `apiKey` or the `SIRENIC_API_KEY` environment variable,
  with a per-call cap in credits;
- a **wallet** paying each call via [x402](https://x402.org) (USDC or EURC on Base), with a hard price cap;
- **neither**: every tool still works and returns the payment quote (discovery and dry runs).

```bash
npm install sirenic-agents @langchain/core
```

## With an API key

```ts
import { sirenicTools } from "sirenic-agents";

const tools = sirenicTools({
  apiKey: process.env.SIRENIC_API_KEY, // prepaid credits, sent in the X-Api-Key header to api.sirenic.eu only
  maxCredits: 0.25,                    // per-call cap in credits: a pricier call is not made
});

// Drop into any LangChain.js agent:
const agent = createReactAgent({ llm, tools });
```

Create the key in your account at
[api.sirenic.eu/compte](https://api.sirenic.eu/compte?utm_source=npm&utm_campaign=sirenic-agents). An account
comes with a free monthly quota of calls; beyond it, calls are paid from prepaid credits (card top-up is not open
yet). Today's terms are on the
[connectors page](https://api.sirenic.eu/en/connectors?utm_source=npm&utm_campaign=sirenic-agents).

## With a wallet (x402)

```ts
const tools = sirenicTools({
  walletKey: process.env.WALLET_KEY, // your paying wallet: it never leaves the process
  maxPriceUsd: 0.25,                 // hard cap: quotes above are NEVER signed
});
```

## Tools

Each description states the price of its route, as served in the
[OpenAPI document](https://api.sirenic.eu/openapi.json) (`x-price`), so the agent can budget:
`sirenic_search_companies`, `sirenic_company_profile`, `sirenic_kyb_file`, `sirenic_screen_sanctions`,
`sirenic_amf_alerts`, `sirenic_eu_financial_authorisations`, `sirenic_invoice_file_france`,
`sirenic_invoice_file_europe`, `sirenic_company_licences`, `sirenic_belgian_insider_transactions`,
`sirenic_company_intelligence`, `sirenic_create_watch` and `sirenic_get` (any other path; catalog and prices in
[llms.txt](https://api.sirenic.eu/llms.txt)).

The `Sirenic` client behind them can be used on its own: `new Sirenic({ apiKey }).get("/v1/kyb/552032534")`.
`sirenicTools()` also takes such a client.

Every tool returns a JSON string: the data, the quote (`payment_required: true`, with
`price_cap_exceeded: true` when the price is above your cap, or `unsupported_asset: true` when the wallet cannot
pay any offered asset) or the error (`insufficient_credits` when the key's balance is too low). Responses with a
status of 400 or above are not charged.

## Safety model

- With an API key, each call has its cap in credits (`maxCredits`, default 1.0): the price is read in the free
  quote of the same request, sent without the key, and a call above the cap is not made. `maxCredits: null`
  removes the cap and that extra request. The quote request counts against the service's per-IP rate limit for
  calls without a key (120 requests per minute): heavy use behind one IP address can get a 429 error before the
  paid call, which is then not made; for heavy traffic or a shared IP address, pass `maxCredits: null`.
- With a wallet, payments are EIP-3009 authorizations signed locally by the official `@x402/*` packages, in USDC
  or EURC on Base; the price cap (`maxPriceUsd`, default 1.0) is checked against every quote before signing, and
  replaces the $1 default spend cap of `@x402/core`. Watchlists and batches are priced per target and can cost
  more than 1.0: raise the cap for them.
- The key and the payment headers are only sent to `baseUrl` (https): the client takes a path, never a full
  URL, and follows a redirect only within that origin.
- Paid responses are Ed25519-signed by the server
  ([verify](https://api.sirenic.eu/.well-known/sirenic-signing-key)).

## Links

- [KYB checks with provenance on every block, step by step](https://api.sirenic.eu/en/use-cases/kyb-automated-business-verification-with-per-block?utm_source=npm&utm_campaign=sirenic-agents)
- [API reference, one page per route with its price](https://api.sirenic.eu/en/api?utm_source=npm&utm_campaign=sirenic-agents)
- Python: [`sirenic-agents`](https://pypi.org/project/sirenic-agents/) (LangChain and CrewAI).
