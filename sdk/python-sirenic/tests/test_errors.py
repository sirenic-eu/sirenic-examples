"""One test per error class, on the responses the service serves."""

from __future__ import annotations

import pytest
import requests

import sirenic
from conftest import CLE_FACTICE, charger

AIRVANCE = "490586708"


def test_payment_required_without_key_or_wallet_returns_the_quote(servir):
    """No key, no wallet: every paid method raises PaymentRequired with the quote (a free dry run)."""
    session, adaptateur = servir("entreprise-402", "dossier-402", "kyb-402", "facturation-402")
    client = sirenic.Client(session=session)
    appels = [
        (lambda: client.entreprise(AIRVANCE), "$0.005", 5000),
        (lambda: client.dossier(AIRVANCE, ["finances", "pi"]), "$0.045", 45000),
        (lambda: client.kyb(AIRVANCE), "$0.15", 150000),
        (lambda: client.facturation_dossier(AIRVANCE), "$0.03", 30000),
    ]
    devis = charger("entreprise-402")["body"]["accepts"]
    for appel, prix, montant in appels:
        with pytest.raises(sirenic.PaymentRequired) as e:
            appel()
        err = e.value
        assert type(err) is sirenic.PaymentRequired
        assert err.status == 402 and err.code == "payment_required"
        assert err.price == prix
        assert err.x402_version == 2
        assert [o.asset_name for o in err.accepts] == ["USD Coin", "EURC"]
        assert {o.network for o in err.accepts} == {"eip155:8453"}
        assert {o.pay_to for o in err.accepts} == {devis[0]["payTo"]}
        assert [o.asset for o in err.accepts] == [devis[0]["asset"], devis[1]["asset"]]
        assert err.min_amount == montant
        assert err.payment_required_header
        assert err.quote["documentation"] == "https://api.sirenic.eu/llms.txt"
    assert all("X-Api-Key" not in v.headers for v in adaptateur.vues)


def test_invalid_request(servir):
    session, _ = servir("suggestions-400")
    with pytest.raises(sirenic.InvalidRequest) as e:
        sirenic.Client(session=session).suggestions("ai")
    assert e.value.status == 400
    assert e.value.code == "parametre_invalide"
    assert e.value.champ == "q"


def test_authentication_error_on_unknown_key(servir):
    session, _ = servir("entreprise-401-cle-invalide")
    with pytest.raises(sirenic.AuthenticationError) as e:
        sirenic.Client(api_key="srn_live_0000000000000000", session=session).entreprise(AIRVANCE)
    assert type(e.value) is sirenic.AuthenticationError
    assert e.value.status == 401
    assert e.value.code == "cle_invalide"


def test_authentication_error_on_suspended_account(servir):
    session, _ = servir("entreprise-403-cle")
    with pytest.raises(sirenic.AuthenticationError) as e:
        sirenic.Client(api_key=CLE_FACTICE, session=session).entreprise(AIRVANCE)
    assert e.value.status == 403
    assert e.value.code == "compte_suspendu"


def test_account_required(servir):
    session, _ = servir("actes-401")
    with pytest.raises(sirenic.AccountRequired) as e:
        sirenic.Client(session=session).get("/v1/documents/actes/000000000000000000000000")
    assert isinstance(e.value, sirenic.AuthenticationError)
    assert e.value.status == 401
    assert e.value.code == "compte_requis"
    assert "x-api-key" in e.value.message


def test_insufficient_credits(servir):
    session, _ = servir("kyb-402-credits-insuffisants")
    with pytest.raises(sirenic.InsufficientCredits) as e:
        sirenic.Client(api_key=CLE_FACTICE, session=session).kyb(AIRVANCE)
    err = e.value
    assert not isinstance(err, sirenic.PaymentRequired)
    assert err.status == 402 and err.code == "credits_insuffisants"
    assert err.solde == 0.1 and err.prix == 0.15
    assert err.recharge_url == "https://api.sirenic.eu/compte"
    assert "payment-required" not in {k.lower() for k in err.headers}


def test_not_found(servir):
    session, _ = servir("surveillance-404")
    with pytest.raises(sirenic.NotFound) as e:
        sirenic.Client(session=session).get("/v1/surveillance/jeton-inconnu-t476")
    assert e.value.status == 404
    assert e.value.code == "surveillance_introuvable"


def test_rate_limited(servir):
    session, _ = servir("suggestions-429")
    with pytest.raises(sirenic.RateLimited) as e:
        sirenic.Client(session=session).suggestions("airvance")
    assert e.value.status == 429
    assert e.value.code == "quota_journalier_atteint"
    assert e.value.retry_after == 3600


def test_upstream_unavailable(servir):
    session, _ = servir("entreprise-503-cle")
    with pytest.raises(sirenic.UpstreamUnavailable) as e:
        sirenic.Client(api_key=CLE_FACTICE, session=session).entreprise(AIRVANCE)
    assert isinstance(e.value, sirenic.ServiceUnavailable)
    assert e.value.status == 503 and e.value.code == "amont_indisponible"


def test_service_unavailable(servir):
    session, _ = servir("kyb-503-cle")
    with pytest.raises(sirenic.ServiceUnavailable) as e:
        sirenic.Client(api_key=CLE_FACTICE, session=session).kyb(AIRVANCE)
    assert type(e.value) is sirenic.ServiceUnavailable
    assert e.value.code == "base_indisponible"


class _AdaptateurInjoignable(requests.adapters.BaseAdapter):
    def send(self, request, **kwargs):
        raise requests.ConnectionError("unreachable (simulated)")

    def close(self):
        pass


def test_network_error():
    session = requests.Session()
    session.mount("https://", _AdaptateurInjoignable())
    with pytest.raises(sirenic.NetworkError) as e:
        sirenic.Client(session=session).suggestions("airvance")
    assert e.value.status is None
    assert isinstance(e.value.__cause__, requests.ConnectionError)


def test_every_error_derives_from_sirenic_error():
    for nom in sirenic.errors.__all__:
        classe = getattr(sirenic, nom)
        if isinstance(classe, type) and issubclass(classe, Exception):
            assert issubclass(classe, sirenic.SirenicError)
    texte = str(sirenic.SirenicError("message", status=503, code="amont_indisponible"))
    assert texte == "503 amont_indisponible: message"
