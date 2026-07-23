# sirenic-agents (TypeScript) — LangChain.js tools for Sirenic

Official French & European company data in your agent, paid per call via
[x402](https://x402.org) (USDC or EURC on Base). **No account, no API key** —
bring a wallet key and a price cap. Without a wallet, every tool still works
and returns the payment quote (great for dry runs).

```bash
npm install github:sirenic-eu/sirenic-examples#path:/sdk/typescript @langchain/core
# (npm registry publication coming — same package name)
```

```ts
import { sirenicTools } from "sirenic-agents";

const tools = sirenicTools({
  walletKey: process.env.WALLET_KEY,   // your paying wallet (never sent anywhere)
  maxPriceUsd: 0.25,                   // hard cap: quotes above are NEVER signed
});

// Drop into any LangChain.js agent:
const agent = createReactAgent({ llm, tools });
```

9 tools: search ($0.001), full profile ($0.005), KYB file ($0.15), sanctions
screening ($0.02), AMF regulator alerts ($0.01), EU financial authorisations
via ESMA ($0.01), the $1 intelligence report, 30-day watchlists ($0.05/target)
and a generic `sirenic_get` covering the whole catalog
([prices](https://api.sirenic.eu/llms.txt)).

Safety model: payments are EIP-3009 authorizations signed locally by the
official `@x402/*` packages; the price-cap policy filters every quote before
signing; errors are never charged (server cancels verified payments on any
non-200). Paid responses are Ed25519-signed by the server
([verify](https://api.sirenic.eu/.well-known/sirenic-signing-key)).
