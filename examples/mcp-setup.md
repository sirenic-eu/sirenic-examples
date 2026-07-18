# Use Sirenic from Claude, Cursor or any MCP client

Sirenic exposes a remote MCP server (streamable HTTP) at:

```
https://api.sirenic.eu/mcp
```

25 tools, including `search_french_companies`, `get_french_company_profile`,
`get_french_company_kyb_file`, `get_french_company_kyb_batch`,
`screen_sanctions_lists`, `get_french_company_financials`,
`get_french_company_default_risk`, `get_french_sector_benchmarks`,
`get_french_company_capital`, `get_french_company_capital_links`,
`get_french_company_accounts_notes`, `get_french_company_intellectual_property`,
`get_french_company_legal_alerts`, `get_french_company_changes`,
`search_french_company_directors`, `get_french_company_health_summary`,
`search_european_companies`, `get_french_company_pdf_report`, and more —
the full list is in the manifest: https://api.sirenic.eu/.well-known/mcp.json

## Claude Code (CLI)

```bash
claude mcp add --transport http sirenic https://api.sirenic.eu/mcp
```

## Cursor — `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "sirenic": { "url": "https://api.sirenic.eu/mcp" }
  }
}
```

## Any other MCP client

Point a streamable-HTTP transport at `https://api.sirenic.eu/mcp`. No auth
header is needed to connect or list tools.

## How payment works over MCP

Every tool takes an optional `x_payment` string parameter:

1. Call a tool **without** `x_payment` → you get the x402 quote back
   (price, USDC contract, receiving address, network).
2. Sign the payment with an x402 client (e.g. `@x402/fetch` or any wallet
   integration able to produce a `PAYMENT-SIGNATURE` header value).
3. Call the same tool again with `x_payment` set to that value → the data
   is returned once settlement is confirmed.

The MCP server holds no wallet and no keys — payment signatures always come
from the calling agent.
