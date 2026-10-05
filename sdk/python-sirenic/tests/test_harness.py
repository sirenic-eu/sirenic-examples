"""The harness itself: unrecorded addresses are refused, the network is unreachable."""

from __future__ import annotations

import json
from importlib import metadata
from pathlib import Path

import pytest
import requests

import sirenic
from conftest import FIXTURES, ReseauInterdit, UnrecordedRequest


def test_unrecorded_address_is_refused(servir):
    session, adaptateur = servir("suggestions-nom-200")
    with pytest.raises(UnrecordedRequest):
        sirenic.Client(session=session).get("/v1/lecture")
    with pytest.raises(UnrecordedRequest):
        sirenic.Client(session=session).suggestions("danone")
    assert len(adaptateur.vues) == 2


def test_real_transport_is_disabled():
    with pytest.raises(ReseauInterdit):
        sirenic.Client(session=requests.Session()).suggestions("airvance")


def test_fixtures_are_traced_and_hold_no_personal_fields():
    interdits = {"dirigeants", "beneficiaires_effectifs", "nom", "prenoms", "annee_de_naissance", "annee_naissance",
                 "date_naissance", "nom_principal", "nom_correspondant"}

    def cles(x):
        if isinstance(x, dict):
            for k, v in x.items():
                yield k
                yield from cles(v)
        elif isinstance(x, list):
            for v in x:
                yield from cles(v)

    fichiers = sorted(FIXTURES.glob("*.json"))
    assert len(fichiers) >= 19
    for f in fichiers:
        doc = json.loads(f.read_text(encoding="utf-8"))
        assert doc["request"]["url"].startswith("https://api.sirenic.eu/")
        assert doc["origin"].startswith(("recorded from the live service", "written, not recorded"))
        if doc["origin"].startswith("recorded"):
            assert doc["recorded_at"].startswith("2026-10-05T")
        assert not interdits & set(cles(doc["body"])), f.name


def test_version_matches_installed_metadata():
    assert sirenic.__version__ == metadata.version("sirenic") == "0.1.0"
    assert sirenic.USER_AGENT == "sirenic-python/0.1.0"
