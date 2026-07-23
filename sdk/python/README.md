# sirenic-agents (Python) — LangChain & CrewAI tools for Sirenic

Official French & European company data in your agent, paid per call via
[x402](https://x402.org) (USDC or EURC on Base). **No account, no API key** —
bring a wallet key and a price cap. Without a wallet, every tool still works
and returns the payment quote.

```bash
pip install "sirenic-agents[pay,langchain] @ git+https://github.com/sirenic-eu/sirenic-examples#subdirectory=sdk/python"
# (PyPI publication coming — same package name)
```

## LangChain

```python
from sirenic_agents import SirenicClient, build_langchain_tools

client = SirenicClient(wallet_key=os.environ["WALLET_KEY"], max_price_usd=0.25)
tools = build_langchain_tools(client)   # search, profile, KYB, sanctions, intelligence, watchlists…
```

## CrewAI

```python
from sirenic_agents import SirenicClient, build_crewai_tools

client = SirenicClient(wallet_key=os.environ["WALLET_KEY"], max_price_usd=0.25)
agent = Agent(role="KYB analyst", tools=build_crewai_tools(client), ...)
```

CrewAI also speaks MCP natively — all 38 Sirenic tools in one line, no SDK:

```python
agent = Agent(role="KYB analyst", mcps=["https://api.sirenic.eu/mcp"], ...)
```

(The curated tools above add automatic x402 payment with a hard price cap;
via MCP, tools return quotes that your agent settles itself.)

Safety model: payments are EIP-3009 authorizations signed locally by the
official [`x402`](https://pypi.org/project/x402/) package (x402 Foundation);
the `max_amount` policy filters every quote before signing; errors are never
charged. Paid responses are Ed25519-signed by the server
([verify](https://api.sirenic.eu/.well-known/sirenic-signing-key)).
