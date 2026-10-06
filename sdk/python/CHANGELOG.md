# Changelog

## 0.3.0 (unreleased)

- Built on [`sirenic`](https://pypi.org/project/sirenic/) 0.1 (new dependency `sirenic>=0.1,<0.2`): the HTTP
  calls, the x402 payment and the errors now come from the Python client of the API.
- API key rail: `SirenicClient(api_key=...)`, or the `SIRENIC_API_KEY` environment variable when no wallet is
  given; calls are paid with prepaid credits.
- A quote above `max_price_usd` now returns the quote with `price_cap_exceeded: true` (it was a
  `payment_refused_or_network` error); errors carry the service's `code`.
- The `pay` extra is now `sirenic[pay]` (same official `x402` package), with `x402` 2.20 or later: 2.16 to
  2.19, allowed by 0.1.0, cannot build a payment. `pip install -U "sirenic-agents[pay]"` upgrades it.
- Search tool description: price corrected to $0.002, the price served for `GET /v1/recherche`.
- README: the API key rail, the MCP tool count measured on 2026-10-05 (109), tagged links.
- Tests of the tool construction on the key, wallet and quote-only rails, without network.
- The stale `sirenic_agents.egg-info` and a compiled cache are no longer in the repository.

## 0.2.0 (never published)

- Licences tool, invoicing checks for France, Belgium and Poland, watchlists of 30, 90 or 365 days.

## 0.1.0 (2026-07-23, on PyPI)

- LangChain and CrewAI tools with x402 auto-payment and a hard price cap.
