# sirenic-agents (Python): LangChain and CrewAI tools for Sirenic

Company data from the official French and European registers in your agent: search, profile, KYB, sanctions
screening, licences, invoicing checks (France, Belgium, Poland), intelligence report and watchlists. Three ways
to pay a call:

- an **API key** (prepaid credits, 1 credit = 1 EUR): `api_key=` or the `SIRENIC_API_KEY` environment variable;
- a **wallet** paying each call via [x402](https://x402.org) (USDC or EURC on Base), with a hard price cap;
- **neither**: every tool still works and returns the payment quote (discovery and dry runs).

Built on [`sirenic`](https://pypi.org/project/sirenic/), the Python client of the API.

```bash
pip install "sirenic-agents[langchain]"        # or [crewai]; add [pay] to pay with a wallet
```

## LangChain

```python
import os

from sirenic_agents import SirenicClient, build_langchain_tools

client = SirenicClient(api_key=os.environ["SIRENIC_API_KEY"])
tools = build_langchain_tools(client)   # 10 tools: search, profile, KYB, sanctions, licences, invoicing (FR/BE/PL), intelligence, watchlists, any path
```

## CrewAI

```python
import os

from crewai import Agent
from sirenic_agents import SirenicClient, build_crewai_tools

client = SirenicClient(wallet_key=os.environ["WALLET_KEY"], max_price_usd=0.25)   # x402: pip install "sirenic-agents[pay,crewai]"
agent = Agent(role="KYB analyst", tools=build_crewai_tools(client), ...)
```

CrewAI also speaks MCP natively: every Sirenic MCP tool in one line, no SDK (109 tools on 2026-10-05; the
[connectors page](https://api.sirenic.eu/en/connectors?utm_source=forge&utm_campaign=sirenic-agents) gives today's count):

```python
agent = Agent(role="KYB analyst", mcps=["https://api.sirenic.eu/mcp"], ...)
```

(The curated tools above add the API key or the automatic x402 payment with a hard price cap; via MCP, tools
return quotes that your agent settles itself, or pass your API key.)

Every tool returns a JSON string: the data, the quote (`payment_required: true`, with
`price_cap_exceeded: true` when the quote is above your cap) or the error. Responses with a status of 400 or
above are not charged.

Safety model: with a wallet, payments are EIP-3009 authorizations signed locally by the official
[`x402`](https://pypi.org/project/x402/) package (x402 Foundation); the price cap filters every quote before
signing, and your wallet key never leaves the process. Paid responses are Ed25519-signed by the server
([verify](https://api.sirenic.eu/.well-known/sirenic-signing-key)).

## Links

- [KYB checks with provenance on every block, step by step](https://api.sirenic.eu/en/use-cases/kyb-automated-business-verification-with-per-block?utm_source=forge&utm_campaign=sirenic-agents)
- [All use cases](https://api.sirenic.eu/en/use-cases?utm_source=forge&utm_campaign=sirenic-agents)
- [API reference, one page per route with its price](https://api.sirenic.eu/en/api?utm_source=forge&utm_campaign=sirenic-agents)
