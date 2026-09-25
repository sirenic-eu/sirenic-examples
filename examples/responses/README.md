# Response samples

One file per paid endpoint, each an extract of **real** data (a paid response, or the source's own
records): trimmed by removal (one item per array, some fields left out), never rewritten; natural
persons and bearer tokens appear only as placeholders. These are **dated snapshots**, not live data:
they are refreshed from paid purchases.

Each sample is also served **live by the API**, free, at
`https://api.sirenic.eu/exemples/<file>`: the landing page links to it from every
row of the pricing table, so you can see what a route returns before paying for it.

The same samples are served by the API itself: in the OpenAPI spec
(`responses.200.content."application/json".example`), in the x402 payment quote
(`extensions.bazaar.info.output.example`) and in `llms.txt`. One source of truth, from which this
folder is regenerated. One file is the full paid response rather than the served extract:
`score-defaillance-siren.json` (2026-09-25).

Two endpoints return a **PDF** and therefore have no JSON sample:
`GET /v1/rapport/{siren}` and `GET /v1/documents/{type}/{id}`.

| Endpoint | Price | Sample |
|---|---|---|
| `GET /v1/recherche` | $0.001 | [`recherche.json`](recherche.json) |
| `GET /v1/association/{rna}` | $0.005 | [`association-rna.json`](association-rna.json) |
| `GET /v1/associations/recherche` | $0.002 | [`associations-recherche.json`](associations-recherche.json) |
| `GET /v1/association/{rna}/annonces` | $0.01 | [`association-rna-annonces.json`](association-rna-annonces.json) |
| `GET /v1/bodacc/recherche` | $0.03 | [`bodacc-recherche.json`](bodacc-recherche.json) |
| `GET /v1/entreprise/:siren/dossier` | $0.005 + blocks | [`entreprise-siren-dossier.json`](entreprise-siren-dossier.json) |
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
| `GET /v1/eu/entreprise/EE/:id/comptes` | $0.02 | [`eu-entreprise-EE-registrikood-comptes.json`](eu-entreprise-EE-registrikood-comptes.json) |
| `GET /v1/eu/entreprise/EE/:registrikood/evenements` | $0.02 | [`eu-entreprise-EE-registrikood-evenements.json`](eu-entreprise-EE-registrikood-evenements.json) |
| `GET /v1/eu/entreprise/EE/:registrikood/dirigeants` | $0.01 | [`eu-entreprise-EE-registrikood-dirigeants.json`](eu-entreprise-EE-registrikood-dirigeants.json), real purchase 2026-09-23 (natural persons shown as a template) |
| `GET /v1/eu/entreprise/EE/:registrikood/associes` | $0.02 | [`eu-entreprise-EE-registrikood-associes.json`](eu-entreprise-EE-registrikood-associes.json), real purchase 2026-09-23 |
| `GET /v1/eu/entreprise/LT/:kodas` | $0.01 | [`eu-entreprise-LT-kodas.json`](eu-entreprise-LT-kodas.json), real purchase 2026-09-23 |
| `GET /v1/eu/entreprise/LT/:kodas/comptes` | $0.02 | [`eu-entreprise-LT-kodas-comptes.json`](eu-entreprise-LT-kodas-comptes.json), real purchase 2026-09-23 |
| `GET /v1/eu/entreprise/LT/:kodas/insolvabilite` | $0.02 | [`eu-entreprise-LT-kodas-insolvabilite.json`](eu-entreprise-LT-kodas-insolvabilite.json), real purchase 2026-09-23 |
| `GET /v1/eu/entreprise/FI/:id/evenements` | $0.02 | [`eu-entreprise-FI-id-evenements.json`](eu-entreprise-FI-id-evenements.json), real purchase 2026-09-18 |
| `GET /v1/eu/entreprise/SE/:orgnr/evenements` | $0.02 | [`eu-entreprise-SE-orgnr-evenements.json`](eu-entreprise-SE-orgnr-evenements.json) |
| `GET /v1/eu/entreprise/SE/:orgnr/comptes` | $0.02 | [`eu-entreprise-SE-orgnr-comptes.json`](eu-entreprise-SE-orgnr-comptes.json), real purchase 2026-08-17, first since the route reopened (Swedish iXBRL stock rebuilt: 1.82M filings) |
| `GET /v1/eu/entreprise/SE/:id` | $0.01 | [`eu-entreprise-SE-id.json`](eu-entreprise-SE-id.json) |
| `GET /v1/eu/entreprise/CZ/:ico/insolvabilite` | $0.02 | [`eu-entreprise-CZ-ico-insolvabilite.json`](eu-entreprise-CZ-ico-insolvabilite.json) |
| `GET /v1/eu/entreprise/PL/:krs/evenements` | $0.02 | [`eu-entreprise-PL-krs-evenements.json`](eu-entreprise-PL-krs-evenements.json) |
| `GET /v1/eu/entreprise/:pays/:id` | $0.01 | [`eu-entreprise-pays-id.json`](eu-entreprise-pays-id.json) |
| `GET /v1/eu/facturation/dossier` | $0.03 | [`eu-facturation-dossier.json`](eu-facturation-dossier.json) |
| `GET /v1/eu/entreprise/:pays/:id/transactions-dirigeants` | $0.02 | [`eu-entreprise-pays-id-transactions-dirigeants.json`](eu-entreprise-pays-id-transactions-dirigeants.json), BE sample; DE (BaFin, LEI/ISIN) covered since 2026-08-15 |
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
| `GET /v1/facture/verifier` | $0.02 | [`facture-verifier.json`](facture-verifier.json), real purchase 2026-08-16; the same smoke proved the incoherent case live (Carrefour's VAT on Danone's SIREN → `tva_ne_correspond_pas_au_siren`) |
| `GET /v1/facturation/dossier` | $0.03 | [`facturation-dossier.json`](facturation-dossier.json) |
| `GET /v1/entreprise/:siren/facturation-prep` | $0.02 | [`entreprise-siren-facturation-prep.json`](entreprise-siren-facturation-prep.json) |
| `GET /v1/score/defaillance/:siren` | $0.10 | [`score-defaillance-siren.json`](score-defaillance-siren.json) (real purchase 2026-09-25: scale `defaillance-v1.9`, with the dated French backtest of the scale in `echelle.backtest`, observed rates and never a probability) |
| `GET /v1/secteur/:code_naf/benchmarks` | $0.05 | [`secteur-code_naf-benchmarks.json`](secteur-code_naf-benchmarks.json) |
| `GET /v1/iban/verifier/:iban` | $0.005 | [`iban-verifier-iban.json`](iban-verifier-iban.json) |
| `GET /v1/tva/verifier/:numero` | $0.003 | [`tva-verifier-numero.json`](tva-verifier-numero.json) |
| `GET /v1/acheteur/:siret/profil` | $0.02 | [`acheteur-siret-profil.json`](acheteur-siret-profil.json) |
| `GET /v1/entreprise/:siren/accords-collectifs` | $0.02 | [`entreprise-siren-accords-collectifs.json`](entreprise-siren-accords-collectifs.json) |
| `GET /v1/entreprise/:siren/concurrents-marches` | $0.02 | [`entreprise-siren-concurrents-marches.json`](entreprise-siren-concurrents-marches.json) |
| `GET /v1/entreprise/:siren/contentieux` | $0.01 | [`entreprise-siren-contentieux.json`](entreprise-siren-contentieux.json) |
| `GET /v1/entreprise/:siren/emploi` | $0.02 | [`entreprise-siren-emploi.json`](entreprise-siren-emploi.json) |
| `GET /v1/entreprise/:siren/financements-ue` | $0.02 | [`entreprise-siren-financements-ue.json`](entreprise-siren-financements-ue.json) |
| `GET /v1/eu/entreprise/CH/:id/evenements` | $0.02 | [`eu-entreprise-CH-id-evenements.json`](eu-entreprise-CH-id-evenements.json) |
| `GET /v1/eu/entreprise/CH/:id/insolvabilite` | $0.02 | [`eu-entreprise-CH-id-insolvabilite.json`](eu-entreprise-CH-id-insolvabilite.json) |
| `GET /v1/eu/entreprise/CY/:id/dirigeants` | $0.01 | [`eu-entreprise-CY-id-dirigeants.json`](eu-entreprise-CY-id-dirigeants.json) |
| `GET /v1/eu/entreprise/CY/:id` | $0.01 | [`eu-entreprise-CY-id.json`](eu-entreprise-CY-id.json) |
| `GET /v1/eu/entreprise/ES/:nif/marches-publics` | $0.02 | [`eu-entreprise-ES-nif-marches-publics.json`](eu-entreprise-ES-nif-marches-publics.json) |
| `GET /v1/eu/entreprise/GB/:company_number/annonces` | $0.02 | [`eu-entreprise-GB-company_number-annonces.json`](eu-entreprise-GB-company_number-annonces.json) |
| `GET /v1/eu/entreprise/GB/:company_number/marches-publics` | $0.02 | [`eu-entreprise-GB-company_number-marches-publics.json`](eu-entreprise-GB-company_number-marches-publics.json) |
| `GET /v1/eu/entreprise/HR/:oib/comptes` | $0.01 | [`eu-entreprise-HR-oib-comptes.json`](eu-entreprise-HR-oib-comptes.json) |
| `GET /v1/eu/entreprise/HR/:oib/evenements` | $0.02 | [`eu-entreprise-HR-oib-evenements.json`](eu-entreprise-HR-oib-evenements.json) |
| `GET /v1/eu/entreprise/HR/:oib/insolvabilite` | $0.02 | [`eu-entreprise-HR-oib-insolvabilite.json`](eu-entreprise-HR-oib-insolvabilite.json) |
| `GET /v1/eu/entreprise/HR/:oib` | $0.01 | [`eu-entreprise-HR-oib.json`](eu-entreprise-HR-oib.json) |
| `GET /v1/eu/entreprise/IE/:numero/insolvabilite` | $0.01 | [`eu-entreprise-IE-numero-insolvabilite.json`](eu-entreprise-IE-numero-insolvabilite.json) |
| `GET /v1/eu/entreprise/IE/:numero` | $0.01 | [`eu-entreprise-IE-numero.json`](eu-entreprise-IE-numero.json) |
| `GET /v1/eu/entreprise/LV/:regnr/associes` | $0.02 | [`eu-entreprise-LV-regnr-associes.json`](eu-entreprise-LV-regnr-associes.json) |
| `GET /v1/eu/entreprise/LV/:regnr/evenements` | $0.02 | [`eu-entreprise-LV-regnr-evenements.json`](eu-entreprise-LV-regnr-evenements.json) |
| `GET /v1/eu/entreprise/LV/:regnr/marches-publics` | $0.02 | [`eu-entreprise-LV-regnr-marches-publics.json`](eu-entreprise-LV-regnr-marches-publics.json) |
| `GET /v1/eu/entreprise/NO/:id/dirigeants` | $0.01 | [`eu-entreprise-NO-id-dirigeants.json`](eu-entreprise-NO-id-dirigeants.json) |
| `GET /v1/eu/entreprise/NO/:id/etablissements` | $0.01 | [`eu-entreprise-NO-id-etablissements.json`](eu-entreprise-NO-id-etablissements.json) |
| `GET /v1/eu/entreprise/PL/:nip/marches-publics` | $0.02 | [`eu-entreprise-PL-nip-marches-publics.json`](eu-entreprise-PL-nip-marches-publics.json) |
| `GET /v1/eu/entreprise/PT/:nipc/marches-publics` | $0.02 | [`eu-entreprise-PT-nipc-marches-publics.json`](eu-entreprise-PT-nipc-marches-publics.json) |
| `GET /v1/eu/entreprise/RO/:cui/comptes` | $0.02 | [`eu-entreprise-RO-cui-comptes.json`](eu-entreprise-RO-cui-comptes.json) |
| `GET /v1/eu/entreprise/RO/:cui/dirigeants` | $0.01 | [`eu-entreprise-RO-cui-dirigeants.json`](eu-entreprise-RO-cui-dirigeants.json) |
| `GET /v1/eu/entreprise/RO/:cui/insolvabilite` | $0.02 | [`eu-entreprise-RO-cui-insolvabilite.json`](eu-entreprise-RO-cui-insolvabilite.json) |
| `GET /v1/eu/entreprise/RO/:cui` | $0.01 | [`eu-entreprise-RO-cui.json`](eu-entreprise-RO-cui.json) |
| `GET /v1/eu/entreprise/:pays/:id/marches-publics-ue` | $0.02 | [`eu-entreprise-pays-id-marches-publics-ue.json`](eu-entreprise-pays-id-marches-publics-ue.json) |
| `GET /v1/marches/expirations` | $0.05 | [`marches-expirations.json`](marches-expirations.json) |
