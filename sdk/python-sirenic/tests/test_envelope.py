"""Reading the common envelope as served: provenance, snapshot date, state and cut."""

from __future__ import annotations

from decimal import Decimal

import sirenic
from conftest import CLE_FACTICE, charger

# Closed list of provenance[].etat, as served by GET /v1/lecture on 2026-10-05 (enveloppe.listes.etat).
ETATS = {"servi", "absence_mesuree", "absence_non_conclusive", "partiel", "perime", "indisponible", "sans_objet"}


def _reponse(nom: str) -> sirenic.Response:
    f = charger(nom)
    import json

    return sirenic.Response(f["status"], f["headers"], json.dumps(f["body"]).encode("utf-8"), f["request"]["url"])


def test_provenance_entries_as_served():
    r = _reponse("kyb-200-cle")
    entrees = r.provenance
    assert len(entrees) == len(charger("kyb-200-cle")["body"]["provenance"])
    assert {p.etat for p in entrees} <= ETATS
    identite = r.bloc("identite")
    assert identite.source_code == "insee_sirene"
    assert identite.mode == "stock"
    assert identite.licence == "etalab-2.0"
    assert identite.as_of == "2026-10-01"
    assert identite.precision_as_of == "publication_officielle"
    assert identite.age_jours == 4
    assert identite.couverture.etat == "complete"
    assert identite.confiance == "forte"
    contentieux = r.bloc("contentieux")
    assert contentieux.etat == "absence_non_conclusive"
    assert contentieux.couverture.etat == "partielle"
    assert contentieux.couverture.mesure
    assert r.bloc("criblage_sanctions").etat == "partiel"
    assert r.bloc("absent") is None


def test_states_of_the_profile():
    r = _reponse("entreprise-200-cle")
    etats = {p.bloc: p.etat for p in r.provenance}
    assert etats["index_egapro"] == "sans_objet"
    assert etats["certifications_rge"] == "absence_mesuree"
    assert r.bloc("tva_intracommunautaire").as_of is None  # a computed block has no snapshot date


def test_bounded_lists_at_any_depth():
    r = _reponse("dossier-200-cle")
    listes = {(l.path, l.name): l for l in r.listes_bornees}
    bilans = listes[("blocs.finances", "bilans_saisis_inpi")]
    assert bilans.nombre_total == 9
    assert bilans.tronque is False
    assert bilans.total_borne_basse is None
    s = _reponse("suggestions-nom-200")
    assert [(l.path, l.name, l.nombre_total, l.tronque) for l in s.listes_bornees] == [("", "suggestions", 2, False)]


def test_credit_headers():
    r = _reponse("entreprise-200-cle")
    assert r.credits_charged == Decimal("0.005")
    # X-Credits-Remaining was removed from the fixture (balance of the internal test account).
    assert r.credits_remaining is None
    avec_solde = sirenic.Response(200, {"X-Credits-Remaining": "12.345", "Content-Type": "application/json"}, b"{}", "u")
    assert avec_solde.credits_remaining == Decimal("12.345")


def test_non_json_body_is_kept_as_bytes():
    r = sirenic.Response(200, {"Content-Type": "application/pdf"}, b"%PDF-1.7", "https://api.sirenic.eu/v1/rapport/x")
    assert r.data is None
    assert r.content == b"%PDF-1.7"
    assert r.provenance == [] and r.listes_bornees == []
