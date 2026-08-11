# Response samples

One file per paid endpoint: the **real** response you get, truncated to one item
per array. These are **dated snapshots**, not live data — regenerating them
costs money, so they are refreshed at each paid smoke run.

Each sample is also served **live by the API**, free, at
`https://api.sirenic.eu/exemples/<file>` — the landing page links to it from every
row of the pricing table, so you can see what a route returns before paying for it.

The same samples are served by the API itself: in the OpenAPI spec
(`responses.200.content."application/json".example`), in the x402 payment quote
(`extensions.bazaar.info.output.example`) and in `llms.txt`. One source of
truth, four surfaces.

Two endpoints return a **PDF** and therefore have no JSON sample:
`GET /v1/rapport/{siren}` and `GET /v1/documents/{type}/{id}`. Two more are
waiting before we publish anything — capital links and Swedish accounts — because
the only material available is invented test data, and we would rather show
nothing than a plausible fabrication about a real company.

| Endpoint | Price | Sample |
|---|---|---|
| `GET /v1/recherche` | $0.001 | [`recherche.json`](recherche.json) |
| `GET /v1/entreprise/:siren` | $0.005 | [`entreprise-siren.json`](entreprise-siren.json) |
| `GET /v1/entreprise/:siren/etablissements` | $0.003 | [`entreprise-siren-etablissements.json`](entreprise-siren-etablissements.json) |
| `GET /v1/entreprise/:siren/alertes` | $0.01 | [`entreprise-siren-alertes.json`](entreprise-siren-alertes.json) |
| `GET /v1/entreprise/:siren/capital` | $0.35 | [`entreprise-siren-capital.json`](entreprise-siren-capital.json) |
| `GET /v1/entreprise/:siren/changements` | $0.01 | [`entreprise-siren-changements.json`](entreprise-siren-changements.json) |
| `GET /v1/entreprise/:siren/pi` | $0.03 | [`entreprise-siren-pi.json`](entreprise-siren-pi.json) |
| `GET /v1/entreprise/:siren/finances` | $0.01 | [`entreprise-siren-finances.json`](entreprise-siren-finances.json) |
| `GET /v1/entreprise/:siren/marches-publics-ue` | $0.02 | [`entreprise-siren-marches-publics-ue.json`](entreprise-siren-marches-publics-ue.json) |
| `GET /v1/entreprise/:siren/marches-publics` | $0.01 | [`entreprise-siren-marches-publics.json`](entreprise-siren-marches-publics.json) |
| `GET /v1/entreprise/:siren/sante` | $0.15 | [`entreprise-siren-sante.json`](entreprise-siren-sante.json) |
| `GET /v1/kyb/batch` | $0.105 | [`kyb-batch.json`](kyb-batch.json) |
| `GET /v1/comparer` | $0.12 | [`comparer.json`](comparer.json) |
| `GET /v1/kyb/:siren` | $0.15 | [`kyb-siren.json`](kyb-siren.json) |
| `GET /v1/sanctions/check` | $0.02 | [`sanctions-check.json`](sanctions-check.json) |
| `GET /v1/regulateurs/fr/alertes` | $0.01 | [`regulateurs-fr-alertes.json`](regulateurs-fr-alertes.json) |
| `GET /v1/entreprise/:siren/risques-industriels` | $0.01 | [`entreprise-siren-risques-industriels.json`](entreprise-siren-risques-industriels.json) |
| `GET /v1/entreprise/:siren/agrements` | $0.02 | [`entreprise-siren-agrements.json`](entreprise-siren-agrements.json) |
| `GET /v1/entreprise/:siren/lobbying` | $0.01 | [`entreprise-siren-lobbying.json`](entreprise-siren-lobbying.json) |
| `GET /v1/eu/agrements` | $0.01 | [`eu-agrements.json`](eu-agrements.json) |
| `GET /v1/surveillance/creer` | $0.05–$0.50 per target (`duree=30\|90\|365`) | [`surveillance-creer.json`](surveillance-creer.json) |
| `GET /v1/surveillance/:jeton/renouveler` | $0.05–$0.50 per target (`duree=30\|90\|365`) | [`surveillance-jeton-renouveler.json`](surveillance-jeton-renouveler.json) |
| `GET /v1/dirigeant/recherche` | $0.02 | [`dirigeant-recherche.json`](dirigeant-recherche.json) |
| `GET /v1/prospection` | $0.02 | [`prospection.json`](prospection.json) |
| `GET /v1/intelligence/:siren` | $1.00 | [`intelligence-siren.json`](intelligence-siren.json) |
| `GET /v1/eu/recherche` | $0.003 | [`eu-recherche.json`](eu-recherche.json) |
| `GET /v1/eu/entreprise/BE/:id` | $0.01 | [`eu-entreprise-BE-id.json`](eu-entreprise-BE-id.json) |
| `GET /v1/eu/entreprise/CH/:id` | $0.01 | [`eu-entreprise-CH-id.json`](eu-entreprise-CH-id.json) |
| `GET /v1/eu/entreprise/NO/:id` | $0.01 | [`eu-entreprise-NO-id.json`](eu-entreprise-NO-id.json) |
| `GET /v1/eu/entreprise/CZ/:id` | $0.01 | [`eu-entreprise-CZ-id.json`](eu-entreprise-CZ-id.json) |
| `GET /v1/eu/entreprise/SK/:id` | $0.01 | [`eu-entreprise-SK-id.json`](eu-entreprise-SK-id.json) |
| `GET /v1/eu/entreprise/FI/:id` | $0.01 | [`eu-entreprise-FI-id.json`](eu-entreprise-FI-id.json) |
| `GET /v1/eu/entreprise/PL/:id` | $0.01 | [`eu-entreprise-PL-id.json`](eu-entreprise-PL-id.json) |
| `GET /v1/eu/entreprise/EE/:id` | $0.01 | [`eu-entreprise-EE-id.json`](eu-entreprise-EE-id.json) |
| `GET /v1/eu/entreprise/LV/:id` | $0.01 | [`eu-entreprise-LV-id.json`](eu-entreprise-LV-id.json) |
| `GET /v1/eu/entreprise/ES/:hoja/actes` | $0.02 | [`eu-entreprise-ES-hoja-actes.json`](eu-entreprise-ES-hoja-actes.json) |
| `GET /v1/eu/entreprise/GB/:company_number/dirigeants` | $0.01 | [`eu-entreprise-GB-company_number-dirigeants.json`](eu-entreprise-GB-company_number-dirigeants.json) |
| `GET /v1/eu/entreprise/GB/:company_number/beneficiaires-effectifs` | $0.02 | [`eu-entreprise-GB-company_number-beneficiaires-effectifs.json`](eu-entreprise-GB-company_number-beneficiaires-effectifs.json) |
| `GET /v1/eu/entreprise/GB/:company_number/insolvabilite` | $0.02 | [`eu-entreprise-GB-company_number-insolvabilite.json`](eu-entreprise-GB-company_number-insolvabilite.json) |
| `GET /v1/eu/entreprise/LV/:id/comptes` | $0.03 | [`eu-entreprise-LV-regnr-comptes.json`](eu-entreprise-LV-regnr-comptes.json) |
| `GET /v1/eu/entreprise/LV/:regnr/insolvabilite` | $0.02 | [`eu-entreprise-LV-regnr-insolvabilite.json`](eu-entreprise-LV-regnr-insolvabilite.json) |
| `GET /v1/eu/entreprise/LV/:regnr/dirigeants` | $0.01 | [`eu-entreprise-LV-regnr-dirigeants.json`](eu-entreprise-LV-regnr-dirigeants.json) |
| `GET /v1/eu/entreprise/LV/:regnr/beneficiaires-effectifs` | $0.02 | [`eu-entreprise-LV-regnr-beneficiaires-effectifs.json`](eu-entreprise-LV-regnr-beneficiaires-effectifs.json) |
| `GET /v1/eu/entreprise/EE/:id/comptes` | $0.02 | [`eu-entreprise-EE-registrikood-comptes.json`](eu-entreprise-EE-registrikood-comptes.json) |
| `GET /v1/eu/entreprise/EE/:registrikood/evenements` | $0.02 | [`eu-entreprise-EE-registrikood-evenements.json`](eu-entreprise-EE-registrikood-evenements.json) |
| `GET /v1/eu/entreprise/SE/:orgnr/evenements` | $0.02 | [`eu-entreprise-SE-orgnr-evenements.json`](eu-entreprise-SE-orgnr-evenements.json) |
| `GET /v1/eu/entreprise/SE/:id` | $0.01 | [`eu-entreprise-SE-id.json`](eu-entreprise-SE-id.json) |
| `GET /v1/eu/entreprise/CZ/:ico/insolvabilite` | $0.02 | [`eu-entreprise-CZ-ico-insolvabilite.json`](eu-entreprise-CZ-ico-insolvabilite.json) |
| `GET /v1/eu/entreprise/PL/:krs/evenements` | $0.02 | [`eu-entreprise-PL-krs-evenements.json`](eu-entreprise-PL-krs-evenements.json) |
| `GET /v1/eu/entreprise/:pays/:id` | $0.01 | [`eu-entreprise-pays-id.json`](eu-entreprise-pays-id.json) |
| `GET /v1/eu/facturation/dossier` | $0.03 | [`eu-facturation-dossier.json`](eu-facturation-dossier.json) |
| `GET /v1/eu/entreprise/:pays/:id/transactions-dirigeants` | $0.02 | [`eu-entreprise-pays-id-transactions-dirigeants.json`](eu-entreprise-pays-id-transactions-dirigeants.json) |
| `GET /v1/eu/entreprise/NO/:id/comptes` | $0.02 | [`eu-entreprise-NO-id-comptes.json`](eu-entreprise-NO-id-comptes.json) |
| `GET /v1/eu/entreprise/NO/:id/evenements` | $0.02 | [`eu-entreprise-NO-id-evenements.json`](eu-entreprise-NO-id-evenements.json) |
| `GET /v1/eu/entreprise/DK/:id/comptes` | $0.01 | [`eu-entreprise-DK-id-comptes.json`](eu-entreprise-DK-id-comptes.json) |
| `GET /v1/eu/entreprise/DK/:id/comptes/:reference` | $0.05 | [`eu-entreprise-DK-id-comptes-date_cloture.json`](eu-entreprise-DK-id-comptes-date_cloture.json) |
| `GET /v1/eu/entreprise/DK/:cvr/dirigeants` | $0.01 | [`eu-entreprise-DK-cvr-dirigeants.json`](eu-entreprise-DK-cvr-dirigeants.json) |
| `GET /v1/eu/entreprise/SK/:id/comptes` | $0.01 | [`eu-entreprise-SK-ico-comptes.json`](eu-entreprise-SK-ico-comptes.json) |
| `GET /v1/eu/entreprise/SK/:id/comptes/:reference` | $0.03 | [`eu-entreprise-SK-ico-comptes-date_cloture.json`](eu-entreprise-SK-ico-comptes-date_cloture.json) |
| `GET /v1/eu/entreprise/GB/:company_number/comptes` | $0.01 | [`eu-entreprise-GB-company_number-comptes.json`](eu-entreprise-GB-company_number-comptes.json) |
| `GET /v1/eu/entreprise/GB/:company_number/comptes/:date_cloture` | $0.05 | [`eu-entreprise-GB-company_number-comptes-date_cloture.json`](eu-entreprise-GB-company_number-comptes-date_cloture.json) |
| `GET /v1/eu/entreprise/:pays/:id/comptes` | $0.01 | [`eu-entreprise-pays-id-comptes.json`](eu-entreprise-pays-id-comptes.json) |
| `GET /v1/eu/entreprise/:pays/:id/comptes/:reference` | $0.15 | [`eu-entreprise-pays-id-comptes-reference.json`](eu-entreprise-pays-id-comptes-reference.json) |
| `GET /v1/entreprise/:siren/documents` | $0.02 | [`entreprise-siren-documents.json`](entreprise-siren-documents.json) |
| `GET /v1/facturation/dossier` | $0.03 | [`facturation-dossier.json`](facturation-dossier.json) |
| `GET /v1/entreprise/:siren/facturation-prep` | $0.02 | [`entreprise-siren-facturation-prep.json`](entreprise-siren-facturation-prep.json) |
| `GET /v1/score/defaillance/:siren` | $0.10 | [`score-defaillance-siren.json`](score-defaillance-siren.json) |
| `GET /v1/secteur/:code_naf/benchmarks` | $0.05 | [`secteur-code_naf-benchmarks.json`](secteur-code_naf-benchmarks.json) |
| `GET /v1/iban/verifier/:iban` | $0.005 | [`iban-verifier-iban.json`](iban-verifier-iban.json) |
| `GET /v1/tva/verifier/:numero` | $0.003 | [`tva-verifier-numero.json`](tva-verifier-numero.json) |
