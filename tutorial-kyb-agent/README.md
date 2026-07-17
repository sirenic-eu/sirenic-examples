# Build a KYB agent in 20 lines

Know-Your-Business checks normally mean juggling four or five data sources:
the company register, a legal-announcements gazette, filed accounts, and
several sanctions lists. [Sirenic](https://api.sirenic.eu) consolidates all
of that into **one paid call** — `GET /v1/kyb/{siren}` at $0.15 in USDC —
and because payment happens over HTTP with [x402](https://github.com/x402-foundation/x402),
your agent needs **no account and no API key**.

## What one call returns

- Official identity (INSEE Sirene / INPI RNE) + officers (name, role, birth
  year only — French GDPR rules).
- BODACC legal alerts: insolvency proceedings, deregistrations, business sales.
- Filed financials (revenue, EBITDA, net income, ratios per fiscal year).
- **Sanctions screening of the company AND each officer** against the 5
  official lists (UN, EU, OFAC, UK, French asset-freeze register), with a
  0-100 confidence score per hit — never a bare yes/no.
- A completeness score plus the list of missing blocks and why. If one
  upstream source is down, you still get the rest — and if the company
  doesn't exist, the payment is cancelled: you never pay for an error.

## The agent

See [`kyb-agent.ts`](kyb-agent.ts) — the whole thing:

1. Wrap `fetch` with `@x402/fetch` and your test wallet.
2. `GET /v1/kyb/{siren}` — the wrapper sees the 402 quote, signs a USDC
   authorization, retries, and the API answers after settlement.
3. Print the verdict.

```bash
npm install
export TEST_WALLET_KEY=0x...   # throwaway wallet, test USDC from faucet.circle.com
npm run kyb-agent -- 552032534 # Danone
```

Typical output:

```
Company : DANONE (552032534) — actif
Officers: 13 | VAT: FR27552032534
Alerts  : 0 insolvency proceedings
Sanctions screening: correspondances_a_verifier
Completeness: 100/100
```

`correspondances_a_verifier` means at least one fuzzy match needs a human
look — the response details every match with its score, matched alias and
source list. This is a screening aid, not a compliance opinion.

## Going further

- `GET /v1/entreprise/{siren}/sante` ($0.15): an AI-written health summary
  (strengths, warning signs, confidence level) generated from the same
  official data only.
- `GET /v1/rapport/{siren}` ($0.50): the whole file as a shareable PDF.
- `GET /v1/eu/entreprise/{pays}/{id}` ($0.01): same idea across European
  registers (Norway, Estonia, Latvia + GLEIF worldwide).

Full API: https://api.sirenic.eu/openapi.json · Data: official open data
(Etalab 2.0 and other open licenses), redistributed as published.
