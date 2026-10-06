"""Construction of the tools on the API key, wallet (x402) and quote-only rails, without network."""

from __future__ import annotations

import base64
import copy
import json
import re
from importlib import metadata

import pytest

import sirenic
import sirenic_agents
from conftest import CLE_FACTICE, charger
from sirenic_agents import SirenicClient, build_crewai_tools, build_langchain_tools

AIRVANCE = "490586708"
NOMS_LANGCHAIN = {
    "sirenic_search_companies",
    "sirenic_company_profile",
    "sirenic_kyb_file",
    "sirenic_screen_sanctions",
    "sirenic_company_intelligence",
    "sirenic_create_watch",
    "sirenic_invoice_file_france",
    "sirenic_invoice_file_europe",
    "sirenic_company_licences",
    "sirenic_get",
}
ROUTES = {
    "sirenic_search_companies": "/v1/recherche",
    "sirenic_company_profile": "/v1/entreprise/{siren}",
    "sirenic_kyb_file": "/v1/kyb/{siren}",
    "sirenic_screen_sanctions": "/v1/sanctions/check",
    "sirenic_company_intelligence": "/v1/intelligence/{siren}",
    "sirenic_create_watch": "/v1/surveillance/creer",
    "sirenic_invoice_file_france": "/v1/facturation/dossier",
    "sirenic_invoice_file_europe": "/v1/eu/facturation/dossier",
    "sirenic_company_licences": "/v1/entreprise/{siren}/agrements",
}
DOLLARS = re.compile(r"\$\d+(?:\.\d+)?")
EURC_ETHEREUM = "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c"  # EURC on Ethereum mainnet: not paid by the client


def _outil(tools, nom):
    return next(t for t in tools if t.name == nom)


def test_version():
    assert sirenic_agents.__version__ == metadata.version("sirenic-agents") == "0.3.0"


def test_langchain_quote_only_rail(servir):
    pytest.importorskip("langchain_core")
    session, adaptateur = servir("entreprise-402")
    client = SirenicClient(session=session)
    assert client.rail == "quote"
    tools = build_langchain_tools(client)
    assert {t.name for t in tools} == NOMS_LANGCHAIN
    sortie = json.loads(_outil(tools, "sirenic_company_profile").invoke({"siren": AIRVANCE}))
    assert sortie["payment_required"] is True
    assert sortie["quote"]["price"] == "$0.005"
    assert "X-Api-Key" not in adaptateur.vues[0].headers


def test_langchain_api_key_rail(servir):
    pytest.importorskip("langchain_core")
    session, adaptateur = servir("entreprise-200-cle", "facturation-200-cle")
    client = SirenicClient(api_key=CLE_FACTICE, session=session)
    assert client.rail == "api_key"
    tools = build_langchain_tools(client)
    profil = json.loads(_outil(tools, "sirenic_company_profile").invoke({"siren": AIRVANCE}))
    assert profil["siren"] == AIRVANCE and profil["denomination"] == "AIRVANCE GROUP"
    facture = json.loads(_outil(tools, "sirenic_invoice_file_france").invoke({"siren": AIRVANCE}))
    assert facture["verdict"]["pret_a_facturer"] is True
    assert all(v.headers["X-Api-Key"] == CLE_FACTICE for v in adaptateur.vues)


def test_api_key_from_environment(monkeypatch):
    monkeypatch.setenv("SIRENIC_API_KEY", CLE_FACTICE)
    assert SirenicClient().rail == "api_key"


def test_langchain_wallet_rail(servir):
    pytest.importorskip("langchain_core")
    pytest.importorskip("x402")
    from eth_account import Account

    cle = Account.create().key.hex()
    session, adaptateur = servir("entreprise-402", "entreprise-200-cle", paiement="accepte")
    client = SirenicClient(wallet_key=cle, max_price_usd=0.01, session=session)
    assert client.rail == "x402"
    profil = json.loads(_outil(build_langchain_tools(client), "sirenic_company_profile").invoke({"siren": AIRVANCE}))
    assert profil["siren"] == AIRVANCE
    assert "PAYMENT-SIGNATURE" in adaptateur.vues[1].headers  # simulated payment, never settled
    # Below the quote: nothing is signed, the tool returns the quote.
    session2, adaptateur2 = servir("entreprise-402")
    plafond = SirenicClient(wallet_key=cle, max_price_usd=0.001, session=session2)
    sortie = json.loads(_outil(build_langchain_tools(plafond), "sirenic_company_profile").invoke({"siren": AIRVANCE}))
    assert sortie["payment_required"] is True and sortie["price_cap_exceeded"] is True
    assert sortie["quote"]["price"] == "$0.005"
    assert len(adaptateur2.vues) == 1


