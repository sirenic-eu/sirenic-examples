"""One test per method, on responses recorded from the live service."""

from __future__ import annotations

from decimal import Decimal

import pytest

import sirenic
from conftest import CLE_FACTICE

AIRVANCE = "490586708"  # AIRVANCE GROUP, a legal person


def test_suggestions_free_without_key(servir):
    session, adaptateur = servir("suggestions-nom-200")
    client = sirenic.Client(session=session)
    assert client.rail == "quote"
    r = client.suggestions("airvance")
    assert r.status == 200
    assert [s["siren"] for s in r["suggestions"]] == [AIRVANCE, "908165145"]
    assert r["gratuit"] is True
    assert r.provenance == []
    vue = adaptateur.vues[0]
    assert vue.headers["User-Agent"] == f"sirenic-python/{sirenic.__version__}" == "sirenic-python/0.1.0"
    assert vue.headers["Accept"] == "application/json"
    assert "X-Api-Key" not in vue.headers


def test_entreprise_with_api_key(servir):
    session, adaptateur = servir("entreprise-200-cle")
    client = sirenic.Client(api_key=CLE_FACTICE, session=session)
    assert client.rail == "api_key"
    r = client.entreprise(AIRVANCE)
    assert r["siren"] == AIRVANCE
    assert r["denomination"] == "AIRVANCE GROUP"
    assert r.credits_charged == Decimal("0.005")
    assert r.request_id
    assert adaptateur.vues[0].headers["X-Api-Key"] == CLE_FACTICE
    assert adaptateur.vues[0].url == f"https://api.sirenic.eu/v1/entreprise/{AIRVANCE}"


def test_api_key_read_from_environment(servir, monkeypatch):
    monkeypatch.setenv("SIRENIC_API_KEY", CLE_FACTICE)
    session, adaptateur = servir("entreprise-200-cle")
    client = sirenic.Client(session=session)
    assert client.rail == "api_key"
    assert client.entreprise(AIRVANCE)["siren"] == AIRVANCE
    assert adaptateur.vues[0].headers["X-Api-Key"] == CLE_FACTICE


def test_explicit_wallet_is_not_overridden_by_environment(monkeypatch):
    pytest.importorskip("x402")
    from eth_account import Account

    monkeypatch.setenv("SIRENIC_API_KEY", CLE_FACTICE)
    client = sirenic.Client(wallet_key=Account.create().key.hex(), max_price_usd=0.01)
    assert client.rail == "x402"


def test_dossier_with_blocks(servir):
    session, adaptateur = servir("dossier-200-cle")
    client = sirenic.Client(api_key=CLE_FACTICE, session=session)
    r = client.dossier(AIRVANCE, blocs=["finances", "pi"])
    assert "blocs=finances%2Cpi" in adaptateur.vues[0].url
    assert r["blocs_demandes"] == ["finances", "pi"]
    assert r["blocs_absents"] == []
    assert r["resume"] == {"demandes": 2, "servis": 2, "absents": 0, "dont_panne_amont": 0}
    assert r.credits_charged == Decimal("0.045")
    # The same call with a comma-separated string.
    assert client.dossier(AIRVANCE, "finances, pi")["siren"] == AIRVANCE
    assert adaptateur.vues[1].url == adaptateur.vues[0].url


def test_kyb(servir):
    session, _ = servir("kyb-200-cle")
    r = sirenic.Client(api_key=CLE_FACTICE, session=session).kyb(AIRVANCE)
    assert r["siren"] == AIRVANCE
    assert r["identite"]["denomination"] == "AIRVANCE GROUP"
    assert r.credits_charged == Decimal("0.15")
    assert {"identite", "criblage_sanctions", "finances"} <= {p.bloc for p in r.provenance}


def test_facturation_dossier(servir):
    session, adaptateur = servir("facturation-200-cle")
    r = sirenic.Client(api_key=CLE_FACTICE, session=session).facturation_dossier(AIRVANCE)
    assert adaptateur.vues[0].url == f"https://api.sirenic.eu/v1/facturation/dossier?siren={AIRVANCE}"
    assert r["verdict"]["pret_a_facturer"] is True
    assert r["tva_vies"] == {"numero": "FR88490586708", "statut": "valide"}
    assert r.bloc("tva_vies").mode == "temps_reel"
    assert r.credits_charged == Decimal("0.03")


def test_get_any_path(servir):
    session, adaptateur = servir("suggestions-siren-200")
    r = sirenic.Client(session=session).get("/v1/suggestions", {"q": AIRVANCE})
    assert r["suggestions"][0]["denomination"] == "AIRVANCE GROUP"
    assert adaptateur.vues[0].url == f"https://api.sirenic.eu/v1/suggestions?q={AIRVANCE}"


@pytest.mark.parametrize(
    "chemin",
    ["https://example.org/v1/suggestions", "//example.org/v1/x", "/admin", "v1/suggestions", "/v1/a b", ""],
)
def test_get_refuses_anything_but_a_path(servir, chemin):
    session, adaptateur = servir()
    with pytest.raises(ValueError):
        sirenic.Client(api_key=CLE_FACTICE, session=session).get(chemin)
    assert adaptateur.vues == []


@pytest.mark.parametrize("siren", ["12345678", "1234567890", "ABCDEFGHI", ""])
def test_siren_is_checked_before_any_call(servir, siren):
    session, adaptateur = servir()
    client = sirenic.Client(api_key=CLE_FACTICE, session=session)
    with pytest.raises(ValueError):
        client.entreprise(siren)
    with pytest.raises(ValueError):
        client.dossier(siren, ["finances"])
    assert adaptateur.vues == []


def test_dossier_needs_a_block(servir):
    session, adaptateur = servir()
    with pytest.raises(ValueError):
        sirenic.Client(session=session).dossier(AIRVANCE, [])
    assert adaptateur.vues == []


def test_one_rail_per_client():
    with pytest.raises(ValueError):
        sirenic.Client(api_key=CLE_FACTICE, wallet_key="0x" + "11" * 32)


def test_repr_never_shows_the_key():
    client = sirenic.Client(api_key=CLE_FACTICE)
    assert CLE_FACTICE not in repr(client)
    assert "api_key" in repr(client)


@pytest.mark.parametrize("base", ["api.sirenic.eu", "ftp://api.sirenic.eu", "https://api.sirenic.eu/?x=1"])
def test_base_url_is_checked(base):
    with pytest.raises(ValueError):
        sirenic.Client(base_url=base)


def test_max_price_must_be_positive():
    with pytest.raises(ValueError):
        sirenic.Client(max_price_usd=0)


def test_context_manager_closes_its_own_session():
    with sirenic.Client() as client:
        assert client.rail == "quote"
