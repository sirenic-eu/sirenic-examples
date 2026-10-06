# Changelog

## 0.1.0 (unreleased)

First release of `sirenic`, the Python client of the Sirenic API.

- `sirenic.Client`: API key (`api_key=` or `SIRENIC_API_KEY`, sent as `X-Api-Key`), per-call x402 payment with a
  hard price cap (`wallet_key=`, `max_price_usd=`, extra `[pay]`), or neither (paid routes raise
  `PaymentRequired` with the quote).
- The `[pay]` extra needs `x402` 2.20 or later, the first release whose `handle_402_response` takes the
  request URL; a wallet client refuses an older `x402` with an `ImportError` that names the installed version.
- Methods `suggestions`, `entreprise`, `dossier`, `kyb`, `facturation_dossier` and `get` for any other path.
- `sirenic.Response`: parsed data, per-block `provenance` (`Provenance`), `listes_bornees` at any depth,
  credits charged and remaining.
- Typed errors read from the service's responses: `PaymentRequired`, `PriceCapExceeded`, `PaymentFailed`,
  `InsufficientCredits`, `AccountRequired`, `AuthenticationError`, `InvalidRequest`, `NotFound`, `RateLimited`,
  `UpstreamUnavailable`, `ServiceUnavailable`, `NetworkError`.
- Tests on responses recorded from the live service on 2026-10-05, without network.
