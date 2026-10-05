"""A served response and its common envelope.

Every paid JSON response of the Sirenic API carries ``provenance[]``: one entry
per block served, naming the official register (``source_code``,
``registre``), its ``licence`` and ``version``, the snapshot date ``as_of`` and
what that date means (``precision_as_of``), then the common envelope:
``etat`` (closed list), ``motif`` when unavailable, ``age_jours``,
``couverture`` and ``confiance``. A bounded list states its total and its cut
in ``listes_bornees`` of the object that carries it. The closed lists and the
reading rules are served for free at ``GET /v1/lecture``; register codes at
``GET /v1/provenance/registres``. This module reads those fields as served and
never computes or fills one.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Iterator, List, Mapping, Optional

__all__ = ["Response", "Provenance", "Couverture", "ListeBornee"]


@dataclass(frozen=True)
class Couverture:
    """``couverture`` of a provenance entry: ``etat`` (complete, partielle,
    non_mesurable) and ``mesure`` (where the coverage is measured)."""

    etat: Optional[str]
    mesure: Optional[str]
    raw: Mapping[str, Any]


@dataclass(frozen=True)
class Provenance:
    """One entry of ``provenance[]``, field names as served."""

    bloc: Optional[str]
    source_code: Optional[str]
    registre: Optional[str]
    mode: Optional[str]
    licence: Optional[str]
    version: Optional[str]
    as_of: Optional[str]
    precision_as_of: Optional[str]
    age_jours: Optional[int]
    etat: Optional[str]
    motif: Optional[str]
    couverture: Optional[Couverture]
    confiance: Optional[str]
    empreinte_sha256: Optional[str]
    raw: Mapping[str, Any]

    @classmethod
    def depuis(cls, brut: Mapping[str, Any]) -> "Provenance":
        couverture = brut.get("couverture")
        age = brut.get("age_jours")
        return cls(
            bloc=brut.get("bloc"),
            source_code=brut.get("source_code"),
            registre=brut.get("registre"),
            mode=brut.get("mode"),
            licence=brut.get("licence"),
            version=brut.get("version"),
            as_of=brut.get("as_of"),
            precision_as_of=brut.get("precision_as_of"),
            age_jours=age if isinstance(age, int) and not isinstance(age, bool) else None,
            etat=brut.get("etat"),
            motif=brut.get("motif"),
            couverture=(
                Couverture(etat=couverture.get("etat"), mesure=couverture.get("mesure"), raw=dict(couverture))
                if isinstance(couverture, Mapping)
                else None
            ),
            confiance=brut.get("confiance"),
            empreinte_sha256=brut.get("empreinte_sha256"),
            raw=dict(brut),
        )


@dataclass(frozen=True)
class ListeBornee:
    """One bounded list: ``path`` of the object that carries
    ``listes_bornees`` (empty at the top level), ``name`` of the list, then the
    served ``nombre_total``, ``tronque`` (the served list is cut) and
    ``total_borne_basse`` (the total is only a lower bound; present when true)."""

    path: str
    name: str
    nombre_total: Optional[int]
    tronque: Optional[bool]
    total_borne_basse: Optional[bool]
    raw: Mapping[str, Any]


def _parcourir_listes(donnee: Any, chemin: str) -> Iterator[ListeBornee]:
    if isinstance(donnee, Mapping):
        bornees = donnee.get("listes_bornees")
        if isinstance(bornees, Mapping):
            for nom, valeur in bornees.items():
                if isinstance(valeur, Mapping):
                    total = valeur.get("nombre_total")
                    yield ListeBornee(
                        path=chemin,
                        name=str(nom),
                        nombre_total=total if isinstance(total, int) and not isinstance(total, bool) else None,
                        tronque=valeur.get("tronque") if isinstance(valeur.get("tronque"), bool) else None,
                        total_borne_basse=(
                            valeur.get("total_borne_basse") if isinstance(valeur.get("total_borne_basse"), bool) else None
                        ),
                        raw=dict(valeur),
                    )
        for cle, valeur in donnee.items():
            if cle == "listes_bornees":
                continue
            yield from _parcourir_listes(valeur, f"{chemin}.{cle}" if chemin else str(cle))
    elif isinstance(donnee, list):
        for index, valeur in enumerate(donnee):
            yield from _parcourir_listes(valeur, f"{chemin}[{index}]")


def _decimal(valeur: Optional[str]) -> Optional[Decimal]:
    if valeur is None:
        return None
    try:
        return Decimal(valeur.strip())
    except (InvalidOperation, AttributeError):
        return None


class Response:
    """A 2xx response of the Sirenic API.

    ``data`` is the parsed JSON body (``None`` for a non-JSON body such as a
    PDF, then read ``content``). ``response["key"]`` reads ``data``.
    """

    def __init__(self, status: int, headers: Mapping[str, str], content: bytes, url: str) -> None:
        self.status = status
        self.headers: Dict[str, str] = {k.lower(): v for k, v in headers.items()}
        self.content = content
        self.url = url
        self.data: Any = None
        if "json" in self.headers.get("content-type", ""):
            try:
                self.data = json.loads(content.decode("utf-8")) if content else None
            except (ValueError, UnicodeDecodeError):
                self.data = None

    def __repr__(self) -> str:
        return f"<sirenic.Response {self.status} {self.url}>"

    def __getitem__(self, cle: str) -> Any:
        if not isinstance(self.data, Mapping):
            raise KeyError(cle)
        return self.data[cle]

    def get(self, cle: str, defaut: Any = None) -> Any:
        return self.data.get(cle, defaut) if isinstance(self.data, Mapping) else defaut

    def json(self) -> Any:
        return self.data

    @property
    def provenance(self) -> List[Provenance]:
        """``provenance[]`` of the response, one entry per block served (empty for a free route)."""
        entrees = self.data.get("provenance") if isinstance(self.data, Mapping) else None
        if not isinstance(entrees, list):
            return []
        return [Provenance.depuis(e) for e in entrees if isinstance(e, Mapping)]

    def bloc(self, nom: str) -> Optional[Provenance]:
        """The provenance entry of block ``nom`` (e.g. ``"identite"``, ``"blocs.finances"``), or None."""
        return next((p for p in self.provenance if p.bloc == nom), None)

    @property
    def listes_bornees(self) -> List[ListeBornee]:
        """Every ``listes_bornees`` entry of the response, at any depth."""
        return list(_parcourir_listes(self.data, ""))

    @property
    def credits_charged(self) -> Optional[Decimal]:
        """Credits charged for this call on the API key rail (``X-Credits-Charged``, 1 credit = 1 EUR)."""
        return _decimal(self.headers.get("x-credits-charged"))

    @property
    def credits_remaining(self) -> Optional[Decimal]:
        """Credit balance after this call (``X-Credits-Remaining``), when served."""
        return _decimal(self.headers.get("x-credits-remaining"))

    @property
    def request_id(self) -> Optional[str]:
        return self.headers.get("x-request-id")
