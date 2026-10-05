"""Test harness of sirenic-agents: no network, recorded responses only.

The recorded responses are those of the ``sirenic`` client's tests
(``sdk/python-sirenic/tests/fixtures``, recorded from the live service on
2026-10-05), plus ``fixtures/openapi-prix.json`` here. Any other address is
refused and the real transport is disabled.
"""

from __future__ import annotations

import json
import socket
import sys
import types
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qsl, urlsplit

import pytest
import requests
from requests.adapters import BaseAdapter, HTTPAdapter
from requests.structures import CaseInsensitiveDict

ICI = Path(__file__).parent / "fixtures"
CLIENT = Path(__file__).resolve().parents[2] / "python-sirenic" / "tests" / "fixtures"
CLE_FACTICE = "srn_live_placeholder_for_tests"


class ReseauInterdit(AssertionError):
    pass


class UnrecordedRequest(AssertionError):
    pass


def charger(nom: str) -> Dict[str, Any]:
    for dossier in (ICI, CLIENT):
        chemin = dossier / f"{nom}.json"
        if chemin.exists():
            return json.loads(chemin.read_text(encoding="utf-8"))
    raise FileNotFoundError(f"fixture {nom} not found in {ICI} or {CLIENT}")


def _cle(methode: str, url: str):
    p = urlsplit(url)
    return (methode.upper(), p.netloc.lower(), p.path, tuple(sorted(parse_qsl(p.query, keep_blank_values=True))))


class FixtureAdapter(BaseAdapter):
    """Serves recorded fixtures only. ``paiement="accepte"`` answers a signed
    x402 retry with the response recorded under the API key (a simulation)."""

    def __init__(self, fixtures: List[Dict[str, Any]], paiement: Optional[str] = None) -> None:
        super().__init__()
        self.table = {(_cle(f["request"]["method"], f["request"]["url"]), f["request"]["auth"]): f for f in fixtures}
        self.vues: List[requests.PreparedRequest] = []
        self.paiement = paiement

    def send(self, request: requests.PreparedRequest, **kwargs: Any) -> requests.Response:
        self.vues.append(request)
        cle = _cle(request.method or "GET", request.url or "")
        h = request.headers
        if "PAYMENT-SIGNATURE" in h:
            f = self.table.get((cle, "api_key")) if self.paiement == "accepte" else None
        else:
            f = self.table.get((cle, "api_key" if "X-Api-Key" in h else "none"))
        if f is None:
            raise UnrecordedRequest(f"no recorded response for {request.method} {request.url}")
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
    def fabrique(*noms: str, paiement: Optional[str] = None) -> Tuple[requests.Session, FixtureAdapter]:
        adaptateur = FixtureAdapter([charger(n) for n in noms], paiement=paiement)
        session = requests.Session()
        session.mount("https://", adaptateur)
        session.mount("http://", adaptateur)
        return session, adaptateur

    return fabrique


@pytest.fixture
def crewai_minimal(monkeypatch: pytest.MonkeyPatch):
    """A minimal stand-in for ``crewai.tools.BaseTool``: crewai does not install
    on the Python of the test machine (3.14). It only checks that the tools are
    built with a name, a description, an argument schema and a ``_run``."""
    try:
        import crewai.tools  # noqa: F401

        yield "crewai"
        return
    except ImportError:
        pass
    from pydantic import BaseModel

    class BaseTool(BaseModel):
        name: str
        description: str
        args_schema: type

        def run(self, **kwargs: Any) -> Any:
            return self._run(**self.args_schema(**kwargs).model_dump())

    module = types.ModuleType("crewai")
    outils = types.ModuleType("crewai.tools")
    outils.BaseTool = BaseTool
    module.tools = outils
    monkeypatch.setitem(sys.modules, "crewai", module)
    monkeypatch.setitem(sys.modules, "crewai.tools", outils)
    yield "minimal"
