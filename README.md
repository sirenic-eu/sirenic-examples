# Sirenic Examples

> 🚀 Sirenic launched on Product Hunt in July 2026: https://www.producthunt.com/products/sirenic

[![smithery badge](https://smithery.ai/badge/contact-erkc/sirenic)](https://smithery.ai/servers/contact-erkc/sirenic)
[![Listed on x402-list](https://x402-list.com/badge/sirenic.svg)](https://x402-list.com/services/sirenic?utm_source=badge&utm_medium=referral&utm_campaign=embed)

Working examples for [Sirenic](https://api.sirenic.eu) — official French and
European company data for AI agents: company lookup by name or SIREN, full
company profiles, KYB verification and due-diligence files, AML sanctions
screening, annual accounts and financial statements, default-risk scoring and
company monitoring, from the French company registry (INSEE Sirene, INPI RNE)
and official registers across 12 European countries. Pay-per-call in **USDC or
EURC** via the [x402 protocol](https://github.com/x402-foundation/x402):
**no account, no API key** — your agent pays each request on Base. Every paid response is
**Ed25519-signed** and verifiable offline
([recipe](https://api.sirenic.eu/.well-known/sirenic-signing-key)) — and carries
its **per-block provenance** (every JSON route since 2026-09-06): which official
register each block came from, its licence, its version and its `as_of` date, with
the exact meaning of that date (upstream official publication, Sirenic ingestion,
or live consultation) — plus a **common per-block envelope**: `etat` in a closed
list (`servi`, `absence_mesuree`, `absence_non_conclusive`, `partiel`, `perime`,
`indisponible`, `sans_objet`), `motif` when unavailable, `age_jours`, `couverture`
(complete / partielle / non_mesurable, with its measure) and `confiance` in bands
where a measure grounds it. Read the states before the numbers: an
`absence_non_conclusive` block is never "nothing to report".
Verify the signature, then read the provenance: your agent can prove to an
auditor what it knew when it paid. Register codes are resolved for free at
[`/v1/provenance/registres`](https://api.sirenic.eu/v1/provenance/registres),
and the states, closed lists and reading rules (a score is not a probability, a
match is not a sanction, never sum procurement rows, an absence is not a zero…)
at [`/v1/lecture`](https://api.sirenic.eu/v1/lecture) — both free.

- Landing & pricing: https://api.sirenic.eu
- OpenAPI: https://api.sirenic.eu/openapi.json
- For LLMs: https://api.sirenic.eu/llms.txt
- MCP server: `https://api.sirenic.eu/mcp` (streamable HTTP)
- A2A agent: `POST https://api.sirenic.eu/a2a` (JSON-RPC, a2a-x402 payment
  extension) — card at `https://api.sirenic.eu/.well-known/agent-card.json`

Data sources: INSEE Sirene / INPI RNE and other official registers, open
licenses (Etalab 2.0, NLOD, CC-BY 4.0, OGL, CC0). Data is redistributed
as published — every response carries `source` and `disclaimer` fields.

## Quickstart 0 — name → SIREN, for free (no wallet, no account, no key)

Every other call takes a SIREN. Getting one from a name costs nothing:

```bash
curl -s "https://api.sirenic.eu/v1/suggestions?q=carrefour"
```

Up to 5 matches, each with `siren`, `denomination`, `code_postal`, `commune`,
`code_naf` and `actif`. Source: the official INSEE Sirene register (open data).
Drop it straight into a form's autocomplete, or let your agent resolve the name
before it decides what to buy. Quota: 2,000 calls per day per IP.

It matches the **start** of the registered name, then whole words (`agricole`
finds CRÉDIT AGRICOLE) — no typo tolerance and no match-confidence score. For
those, `GET /v1/recherche` costs $0.002. Then pick your paid call below.

## Quickstart 1 — "Can you safely invoice or pay this company?"

One call, three answers: is the supplier still active, is its VAT number valid
**today**, and is that IBAN a real account at an identified bank. Start with the
quote — free, no wallet, no account:

```bash
curl -i "https://api.sirenic.eu/v1/facturation/dossier?siren=552032534&iban=FR1420041010050500013M02606"
```

Then pay the $0.03 and get the file, with a deterministic verdict:

```ts
const res = await payingFetch(
  "https://api.sirenic.eu/v1/facturation/dossier?siren=552032534&iban=FR1420041010050500013M02606",
);
const dossier = await res.json();
dossier.verdict.pret_a_facturer; // true | false
dossier.verdict.raisons;         // closed list: entreprise_cessee, tva_invalide_vies, iban_invalide…
```

`payingFetch` is the six-line x402 wrapper of Quickstart 3. Belgium and Poland:
`GET /v1/eu/facturation/dossier?pays=&id=&iban=` (same price, same verdict).
The response is Ed25519-signed and carries its provenance inside the signed
bytes — [`examples/verify-invoice-file.ts`](examples/verify-invoice-file.ts)
turns one call into an audit file that still re-verifies offline years later.
Why this matters in 2026: see [the section below](#verify-a-supplier-before-you-pay--the-2026-e-invoicing-window).

## Quickstart 2 — see a payment quote (no wallet needed)

```bash
curl -i "https://api.sirenic.eu/v1/entreprise/552032534" -H "Accept: application/json"
```

You get `HTTP 402` with the x402 payment requirements in the
`PAYMENT-REQUIRED` header and a JSON body. Each quote carries **two payment
options at the same numeric amount** — USDC (first, the default for existing
clients) or EURC — with the official Circle contracts, receiving address and
network.

## Quickstart 3 — pay and call in ~10 lines (TypeScript)

```bash
npm install @x402/fetch @x402/core @x402/evm viem
```

```ts
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const account = privateKeyToAccount(process.env.TEST_WALLET_KEY as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const payingFetch = wrapFetchWithPayment(fetch, client);

const res = await payingFetch("https://api.sirenic.eu/v1/entreprise/552032534");
console.log(await res.json()); // paid, settled, delivered
```

`TEST_WALLET_KEY` is the private key of **your client test wallet** (the
payer). The server never holds any key. The `exact` scheme uses signed
authorizations, so the client pays no gas.

## Quickstart 4 — plug into Claude / Cursor (MCP)

Claude Code:

```bash
claude mcp add --transport http sirenic https://api.sirenic.eu/mcp
```

Cursor / any MCP client (`mcpServers` config):

```json
{ "mcpServers": { "sirenic": { "url": "https://api.sirenic.eu/mcp" } } }
```

76 tools are exposed — including TWO FREE ones: suggest_company_names (type a company name, get its SIREN — start here) and detect_company_identifiers (paste any text, get SIREN/SIRET/VAT/LEI with the right call to make). Plus verify_iban_bank. Search with 0-1 confidence scores, company profiles,
KYB files, an à-la-carte company file where you pick the blocks and pay only for those, a $1 company-intelligence report, sanctions screening, AMF
regulator alerts, **regulatory authorisations by SIREN (EBA PSD2 register,
EIOPA, ARCEP)**, EU financial authorisations (ESMA), industrial risk
(Seveso/ICPE), lobbying register, EU procurement awards (TED), **watchlists
with daily checks and Ed25519-signed webhooks**, financials, capital structure, sector benchmarks, failure-risk score, Belgian annual accounts…). Each tool accepts
an optional `x_payment` parameter: without it you get the 402 quote; sign it
with an x402 client and call again. Every tool declares an **output schema**
and returns `structuredContent`, plus MCP annotations (read-only vs. state-
changing), so a client can type-check responses instead of parsing prose. The
quote you get back is the **signable x402 payment requirements**
(`{x402Version, accepts[]}`) — an agent can pay entirely from MCP, without
touching the REST API.

## Quickstart 5 — A2A (Agent2Agent)

Sirenic is also an A2A 1.0 agent with the official crypto payment extension
(a2a-x402). Discover it from the card, send a JSON data part, get the quote
as task metadata, pay on the same task:

```bash
curl -s https://api.sirenic.eu/.well-known/agent-card.json -H "A2A-Version: 1.0"
npx tsx examples/a2a.ts   # quote for free; add TEST_WALLET_KEY to pay
```

## Quickstart 6 — LangChain & CrewAI SDKs

Ready-made paying tools with a hard price cap ([sdk/typescript](sdk/typescript),
[sdk/python](sdk/python)):

```ts
import { sirenicTools } from "sirenic-agents";           // LangChain.js
const tools = sirenicTools({ walletKey, maxPriceUsd: 0.25 });
```

```python
from sirenic_agents import SirenicClient, build_crewai_tools   # CrewAI / LangChain
tools = build_crewai_tools(SirenicClient(wallet_key=key, max_price_usd=0.25))
```

CrewAI can also use Sirenic's MCP server directly, no SDK:
`Agent(..., mcps=["https://api.sirenic.eu/mcp"])`.

## Verify a supplier before you pay — the 2026 e-invoicing window

Three dates make this urgent, and only one of them is French:

- **France — September 1, 2026.** Every company subject to VAT must be able to
  RECEIVE electronic invoices; issuance is phased (large and mid-size companies
  September 2026, SMEs and micro-businesses September 2027). Art. 91, Loi de
  finances 2024.
- **Belgium — in force since January 1, 2026.** Structured e-invoicing is
  mandatory between Belgian VAT-registered businesses.
- **Poland — no deadline, a standing tax rule.** Paying more than PLN 15,000
  into an account the supplier has *not* declared in the official White List
  (wykaz podatników VAT) costs the buyer the deduction and exposes it to joint
  liability for the VAT (art. 117ba Ordynacja podatkowa).

Five routes cover it — no account, no API key:

| Route | Price | What it answers |
|---|---|---|
| **`GET /v1/facturation/dossier?siren=&iban=`** | **$0.03** | France: identity, VAT and IBAN in a single call, plus a deterministic `pret_a_facturer` verdict |
| `GET /v1/eu/facturation/dossier?pays=&id=&iban=` | $0.03 | Belgium & Poland: registry identity, VIES, Peppol reachability (BE), White List account check (PL) |
| `GET /v1/entreprise/{siren}/facturation-prep` | $0.02 | Legal name & form, computed intra-EU VAT number, SIRET establishments, indicative obligation dates |
| `GET /v1/iban/verifier/{iban}` | $0.005 | IBAN structure (ISO 13616, mod 97-10) + the bank identified from official registers, BIC via the GLEIF/SWIFT mapping |
| `GET /v1/tva/verifier/{numero}` | $0.003 | An EU VAT number, checked live against VIES |

One free call to `/v1/reperer?texte=` tells your agent which of them to use on
any raw text. The verdict's reasons are a **closed list** (`entreprise_cessee`,
`tva_invalide_vies`, `iban_invalide`…), so an agent branches on codes instead of
parsing prose — and a VIES outage yields an honest `tva_non_verifiable`, never a
false invalid.

Every one of these responses is Ed25519-signed, and the **provenance travels
inside the signed bytes**: which official register served each block, its
`as_of` date, and since 2026-09-06 its `etat` (served, measured absence,
non-conclusive absence, partial, stale, unavailable, not applicable). Verify the
signature, then read the provenance — that is an audit trail you can hand to an
accountant.
[`examples/verify-invoice-file.ts`](examples/verify-invoice-file.ts) writes one
to disk and re-verifies it from the files alone.

Two things this is **not**:

- **Not a check of the account holder's name.** Sirenic validates the IBAN and
  identifies the bank from official registers; it never confirms that the
  account belongs to the company you are about to pay.
- **Not an accredited platform (PDP).** Sirenic does not issue, transmit or
  route any invoice, and does not confirm a recipient's registration on the PPF
  or any accredited platform. It gives your agent the checks to run *before* the
  invoice exists.

## Endpoints and prices (USDC or EURC per call, same amount)

> A **real sample response** for every endpoint below is in
> [`examples/responses/`](examples/responses/) — dated, truncated to one item per
> array, and identical to what the OpenAPI spec and the x402 quote declare.

| Endpoint | Price | What you get |
|---|---|---|
| **`GET /v1/facturation/dossier?siren=&iban=`** | **$0.03** | **Verify a French supplier before payment**: e-invoicing prep + live VIES + IBAN/bank check + a deterministic `pret_a_facturer` verdict |
| `GET /v1/eu/facturation/dossier?pays=&id=&iban=` | $0.03 | Verify a Belgian or Polish supplier before payment: registry identity + VIES + Peppol reachability (BE) + White List account check (PL) + the same verdict |
| `GET /v1/recherche?q=` | $0.002 | French company search by name **or any French identifier** — SIREN, SIRET or VAT number, spaced or labelled (`SIREN : 552 032 534`), resolved directly. Company lookup over 30M companies (INSEE Sirene) |
| `GET /v1/entreprise/{siren}` | $0.005 | Full French company profile: identity, officers, NAF code, VAT number — plus `groupe_lei` for LEI holders: GLEIF level-2 consolidating parents (direct and ultimate, named) or the declared reason for none (17/09/2026) |
| `GET /v1/entreprise/{siren}/etablissements` | $0.003 | All establishments (SIRET) |
| `GET /v1/entreprise/{siren}/alertes` | $0.01 | BODACC legal alerts (insolvency…) |
| `GET /v1/entreprise/{siren}/finances` | $0.01 | Filed financials + ratios — one row per fiscal year, each graded (`qualite`: exploitable / a_verifier / non_exploitable, anomaly codes, doubtful fields); source rows set aside are served in `exercices_ecartes` with their reason; consolidated accounts served apart and graded the same way. **`decalage_analytique`**: latest statement filed at the register (INPI, live) vs latest year in the ratio dataset, with a closed-list reason — the dataset lags filings by months |
| `GET /v1/entreprise/{siren}/marches-publics` | $0.01 | Public procurement won (French DECP): estimated end dates, lot number, joint holders, CCAG, price type, advance, amendments and declared SUBCONTRACTING with its amount. **Each amount is flagged firm price or ENVELOPE** (call-off orders, subsequent contracts, optional tranches, framework ceiling — 43% of contracts): an amount is the whole contract or lot, excl. VAT, over its full duration, never annual revenue. **Totals come as two bounds** — raw per published row, and deduplicated per (buyer, date, amount, CPV) key, because the same award is often published twice — and each row carries a closed-list `publication.statut` with its linked rows |
| `GET /v1/entreprise/{siren}/marches-publics-ue` | $0.02 | EU procurement awards (TED, identifier-matched) |
| `GET /v1/entreprise/{siren}/financements-ue` | $0.02 | EU research funding received (CORDIS: Horizon 2020 and Horizon Europe projects, role, EU contribution, dates, status — matched on the published VAT number, partial coverage said; also served as `financements_ue` on BE/DK/FI/SE/CZ/CH/NO/LV profiles, 17/09/2026) |
| `GET /v1/marches/expirations?cpv=&departement=&fenetre_mois=` | $0.05 | **Tender anticipation** — French public contracts EXPIRING in your window (1-24 months), by CPV prefix and department, with incumbent holders, lot number, declared subcontracting and amounts flagged firm price or ENVELOPE. Buyers re-tender 4-9 months before expiry |
| `GET /v1/acheteur/{siret}/profil` | $0.02 | Public buyer profile: volumes, top CPV, incumbent suppliers and their expiring contracts, framework-agreement share, share of amounts that are envelopes rather than firm prices, share with declared subcontracting or an advance, dominant CCAG and price type, publishing platform, avg bids received |
| `GET /v1/entreprise/{siren}/concurrents-marches` | $0.02 | Who wins public contracts on the same CPV segments (last 3 years) |
| `GET /v1/entreprise/{siren}/risques-industriels` | $0.01 | Industrial risk: Seveso/ICPE facilities + synthesis |
| `GET /v1/entreprise/{siren}/emploi` | $0.02 | Hiring signals derived from France Travail data (actively hiring, posting volume, ROME families, pay-range share) + Egapro index + INSEE workforce bracket - aggregated signals only, never posting texts or contacts |
| `GET /v1/entreprise/{siren}/contentieux` | $0.01 | Commercial-court decisions linked to the company (Cour de cassation open data, Judilibre): counts, closed-list nature and role, other companies involved (SIREN only), official link per decision - no text, no individual's name; partial measured coverage (about 62%), so an empty list never means no litigation |
| `GET /v1/entreprise/{siren}/accords-collectifs` | $0.02 | Company-level collective agreements published on Légifrance (ACCO fund, PISTE API, Licence Ouverte 2.0): metadata only - nature (agreement/amendment), themes, signature/effect/end dates, unions, IDCC checked against Sirene, official link per text - never the agreement text nor a signatory's name; establishments queried by SIRET (25 at most, the rest counted), 24-hour cache, so an empty list is an inconclusive absence |
| `GET /v1/entreprise/{siren}/lobbying` | $0.01 | HATVP lobbying register (org-level: budgets, subjects, clients) |
| `GET /v1/entreprise/{siren}/changements?depuis=` | $0.01 | New BODACC events since a date |
| `GET /v1/entreprise/{siren}/pi` | $0.03 | Industrial property (trademarks, patents, designs) |
| `GET /v1/entreprise/{siren}/capital` | $0.35 | Ownership from public articles, AI-extracted |
| `GET /v1/entreprise/{siren}/sante` | $0.15 | AI health summary (7-day cache) |
| `GET /v1/score/defaillance/{siren}` | $0.10 | Failure-risk score (deterministic) |
| `GET /v1/secteur/{code_naf}/benchmarks` | $0.05 | Sector aggregates (k-anonymised) |
| `GET /v1/bodacc/recherche?famille=&depuis=` | $0.03 | **Which companies, not which company** — search the BODACC gazette by family (insolvency proceedings, accounts filings, deregistrations, sales…), date window and optionally a French department. Up to 100 announcements, newest first, each with SIREN, court and town. Built for scheduled monitoring. Sole traders are excluded (their name is personal data) and counted; the judgment is served STRUCTURED because its free text names court-appointed administrators with their address |
| `GET /v1/kyb/{siren}` | $0.15 | Full KYB file + sanctions screening |
| `GET /v1/entreprise/{siren}/dossier?blocs=` | $0.005 + per block, max $0.35 | **One call, you pick the blocks** — identity base plus any of `etablissements`, `alertes_bodacc`, `finances`, `marches_publics`, `marches_publics_ue`, `lobbying`, `risques_industriels`, `agrements`, `pi`, `documents`, `facturation_prep`, `score`. Each block costs what its own endpoint costs, so grouping never costs more than calling separately. A block that cannot be served is named with a reason (`aucune_donnee`, `non_diffusible`, `panne_amont`); if every requested block is down you get a 503 and pay nothing |
| `GET /v1/kyb/batch?sirens=` | $0.105/co | Batch KYB (2–100 companies) |
| `GET /v1/comparer?sirens=` | $0.12/co | Compare 2–5 French companies side by side (identity, financials, score) — with guards against false-but-plausible comparisons (different fiscal years, consolidated vs social accounts, holdings). Nine rankings (risk, revenue, net result, EBITDA margin, lowest debt, liquidity, revenue growth, cash vs short-term debt, seniority) each carry a status in `eligibilite_classements` with their data, scope, years and coverage: the evaluative risk ranking is served only when the batch is comparable and the ranked scores rest on the same axes; amounts are forbidden across fiscal years, ratios also across sectors or sizes; a forbidden ranking is absent, with its reasons |
| `GET /v1/sanctions/check?name=` | $0.02 | 6 official sanctions lists (UN, EU, OFAC, UK, FR, Swiss SECO), scored |
| `GET /v1/regulateurs/fr/alertes?nom=\|siren=` | $0.01 | AMF blacklists + PSAN/SGP registers (scam check, crypto providers) |
| `GET /v1/eu/agrements?q=` | $0.01 | EU financial authorisations in five official registers, by name or LEI: ESMA Registers (MiFID, all EU/EEA), the ECB list of supervised entities (`supervision_bce`: banking union, significant / less significant, group, national authority, monthly changes — conclusive by LEI only, and absence never means unsupervised outside the banking union), the ESMA registers of benchmark administrators (`administrateurs_indices`) and money market funds (`fonds_monetaires`: fund and manager LEI, status incl. Withdrawn served as a fact) and the EIOPA register of occupational pension institutions (`iorp`: only 30% carry a LEI, so zero by LEI is never conclusive); a block the source did not return is named in `blocs_absents` (17/09/2026) |
| `GET /v1/entreprise/{siren}/agrements` | $0.02 | Regulatory licences by SIREN: payment institution, e-money, account information, payment agent or exempt entity (EBA PSD2 register, daily), insurer (EIOPA), telecom operator (ARCEP) — with licensed services, EEA passporting and withdrawals |
| `GET /v1/dirigeant/recherche?nom=` | $0.02 | Reverse director search (surname; unsupported characters are stripped, not rejected) |
| `GET /v1/association/{rna}` | $0.005 | **French association (loi 1901) by RNA number** — Répertoire national des associations (Ministry of the Interior, monthly): title, purpose, position (active/dissolved/deleted), dates, registered office, website, RUP number as declared, and the SIREN when Sirene confirms it. Covers the associations that have **no SIREN** at all. No officer or declarant data; Alsace-Moselle (local law) excluded |
| `GET /v1/associations/recherche?q=` | $0.002 | Association search by name (trigram similarity), optional `code_postal`, `departement`, `position` filters — top 20 with `score_confiance` and the RNA number |
| `GET /v1/association/{rna}/annonces` | $0.01 | Official Journal notices of an association (JOAFE, DILA): creations, modifications, dissolutions — the association equivalent of BODACC, with `couverture` (first and last loaded issue) |
| `GET /v1/prospection?...` | $0.02/page | Multi-criteria prospecting |
| `GET /v1/rapport/{siren}` | $0.50 | PDF report |
| `GET /v1/intelligence/{siren}` | $1.00 | Intelligence report: every block cross-referenced — executive summary, officers´ network, filings, trends, closed-list signals, rule-based verdict with `motifs_verdict` (the codes that decided it), `verdict_plafonne_par` (name-match doubts that capped a would-be « solide » at « correct »), and since v1.7 `synthese.reserves` (closed-list reading caveats: holding scope, newer filing not analysed, unpublished cash, weak name matches…), `portee`, `confiance_financiere` and `par_domaine` (ten domains in closed lists, projected from blocks already served — the verdict word is unchanged). Since v1.9 `synthese.conclusions_interdites` lists, as a closed list, what THIS report does not allow you to infer (never a probability of default, a credit rating or an absence of risk; group health, current situation, cash position or an established sanction when the read data cannot support them) |
| `GET /v1/entreprise/{siren}/documents` | $0.02 | List filed documents (INPI) |
| `GET /v1/documents/{type}/{id}` | $0.10 | Download a filed document (PDF) |
| `GET /v1/facture/verifier?siren=&tva=&iban=` | $0.02 | **Invoice verification** — cross-check the identifiers printed on an invoice: VAT vs the SIREN's computed number + live VIES, IBAN form/key/bank; verdict coherent/incoherent/inverifiable, closed-list reasons. Not a payee verification |
| `GET /v1/tva/verifier/{numero}` | $0.003 | EU VAT validation (VIES) |
| `GET /v1/iban/verifier/{iban}` | $0.005 | IBAN check + bank identification (FR/BE/AT/NL, incl. LEI) — not a Verification of Payee |
| `GET /v1/surveillance/creer?cibles=&duree=` | $0.05 / $0.135 / $0.50 per target (30 / 90 / 365d) | **Watchlist**: daily checks on companies, directors and associations (RNA numbers, JOAFE notices), signed webhooks + e-mail digests, expiry warning at D-7 |
| `GET /v1/surveillance/{token}/renouveler?cibles=&duree=` | same per-target prices | Renew a watchlist for any duration, not just the original one (grace: 7 days after expiry; no refund, no pro rata) |
| `GET /v1/eu/recherche?q=` | $0.003 | Search European registers (BE, NO, EE, LV local; CZ, SK, FI, PL, CH live) + GLEIF — name of 2 characters or more |
| `GET /v1/eu/entreprise/{pays}/{id}` | $0.01 | Unified European profile — 12 countries: BE (KBO, NACEBEL + establishments), CH (Zefix), NO (Brønnøysund), CZ (ARES), SK (RPO), FI (PRH), PL (KRS), EE, LV… Each live country also has its own dedicated path (e.g. `/v1/eu/entreprise/CH/CHE-107.480.920`). Every profile carries `groupe_lei` (GLEIF level-2: consolidating parents named, or the declared reason for none; `sans_objet` without a LEI — 17/09/2026) |
| `GET /v1/eu/entreprise/BE/{id}/comptes` | $0.01 | Belgian filings list (official NBB Central Balance Sheet Office) |
| `GET /v1/eu/entreprise/BE/{id}/comptes/{ref}` | $0.15 | One Belgian annual-account deposit — structured JSON when the NBB publishes one, official PDF otherwise (`?format=pdf` forces the PDF, `?format=json` refuses the fallback and answers 406, not charged) |
| `GET /v1/eu/entreprise/{pays}/{id}/transactions-dirigeants` | $0.02 | Insider dealing at Belgian AND German listed companies (FSMA + BaFin, Art. 19 MAR): are its managers buying or selling? Issuer-level 12-month aggregate — **no individual is ever named**. BE: 10-digit enterprise number; DE: LEI or ISIN |
| `GET /v1/eu/entreprise/HR/{oib}` | $0.01 | Croatian company profile from the Sudski registar (court register, daily snapshot of the open API, Otvorena dozvola): identity, legal form, seat, VAT id, status with the running procedure, court, capital, main activity, published e-mails — 11-digit OIB, an 8-9-digit MBS is accepted (17/09/2026) |
| `GET /v1/eu/entreprise/HR/{oib}/insolvabilite` | $0.02 | Croatian insolvency: running procedure (bankruptcy, liquidation, pre-bankruptcy stages, estates) and court decisions by their extracted facts (court, reference, date) — never the decision text |
| `GET /v1/eu/entreprise/HR/{oib}/evenements` | $0.02 | Croatian court-register entries (108 types) in register order; published text only for a closed list of entry types without natural persons (`texte_retenu` otherwise) |
| `GET /v1/eu/entreprise/HR/{oib}/comptes` | $0.01 | Croatian annual-accounts filings per year (report, statement of inactivity, correction; period, filing date) — metadata only |
| `GET /v1/eu/entreprise/EE/{registrikood}/dirigeants` | $0.01 | Estonian officers and governance from the e-Business Register daily open data (RIK, CC BY 4.0): management board, procurators, liquidators, bankruptcy trustees, partners, contact persons, plus supervisory board, auditors and audit firms recorded beside the card — closed-list `organe`/`role` with the register's codes, current mandates only, representation rules; natural persons come with first name, last name and role, never the published identifier hash or birth date; legal persons only (17/09/2026) |
| `GET /v1/eu/entreprise/EE/{registrikood}/associes` | $0.02 | Estonian share register: holdings as published (percentage, nominal value, currency — EEK never converted), ownership type, date; AS shareholders and founders beside the card; share pledges; capital. Corporate holders named with their registrikood or foreign code, natural persons **counted, never named**. The EE profile also carries `registre_ee` (capital, EMTAK activities, contacts, statutes, successions) and `gages_commerciaux`; `/evenements` adds the typed registry-card entries (17/09/2026) |
| `GET /v1/eu/entreprise/LT/{kodas}` | $0.01 | Lithuanian company profile from the Juridinių asmenų registras (Registrų centras) daily open data on data.gov.lt (CC BY 4.0): name as published (the register itself anonymises sole proprietorships and partnerships, flagged), legal form, one of 31 register statuses with its date, VAT number and municipality from the VMI taxpayer register (the address is not published under an open licence), plus `registre_lt` (capital, taxpayer type, VAT dates, accounts-filing compliance, shareholder headcounts by category) and `fiscalite_lt` (today's tax arrears or their measured absence, taxes paid per month) (17/09/2026) |
| `GET /v1/eu/entreprise/LT/{kodas}/comptes` | $0.02 | Lithuanian annual accounts filed at the register (2015+): every financial year in one call, statutory and consolidated statements kept apart — non-current and current assets, total assets, equity, liabilities, tangible fixed assets, revenue, income, profit before tax, net profit in EUR as published; duplicated source lines merged, disagreements flagged (17/09/2026) |
| `GET /v1/eu/entreprise/LT/{kodas}/insolvabilite` | $0.02 | Lithuanian insolvency from two sources: the register's legal status (closed-list family: bankruptcy, liquidation, restructuring, removal) and the AVNT case files since 2020 (court, initiator, opening, liquidation, termination, closing and removal dates, simplified procedure, intentional-bankruptcy ruling, restructuring plan); `aucune_procedure` is measured on both snapshots. Lithuania also joins `/marches-publics-ue` (TED, 9-digit JAR code) (17/09/2026) |
| `GET /v1/eu/entreprise/PL/{nip}/marches-publics` | $0.02 | Polish public procurement from the Biuletyn Zamówień Publicznych (e-Zamówienia public API, CC0; national below-EU-threshold notices since 2021): contracts WON by a legal-person NIP — buyer, object, CPV, part, outcome, bids, price and contract value in PLN, date, company size — and notices ISSUED as buyer; a winner is served only when proven a legal person (legal form or KRS), never a sole trader |
| `GET /v1/eu/entreprise/PT/{nipc}/marches-publics` | $0.02 | Portuguese public contracts from IMPIC's Portal BASE (weekly open-data files, public domain; every public contract since 2012): contracts WON by NIPC — buyer, procedure and contract type, CPV, lots, contract/base/final prices in EUR, dates, framework agreement, closure, bidder count, contract modifications —, contracts ISSUED as buyer and Diário da República notices; winners published without a NIF are never named, only counted |
| `GET /v1/eu/entreprise/FI/{id}/evenements` | $0.02 | Finnish trade-register notices served live from the PRH open data (CC BY 4.0, 24 h cache): every notice since late 2014 — date, record number, type (formation, change, annual accounts, rectification, merger; source code always served) and its register entry codes, each with the PRH labels in EN/FI/SV and a closed-list family (board, representation, capital, shares, office, auditors, articles, bankruptcy, restructuring, liquidation, removal, merger, demerger…); `procedures_inscrites` summarises insolvency-family codes; register memberships (trade, VAT, prepayment, employer) and `tva_active`. The FI profile also carries `registres_fi` (18/09/2026) |
| `GET /v1/eu/entreprise/CH/{id}/evenements` | $0.02 | Swiss commercial-register publications from the Swiss Official Gazette of Commerce (SOGC/SHAB, SECO public API, live with a 24 h cache, online since July 2018): every registration, change and deletion carrying the company's UID, newest first — date, publication number, canton, office, the company as published before and after (name, UID, seat, eCH legal-form code, purpose, capital, address without the c/o line) and closed-list change flags (name, seat, address, purpose, capital, legal form, bankruptcy, liquidation, suspension, re-entry, other entries). The published free text is withheld (`texte_retenu: true`): it names persons (18/09/2026) |
| `GET /v1/eu/entreprise/CH/{id}/insolvabilite` | $0.02 | Swiss bankruptcy publications from the SOGC/SHAB (live, online since 2021) whose debtor is the company — natural persons never served: preliminary notice, bankruptcy publication and call to creditors, suspension, schedule of claims and inventory, distribution list, closing, revocation, real-estate auction, recognition of a foreign bankruptcy — with decision date, deadlines, office, canton and the official labels in DE/FR/IT/EN; `aucune_procedure` is a fact bounded by the online archive for a company known to Zefix (18/09/2026) |
| `GET /v1/eu/entreprise/CY/{id}` | $0.01 | Cypriot company profile from the Registrar of Companies (DRCOR) monthly open data on data.gov.cy (CC BY 4.0): current name, type and sub-type (HE company, AE overseas company), one of 12 dated register statuses in a closed family (registered, reminder letter, strike-off notice, struck off, voluntary or court liquidation, receivership, dissolution, merger), registration date, registered office, plus `registre_cy` (status family, `procedure_au_registre`, office parts, mandates count). Number with its HE/AE prefix (Greek homographs and a space accepted); business names, partnerships and BN are not legal persons and are refused before payment. Fail-closed 503 beyond 45 days without an upstream publication. |
| `GET /v1/eu/entreprise/CY/{id}/dirigeants` | $0.01 | Cypriot company officers from the DRCOR monthly open data: every published mandate — directors, alternate directors, company secretaries, assistant and deputy secretaries, authorised persons of overseas companies — with the register's Greek role label and a closed-list family, sorted by family then name; `aucun_mandat_publie` measured on the complete national snapshot. Name and role only: the source publishes no birth date, address, nationality or mandate date and does not tell natural persons and corporate officers apart. Legal persons only (HE, AE). |
| `GET /v1/eu/entreprise/RO/{cui}` | $0.01 | Romanian company profile from the ONRC trade register monthly open data on data.gov.ro (CC BY 4.0): current name, legal form, every registration code of the company (re-registrations kept, the most recent flagged current), the register's status codes in 15 closed families (in operation, struck off, bankruptcy, insolvency, liquidation, dissolution, suspension, administrative alerts…), registered office, EU branches, mandates count (`registre_ro`). CUI with or without the RO prefix. Legal persons only: sole traders (PFA), individual and family enterprises are refused 404 without charge. Fail-closed 503 beyond 70 days without an upstream snapshot. |
| `GET /v1/eu/entreprise/RO/{cui}/dirigeants` | $0.01 | Romanian company legal representatives from the ONRC open data: every mandate published under each registration of the CUI — administrators, permanent representatives of corporate administrators, general director, supervisory board, directorate, liquidators, judicial administrators — with the Romanian label, a closed-list family and the nature (natural person / entity, inferred from the presence of a birth date), deduplicated and sorted; `aucun_mandat_publie` measured on the complete snapshot. Name and capacity only: birth date, birthplace and domicile published by the source are never stored. |
| `GET /v1/eu/entreprise/RO/{cui}/insolvabilite` | $0.02 | Romanian company insolvency from the ONRC register: status codes of the bankruptcy, insolvency (Laws 85/2014, 85/2006, 64/1995, judicial reorganisation, recovery), liquidation and dissolution families with their published Romanian labels, plus the published insolvency practitioners (judicial liquidator, judicial administrator, special or concordat administrator, liquidator); `aucune_procedure` measured on the complete snapshot; statuses are undated and court decisions are not published (`autres_statuts` carries the other entries). |
| `GET /v1/eu/entreprise/RO/{cui}/comptes` | $0.02 | Romanian company annual accounts from the Ministry of Finance open data (data.gov.ro, CC BY 4.0, financial years 2019-2024), every published year in one call: balance sheet (fixed and current assets, inventories, receivables, cash, liabilities, provisions, equity, paid-up capital), income statement (net turnover, total income and expenses, gross and net result), average headcount, CAEN Rev. 2 class and filing format (abridged or full). RON as published; null = not published. Legal persons only. |
| _…plus ~30 dedicated country sub-routes_ | | GB (directors, PSC, insolvency, accounts, The Gazette insolvency notices — official journal, coverage partial and said so —, public procurement from Find a Tender and Contracts Finder: contracts won matched by company number and notices issued, 17/09/2026), DK/SE/SK/LV/EE (filings), LV/NO/BE/DK/FI/SE/CZ/SK/EE (`/marches-publics-ue`: TED award notices matched by national identifier in every form TED publishes it — 40 to 86% of notices carry one depending on the country, measured and said so, 17/09/2026), LV (legal events, members & shareholders — corporate holders named, natural persons counted —, public procurement from the IUB daily notices: contracts won and notices issued, never a natural-person winner, 17/09/2026), NO (accounts, legal events, officers & board with who elected them, local units with published headcount — natural persons never with a birth date), CZ (insolvency), PL (KRS events), ES (PLACSP public procurement by NIF, BORME deeds), PL (BZP public procurement by NIP: winners served only when proven legal persons), PT (Portal BASE public contracts by NIPC, with contract modifications) — all in `/openapi.json` and the MCP tools |

**Don't clean up the query yourself.** Search parameters (`?q=`, `?nom=`) accept
what an agent naturally produces: quotes, punctuation and unsupported characters
are **stripped, not rejected** — no 400 for a stray quote. Paste an identifier as
you found it and it resolves directly: `SIREN : 552 032 534`, a 14-digit SIRET or
an FR VAT number all land on the right company. A 400 comes back only when nothing
searchable is left — and **no error response is ever billed**.

Free: `GET /` (landing), `GET /v1/suggestions?q=` (**company-name autocomplete →
SIREN**, up to 5 matches, 2,000 calls/day/IP),
`GET /preview/entreprise/55203253400646` (sample
response), `GET /v1/reperer?texte=` (**detect SIREN/SIRET/VAT/LEI in any text**,
with the suggested paid call and its price), `GET /openapi.json`,
`GET /llms.txt`, `GET /healthz`; watchlist
status `GET /v1/surveillance/{token}` and stop `…/{token}/arreter` (the token
returned at creation is the capability — no account).

## In this repo

- [`examples/smoke-bodacc-2026-08-11.ts`](examples/smoke-bodacc-2026-08-11.ts) — buy the **BODACC criteria search** for real (3 purchases, $0.09) and check that no court-appointed administrator is ever named in the response.
- [`examples/smoke-dossier-2026-08-11.ts`](examples/smoke-dossier-2026-08-11.ts) — buy the **à-la-carte company file** for real (4 purchases, ~$0.32) and check the quote matches the blocks asked for.
- [`examples/smoke-eu-recherche-reprise-2026-08-25.ts`](examples/smoke-eu-recherche-reprise-2026-08-25.ts) — re-buy the **European search** for Norway after it answered `503 registres_muets` ($0.003): the script names the three outcomes it can measure — a real result, a **paid empty answer**, or a persistent 503 — and exits non-zero on the last two, because "we retried and it looked fine" is not a measurement.
- [`examples/smoke-entrees-clementes-2026-08-30.ts`](examples/smoke-entrees-clementes-2026-08-30.ts) — buy the **agent-shaped queries** for real ($0.006): quotes around a name are served, a spaced and labelled SIREN resolves directly, and two negatives — a euro amount must **not** resolve to a company, and a 400 must **not** be billed while still recording which rule and which field refused it.
- [`examples/smoke-intelligence-contentieux-2026-09-13.ts`](examples/smoke-intelligence-contentieux-2026-09-13.ts) — buy the **intelligence report** for real once ($1.00) after the 2026-09-13 deployment and check that the new **commercial-court decisions block** (Judilibre stock, `version_rapport` 1.10) is served as signed: zero linked decision reads as an *inconclusive absence* under a measured partial coverage — never as "no litigation" — with the matching closed-list domain, forbidden conclusion and summary line, and no decision text nor person name anywhere.
- [`examples/smoke-comptes-partiels-2026-09-13.ts`](examples/smoke-comptes-partiels-2026-09-13.ts) — buy `/finances`, `/documents` and one **balance-sheet PDF** for real ($0.13) on a company whose 2023-2024 accounts were filed with a **confidential income statement** (French art. L. 232-25 C. com.): the 2024 year must carry the cause (`compte_de_resultat_confidentiel`), unpublished items must be `null` rather than 0, the INPI listing must name the filing's status, and the registry's partial PDF must be served as is. Its first run (2026-09-13 16:49 UTC) caught a 24-hour **list cache** written by the previous code — the fix versions the cache key.
- [`examples/smoke-accords-collectifs-2026-09-13.ts`](examples/smoke-accords-collectifs-2026-09-13.ts) — buy the new **collective agreements** route for real once ($0.02, Légifrance ACCO via the PISTE API) and check that only **metadata** is served (nature, themes, dates, unions, IDCC consistent with Sirene, official Légifrance link) — never the agreement text nor a person's name — under a measured partial coverage, with the signed envelope and a free `HEAD`.
- [`examples/suggestions.ts`](examples/suggestions.ts) — the **free** name → SIREN autocomplete, and the checks that prove it stays free (no wallet needed: `npx tsx examples/suggestions.ts`).
- [`examples/quote.sh`](examples/quote.sh) — inspect a 402 quote with curl.
- [`examples/pay-and-call.ts`](examples/pay-and-call.ts) — pay one request end to end.
- [`examples/verify-invoice-file.ts`](examples/verify-invoice-file.ts) — **verify a supplier before you pay, and keep the proof** (~$0.03): buy the invoicing file, verify its signature offline, read the `pret_a_facturer` verdict and its provenance only once authenticated, then write a timestamped audit folder (raw bytes, signature, public key, `LISEZ-MOI.md`) and re-verify it from those files alone.
- [`examples/verify-signature.ts`](examples/verify-signature.ts) — **the full audit loop**: verify the Ed25519 signature of a paid response offline, then read its **per-block provenance** (official register + `as_of` date) from inside the signed bytes (~$0.02).
- [`examples/responses/`](examples/responses/) — **what you actually get back**: one
  real, dated sample per paid endpoint, truncated to one item per array. The same
  samples are served by the API itself, in the OpenAPI spec, in the x402 payment
  quote and in `llms.txt` — so the contract you read is the contract you get.
- [`examples/smoke-surveillance-durees-2026-08-11.ts`](examples/smoke-surveillance-durees-2026-08-11.ts) — buy a **90-day** and a **365-day** watchlist for real (~$0.685), renew one at a different duration, and check that an out-of-range duration and an over-long renewal are both refused **without a debit**.
- [`examples/smoke-test.ts`](examples/smoke-test.ts) — pay and call the core paid endpoints once (~46 calls across the 83-route catalogue, USDC and/or EURC; the watchlist it creates is stopped again for free). Country deep-dive sub-routes have their own dedicated smokes in this folder.
- [`examples/agent-demo.ts`](examples/agent-demo.ts) — a small autonomous agent that searches, pays and reads profiles.
- [`examples/mcp-setup.md`](examples/mcp-setup.md) — MCP configuration for Claude, Cursor and generic clients.
- [`examples/a2a.ts`](examples/a2a.ts) — call Sirenic as an **A2A agent** (quote for free, then pay on the same task via the a2a-x402 extension).
- [`tutorial-kyb-agent/`](tutorial-kyb-agent/) — **Build a KYB agent in 20 lines**.
- **n8n community node** — moved to its own repository (n8n verification requires credentials/ at the repo root): https://github.com/sirenic-eu/n8n-nodes-sirenic — `npm i n8n-nodes-sirenic`

## Test wallet setup

1. Create a throwaway wallet (e.g. in MetaMask) and export its private key.
2. Fund it with a couple of dollars of USDC on **Base** (any exchange can withdraw to Base network).
3. `export TEST_WALLET_KEY=0x...` — never commit it anywhere.

Sirenic settles on Base mainnet.

## Disclaimer

Sirenic redistributes official open data as published (Etalab 2.0 and other
open licenses). It does not guarantee accuracy or completeness, and outputs
(including sanctions screening and AI summaries) are decision aids — not
legal, financial or compliance advice.

License: MIT.
