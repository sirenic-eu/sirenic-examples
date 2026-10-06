"""Test harness: no network, ever.

Every HTTP exchange is served by ``FixtureAdapter`` from ``tests/fixtures``:
responses recorded from the live service on 2026-10-05 (or written from the
served code when a status cannot be provoked, and marked so in their
``origin`` field). Any address that was not recorded is refused, and the real
transport is disabled for the whole session.
"""

from __future__ import annotations

import json
import socket
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qsl, urlsplit

import pytest
import requests
from requests.adapters import BaseAdapter, HTTPAdapter
from requests.structures import CaseInsensitiveDict

FIXTURES = Path(__file__).parent / "fixtures"
CLE_FACTICE = "srn_live_placeholder_for_tests"  # not a key: the adapter accepts any value


class ReseauInterdit(AssertionError):
    """A test tried to reach the network."""


class UnrecordedRequest(AssertionError):
    """The adapter has no recorded response for this request."""


def charger(nom: str) -> Dict[str, Any]:
    return json.loads((FIXTURES / f"{nom}.json").read_text(encoding="utf-8"))


def _cle(methode: str, url: str) -> Tuple[str, str, str, str, Tuple[Tuple[str, str], ...]]:
    p = urlsplit(url)
    return (methode.upper(), p.scheme, p.netloc.lower(), p.path, tuple(sorted(parse_qsl(p.query, keep_blank_values=True))))


class FixtureAdapter(BaseAdapter):
    """A ``requests`` transport that only serves recorded fixtures.

    ``paiement`` decides how a retried call that carries an x402 payment header
    is answered: ``None`` refuses it (UnrecordedRequest), ``"accepte"`` serves
    the response recorded with the API key for the same address (same route,
    same content: a simulation, no payment was ever made), ``"refuse"`` serves
    the recorded 402 quote again.
    """

    def __init__(self, fixtures: List[Dict[str, Any]], paiement: Optional[str] = None) -> None:
        super().__init__()
        self.table: Dict[Any, Dict[str, Any]] = {}
        self.vues: List[requests.PreparedRequest] = []
        self.paiement = paiement
        for f in fixtures:
            r = f["request"]
            cle = (_cle(r["method"], r["url"]), r["auth"], r.get("x_api_key"))
            if cle in self.table:
                raise ValueError(f"two fixtures for {cle}")
            self.table[cle] = f

    def send(self, request: requests.PreparedRequest, **kwargs: Any) -> requests.Response:
        self.vues.append(request)
        cle = _cle(request.method or "GET", request.url or "")
        h = request.headers
        if "PAYMENT-SIGNATURE" in h or "X-PAYMENT" in h:
            if self.paiement == "accepte":
                f = self.table.get((cle, "api_key", None))
            elif self.paiement == "refuse":
                f = self.table.get((cle, "none", None))
            else:
                f = None
        elif "X-Api-Key" in h:
            f = self.table.get((cle, "api_key", h["X-Api-Key"])) or self.table.get((cle, "api_key", None))
        else:
            f = self.table.get((cle, "none", None))
        if f is None:
            raise UnrecordedRequest(f"no recorded response for {request.method} {request.url}")
        return self._reponse(request, f)

    @staticmethod
    def _reponse(request: requests.PreparedRequest, f: Dict[str, Any]) -> requests.Response:
        r = requests.Response()
        r.status_code = f["status"]
        r.headers = CaseInsensitiveDict(f["headers"])
        corps = f["body"]
        r._content = (corps if isinstance(corps, str) else json.dumps(corps, ensure_ascii=False)).encode("utf-8")
        r.encoding = "utf-8"
        r.url = request.url or ""
        r.request = request
        return r

    def close(self) -> None:
        pass


@pytest.fixture(autouse=True)
def pas_de_reseau(monkeypatch: pytest.MonkeyPatch) -> None:
    """The real transport and raw sockets fail loudly in every test."""

    def interdit(*_: Any, **__: Any) -> None:
        raise ReseauInterdit("network access attempted during the tests")

    monkeypatch.setattr(HTTPAdapter, "send", interdit)
    monkeypatch.setattr(socket.socket, "connect", interdit)
    monkeypatch.setattr(socket, "create_connection", interdit)


@pytest.fixture(autouse=True)
def sans_cle_dans_l_environnement(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SIRENIC_API_KEY", raising=False)


@pytest.fixture
def servir():
    """``servir("fixture", ..., paiement=None)`` returns ``(session, adapter)``; a fixture is a
    name in ``tests/fixtures`` or a dict built by the test (a recorded response, readdressed)."""

    def fabrique(*noms: Any, paiement: Optional[str] = None) -> Tuple[requests.Session, FixtureAdapter]:
        adaptateur = FixtureAdapter([charger(n) if isinstance(n, str) else n for n in noms], paiement=paiement)
        session = requests.Session()
        session.mount("https://", adaptateur)
        session.mount("http://", adaptateur)
        return session, adaptateur

    return fabrique
