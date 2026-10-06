# sirenic: Python client for the Sirenic API

Company data from the official French and European registers (INSEE Sirene, INPI RNE and the national
registers of European countries), for scripts, back offices and agents. Every paid JSON response carries its
per-block provenance: which register each block came from, its licence, its version, its `as_of` date and a
state from a closed list.

- One class, `sirenic.Client`, and one dependency, `requests`.
- Paid routes are paid with an API key (prepaid credits) or per call in x402 (USDC or EURC on Base) with the
  optional `[pay]` extra and a hard price cap. With neither, a paid route raises `PaymentRequired` carrying
  the quote: a free dry run.
- Typed errors, read from the responses the service serves.
- Nothing stored, no key embedded; your key is sent to `base_url` only (default `https://api.sirenic.eu`, https
  required except on `localhost`): `get()` takes a path, never a URL, and a redirect to another host is not
  followed.

## Install

```bash
pip install sirenic            # API key, or free routes only
pip install "sirenic[pay]"     # per-call x402 payment with your own wallet
```

Python 3.10 or later.

## API key

Create an account and a key on the
[account page](https://api.sirenic.eu/compte?utm_source=forge&utm_campaign=sirenic), then:

```bash
export SIRENIC_API_KEY=srn_live_...
```

```python
import sirenic

client = sirenic.Client()  # reads SIRENIC_API_KEY; or sirenic.Client(api_key="srn_live_...")
profil = client.entreprise("552032534")
print(profil["denomination"], profil.credits_charged)
```

## Example

```python
import sirenic

client = sirenic.Client()

# Free: company name to SIREN
for s in client.suggestions("danone")["suggestions"]:
    print(s["siren"], s["denomination"])

# Paid: the identity plus two blocks, then the envelope of each block
dossier = client.dossier("552032534", blocs=["finances", "pi"])
for p in dossier.provenance:
    print(p.bloc, p.source_code, p.as_of, p.precision_as_of, p.etat)
for liste in dossier.listes_bornees:
    print(liste.path, liste.name, liste.nombre_total, liste.tronque)
```

## Methods

| Method | Route |
|---|---|
| `suggestions(q)` | `GET /v1/suggestions` (free) |
| `entreprise(siren)` | `GET /v1/entreprise/{siren}` |
| `dossier(siren, blocs)` | `GET /v1/entreprise/{siren}/dossier` |
| `kyb(siren)` | `GET /v1/kyb/{siren}` |
| `facturation_dossier(siren, iban=None)` | `GET /v1/facturation/dossier` |
| `get(chemin, params=None)` | any other path under `/v1/` |

Each returns a `sirenic.Response`: `data` (the parsed JSON), `response["field"]`, `provenance` (a list of
`sirenic.Provenance`), `bloc(name)`, `listes_bornees`, `credits_charged`, `credits_remaining` and
`request_id`.

## Reading the envelope

`Provenance` keeps the served field names: `bloc`, `source_code`, `registre`, `mode`, `licence`, `version`,
`as_of` (the snapshot date) and `precision_as_of` (what that date means: official publication, Sirenic
ingestion or live consultation), `age_jours`, `etat` (`servi`, `absence_mesuree`, `absence_non_conclusive`,
`partiel`, `perime`, `indisponible`, `sans_objet`), `motif`, `couverture`, `confiance` and
`empreinte_sha256`. A bounded list states its total and its cut in `listes_bornees`: `nombre_total`, `tronque`
and `total_borne_basse`. Read the states before the numbers: an `absence_non_conclusive` block does not mean
"nothing to report". The closed lists and the reading rules are served for free at
[`GET /v1/lecture`](https://api.sirenic.eu/v1/lecture), the register codes at
[`GET /v1/provenance/registres`](https://api.sirenic.eu/v1/provenance/registres).

## Paying per call with x402

```python
import os
import sirenic

client = sirenic.Client(wallet_key=os.environ["WALLET_KEY"], max_price_usd=0.25)
kyb = client.kyb("552032534")
```

The official [`x402`](https://pypi.org/project/x402/) package signs an EIP-3009 authorization locally: your
wallet key never leaves the process. A quote above `max_price_usd` raises `PriceCapExceeded` and nothing is
signed.

## Errors

| Exception | When |
|---|---|
| `PaymentRequired` | 402 with an x402 quote: `price`, `accepts` (`asset`, `asset_name`, `network`, `pay_to`, `amount`), `quote` |
| `PriceCapExceeded` | x402 rail, quote above `max_price_usd`; a subclass of `PaymentRequired` |
| `PaymentFailed` | x402 rail, the signed payment was not accepted |
| `InsufficientCredits` | 402 `credits_insuffisants` on the key rail: `solde`, `prix`, `recharge_url` |
| `AccountRequired` | 401 `compte_requis`: a route reserved to identified accounts (filed deeds) |
| `AuthenticationError` | 401 or 403: unknown, expired or revoked key, suspended or closed account |
| `InvalidRequest` | 400: a missing or malformed parameter (`champ`) |
| `NotFound` | 404 |
| `RateLimited` | 429: `retry_after` in seconds |
| `UpstreamUnavailable` | 503 `amont_indisponible`: the official source did not answer, retry later |
| `ServiceUnavailable` | any other 503, `code` from the closed list `motif_panne` of `GET /v1/lecture` |
| `NetworkError` | connection error or timeout |

All derive from `sirenic.SirenicError` (`status`, `code`, `message`, `body`, `headers`). A response with a
status of 400 or above is not charged.

## Prices

Each route has its own price, the same with an API key (1 credit = 1 EUR) and in x402 (USDC, or the same
figure in EURC). See the [price list](https://api.sirenic.eu/en/offres?utm_source=forge&utm_campaign=sirenic)
and the [API reference](https://api.sirenic.eu/en/api?utm_source=forge&utm_campaign=sirenic), one page per
route. `suggestions` is free.

## Links

- [Use cases](https://api.sirenic.eu/en/use-cases?utm_source=forge&utm_campaign=sirenic)
- [LangChain and CrewAI tools built on this client: `sirenic-agents`](https://pypi.org/project/sirenic-agents/)
- [Source and tests](https://github.com/sirenic-eu/sirenic-examples/tree/main/sdk/python-sirenic)

## License

MIT
