# Changelog

## 0.3.0 (unreleased)

- API key rail: `sirenicTools({ apiKey })`, or the `SIRENIC_API_KEY` environment variable when no wallet is
  given; calls are paid with prepaid credits (header `X-Api-Key`), under a per-call cap `maxCredits` (default
  1.0, in credits): the price is read in the free quote of the same request, and a call above the cap is not
  made (the tool returns `price_cap_exceeded: true`, the price and the quote). `maxCredits: null` removes the
  cap. A key and a wallet together are refused: one payment rail per client.
- Wallet rail: the quote is checked before signing, and a quote above `maxPriceUsd` now returns the quote with
  `price_cap_exceeded: true` (it was a `payment_refused_or_network` error); USDC or EURC on Base are paid, a quote
  in no such asset returns `unsupported_asset: true` and the offered `assets`, nothing signed. `maxPriceUsd`
  replaces the $1 default spend cap of `@x402/core` 2.23 and later, so watchlists above $1 can be paid.
- The key and the payment headers are sent to `baseUrl` only: an https base (plain http only on localhost),
  redirects followed within that origin only.
- Errors carry the service's `code`; `insufficient_credits` when the key's balance is too low; a binary body
  (PDF) is described by its type and size.
- Descriptions: search price corrected to $0.002, the price served for `GET /v1/recherche`; ARCEP data named
  telecom identifiers; EU authorisations cover ESMA, ECB and EIOPA registers; no long dash, no hand-written
  counts.
- `sirenicTools()` also takes a `Sirenic` client; `fetch` and `timeoutMs` options.
- Dependencies: `@x402/core` and `@x402/evm` 2.32 or later; `@x402/fetch` is no longer needed.
- Tests without network on recorded responses of the service, and the prices of the descriptions checked
  against the served OpenAPI document (`npm test`; `SIRENIC_OPENAPI_LIVE=1` reads the live document).

## 0.2.0 (never published)

- Licences tool, invoicing checks for France, Belgium and Poland, Belgian insider transactions, watchlists of
  30, 90 or 365 days.

## 0.1.0 (2026-07-23, on npm)

- LangChain.js tools with x402 auto-payment and a hard price cap.