def test_wallet_rail_names_an_asset_it_cannot_pay(servir):
    """A quote in no asset the client pays (here EURC on Ethereum alone) returns the quote and names the
    asset; it is never reported as above the price cap."""
    pytest.importorskip("langchain_core")
    pytest.importorskip("x402")
    from eth_account import Account

    f = copy.deepcopy(charger("entreprise-402"))
    entete = json.loads(base64.b64decode(f["headers"]["payment-required"]))
    for devis in (f["body"], entete):
        devis["accepts"] = [
            dict(a, network="eip155:1", asset=EURC_ETHEREUM) for a in devis["accepts"] if a["extra"]["name"] == "EURC"
        ]
    f["headers"]["payment-required"] = base64.b64encode(json.dumps(entete).encode()).decode()
    session, adaptateur = servir(f)
    client = SirenicClient(wallet_key=Account.create().key.hex(), max_price_usd=1.0, session=session)
    sortie = json.loads(_outil(build_langchain_tools(client), "sirenic_company_profile").invoke({"siren": AIRVANCE}))
    assert sortie["payment_required"] is True and sortie["unsupported_asset"] is True
    assert sortie["assets"] == ["EURC on eip155:1"] and "price_cap_exceeded" not in sortie
    assert sortie["quote"]["price"] == "$0.005"
    assert len(adaptateur.vues) == 1


def test_crewai_tools_on_both_rails(servir, crewai_minimal):
    session, _ = servir("entreprise-402", "kyb-200-cle")
    outils = build_crewai_tools(SirenicClient(session=session))
    assert [o.name for o in outils] == [
        "Sirenic company search",
        "Sirenic KYB file",
        "Sirenic intelligence report",
        "Sirenic API call",
    ]
    devis = json.loads(outils[3]._run(path=f"/v1/entreprise/{AIRVANCE}"))
    assert devis["payment_required"] is True
    session2, _ = servir("kyb-200-cle")
    kyb = json.loads(build_crewai_tools(SirenicClient(api_key=CLE_FACTICE, session=session2))[1]._run(siren=AIRVANCE))
    assert kyb["siren"] == AIRVANCE


def test_generic_tools_encode_a_space_like_0_2_0(servir, crewai_minimal):
    """A path written with a space (common from an LLM) is sent encoded, as 0.2.0 did, never refused."""
    pytest.importorskip("langchain_core")
    enregistre = charger("suggestions-nom-200")
    encodee = "https://api.sirenic.eu/v1/suggestions?q=airvance%20group"
    session, adaptateur = servir(dict(enregistre, request=dict(enregistre["request"], url=encodee)))
    client = SirenicClient(session=session)
    chemin = "/v1/suggestions?q=airvance group"
    langchain = json.loads(_outil(build_langchain_tools(client), "sirenic_get").invoke({"path": chemin}))
    crewai = json.loads(build_crewai_tools(client)[3]._run(path=chemin))
    for sortie in (langchain, crewai):
        assert "error" not in sortie, sortie
        assert sortie["suggestions"][0]["siren"] == AIRVANCE
    assert [v.url for v in adaptateur.vues] == [encodee, encodee]


def test_errors_are_returned_as_json(servir):
    session, _ = servir("surveillance-404")
    client = SirenicClient(session=session)
    erreur = json.loads(client.get("/v1/surveillance/jeton-inconnu-t476"))
    assert erreur == {
        "error": "http_error",
        "status": 404,
        "code": "surveillance_introuvable",
        "body": {"error": "surveillance_introuvable", "message": "Jeton inconnu. / Unknown watch token."},
    }
    assert json.loads(client.get("https://example.org/v1/x"))["error"] == "invalid_path"


def test_tool_prices_match_the_served_openapi():
    """Each "Price:" of a tool equals the x-price served by the OpenAPI (recorded 2026-10-05)."""
    pytest.importorskip("langchain_core")
    servis = charger("openapi-prix")["body"]["paths"]
    tools = build_langchain_tools(SirenicClient())
    for nom, route in ROUTES.items():
        description = _outil(tools, nom).description
        attendu = DOLLARS.findall(servis[route]["get"]["x-price"])[:3]
        trouve = DOLLARS.findall(description.split("Price", 1)[1])[:3]
        assert trouve == attendu[: len(trouve)] and trouve, (nom, trouve, attendu)
