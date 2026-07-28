# n8n-nodes-sirenic

Official French and European company data in n8n — **no API key, no account, no contract**.

Sirenic is paid per call over [x402](https://x402.org): each request settles a small USDC
payment on Base. You bring a wallet, you set a spending cap, you are done. Prices run from
**$0.001** to **$2.00** per call, and you only pay for calls that succeed.

## What you can do

| Operation | What it answers | Price |
|---|---|---:|
| **Search Company** | "Which company is this, exactly?" — by name, with a confidence score | $0.001 |
| **Get Company Profile** | Legal name, form, head office, activity, workforce, officers, VAT number | $0.005 |
| **Get KYB File** | Everything to onboard a supplier in one call, including sanctions screening | $0.15 |
| **Screen Sanctions** | A name against 6 official lists (UN, EU, OFAC, UK, French freezes, Swiss SECO) | $0.02 |
| **Verify VAT Number** | An intra-EU VAT number, checked against VIES | $0.003 |
| **Get European Company** | 13 countries under one schema | $0.01 |
| **Watch Companies** | 1 to 100 companies, notified when something changes | $0.05 |

Every paid answer carries its source, its freshness date and an Ed25519 signature, so an
audit trail comes for free.

## The workflow this node was built for

**Watch Companies** takes a webhook URL. Point it at an n8n **Webhook** node and you have
supplier monitoring in three nodes:

```
[Sirenic: Watch Companies] ──▶ (registers 1-100 suppliers, once)

[Webhook] ──▶ [Filter: insolvency] ──▶ [Slack]
      ▲
      └── Sirenic calls this whenever an officer changes, an insolvency
          is published, or a company is struck off.
```

Detection runs **daily**, aligned on how often the official sources publish — the BODACC
issues one edition a day. Nobody can honestly offer real time on registry data.

## Setup

1. Install the node: **Settings → Community Nodes → Install** → `n8n-nodes-sirenic`
2. Create a **Sirenic API** credential.

### Funding a wallet

You need a Base (mainnet) wallet holding USDC.

1. Create a **dedicated** wallet — never reuse your main one.
2. Fund it with USDC on Base. $5 covers thousands of calls.
3. Paste its private key into the credential.

The key never leaves your n8n instance: payments are signed locally, and only the resulting
signature travels to Sirenic.

### Spending caps are not optional

| Setting | Default | What it does |
|---|---|---|
| **Max Amount Per Call** | $0.20 | The node refuses to sign a quote above this, whatever the API asks |
| **Max Amount Per Execution** | $5.00 | Ceiling across every item of one execution — your protection against a loop over 10 000 rows |
| **Expected Payment Address** | Sirenic's address | The node refuses to pay anyone else, so a spoofed endpoint cannot redirect funds |

Turn on **Dry Run** in Options to see what a call would cost without paying for it.

## Coverage

**France** in depth (INSEE Sirene, INPI RNE, BODACC, filed accounts, procurement,
intellectual property, regulatory authorisations) plus **Belgium, Czechia, Denmark,
Estonia, Finland, Latvia, Norway, Poland, Slovakia, Switzerland and the United Kingdom**,
and worldwide LEI data through GLEIF.

**No beneficial ownership, ever.** The CJEU closed public UBO registers in 2022 and French
law excludes them from public dissemination. Sirenic does not reconstruct control chains —
which is precisely what keeps the data defensible under GDPR.

## Compatibility

Requires n8n with Node.js ≥ 22.22. No runtime dependencies: everything is bundled.

## Resources

- API documentation: <https://api.sirenic.eu>
- Machine-readable tool list: <https://api.sirenic.eu/llms.txt>
- x402 protocol: <https://x402.org>

## License

MIT
