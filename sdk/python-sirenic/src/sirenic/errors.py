"""Typed errors of the Sirenic client, read from the responses the service serves.

Every error carries ``status`` (HTTP status, or None for a network error),
``code`` (the ``error`` field of the JSON body, e.g. ``compte_requis``),
``message`` (the service's own message, French then English), ``body`` (the
parsed JSON body, or the text) and ``headers``. The closed list of outage codes
and their statuses is served for free at ``GET /v1/lecture`` (``motif_panne``).
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any, List, Mapping, Optional

__all__ = [
    "SirenicError",
    "NetworkError",
    "InvalidRequest",
    "AuthenticationError",
    "AccountRequired",
    "PaymentRequired",
    "PaymentOption",
    "PriceCapExceeded",
    "PaymentFailed",
    "InsufficientCredits",
    "NotFound",
    "RateLimited",
    "ServiceUnavailable",
    "UpstreamUnavailable",
]


class SirenicError(Exception):
    """Base class of every error raised by :class:`sirenic.Client`."""

    def __init__(
        self,
        message: Optional[str] = None,
        *,
        status: Optional[int] = None,
        code: Optional[str] = None,
        body: Any = None,
        headers: Optional[Mapping[str, str]] = None,
        url: Optional[str] = None,
    ) -> None:
        self.status = status
        self.code = code
        self.message = message
        self.body = body
        self.headers = dict(headers or {})
        self.url = url
        super().__init__(self._texte())

    def _texte(self) -> str:
        parties = []
        if self.status is not None:
            parties.append(str(self.status))
        if self.code:
            parties.append(self.code)
        texte = " ".join(parties)
        if self.message:
            texte = f"{texte}: {self.message}" if texte else self.message
        return texte or self.__class__.__name__


class NetworkError(SirenicError):
    """The service could not be reached (connection error or timeout)."""


class InvalidRequest(SirenicError):
    """400: a parameter is missing or malformed (never charged).

    ``champ`` names the parameter when the service says which one.
    """

    @property
    def champ(self) -> Optional[str]:
        return self.body.get("champ") if isinstance(self.body, dict) else None


class AuthenticationError(SirenicError):
    """401 or 403 from the API key rail: unknown, revoked or expired key
    (``cle_invalide``, ``cle_expiree``) or an account that cannot consume
    (``compte_suspendu``, ``compte_ferme``)."""


class AccountRequired(AuthenticationError):
    """401 ``compte_requis``: the route is reserved to identified Sirenic
    accounts (filed deeds of ``/v1/documents/actes/{id}``). Nothing is charged;
    call it again with an API key."""


@dataclass(frozen=True)
class PaymentOption:
    """One entry of ``accepts[]`` in an x402 quote."""

    scheme: Optional[str]
    network: Optional[str]
    asset: Optional[str]
    asset_name: Optional[str]
    pay_to: Optional[str]
    amount: Optional[int]
    max_timeout_seconds: Optional[int]
    resource: Optional[str]
    raw: Mapping[str, Any]

    @classmethod
    def depuis(cls, brut: Mapping[str, Any]) -> "PaymentOption":
        extra = brut.get("extra") if isinstance(brut.get("extra"), Mapping) else {}
        montant = brut.get("amount", brut.get("maxAmountRequired"))
        try:
            montant_entier = int(montant) if montant is not None else None
        except (TypeError, ValueError):
            montant_entier = None
        delai = brut.get("maxTimeoutSeconds")
        return cls(
            scheme=brut.get("scheme"),
            network=brut.get("network"),
            asset=brut.get("asset"),
            asset_name=extra.get("name") if extra else None,
            pay_to=brut.get("payTo"),
            amount=montant_entier,
            max_timeout_seconds=delai if isinstance(delai, int) else None,
            resource=brut.get("resource") if isinstance(brut.get("resource"), str) else None,
            raw=dict(brut),
        )


def _devis_depuis_entete(entetes: Mapping[str, str]) -> Optional[Mapping[str, Any]]:
    valeur = None
    for nom, contenu in entetes.items():
        if nom.lower() == "payment-required":
            valeur = contenu
            break
    if not valeur:
        return None
    try:
        decode = json.loads(base64.b64decode(valeur))
    except (ValueError, TypeError):
        return None
    return decode if isinstance(decode, Mapping) else None


class PaymentRequired(SirenicError):
    """402 with an x402 quote: the route is paid and no payment was made.

    Raised when the client has neither an API key nor a wallet (a free dry
    run: the quote says what the call costs), and as the base class of
    :class:`PriceCapExceeded`. Attributes read from the quote the service
    serves: ``price`` (e.g. ``"$0.005"``), ``accepts`` (one
    :class:`PaymentOption` per asset: ``asset``, ``asset_name``, ``pay_to``,
    ``network``, ``amount`` in atomic units), ``x402_version``, ``quote`` (the
    raw JSON body) and ``payment_required_header`` (the base64
    ``PAYMENT-REQUIRED`` header, for clients that pay by themselves).
    """

    def __init__(self, message: Optional[str] = None, **kwargs: Any) -> None:
        super().__init__(message, **kwargs)
        corps = self.body if isinstance(self.body, Mapping) else {}
        entete = _devis_depuis_entete(self.headers)
        source = corps if corps.get("accepts") else (entete or {})
        self.quote: Mapping[str, Any] = corps or (entete or {})
        self.x402_version: Optional[int] = source.get("x402Version")
        self.accepts: List[PaymentOption] = [
            PaymentOption.depuis(a) for a in source.get("accepts", []) if isinstance(a, Mapping)
        ]
        self.price: Optional[str] = corps.get("price") if isinstance(corps.get("price"), str) else None
        self.payment_required_header: Optional[str] = next(
            (v for k, v in self.headers.items() if k.lower() == "payment-required"), None
        )

    @property
    def min_amount(self) -> Optional[int]:
        """Smallest amount among the offered options, in atomic units (6 decimals for USDC and EURC)."""
        montants = [o.amount for o in self.accepts if o.amount is not None]
        return min(montants) if montants else None


class PriceCapExceeded(PaymentRequired):
    """x402 rail: the quote is above ``max_price_usd``; nothing was signed.

    Same attributes as :class:`PaymentRequired`, plus ``max_price_usd``.
    """

    def __init__(self, message: Optional[str] = None, *, max_price_usd: Optional[float] = None, **kwargs: Any) -> None:
        self.max_price_usd = max_price_usd
        super().__init__(message, **kwargs)


class PaymentFailed(SirenicError):
    """x402 rail: a payment was signed but the service did not accept it, or
    the payment could not be built. ``status`` is the status of the retried
    call when there was one."""


class InsufficientCredits(SirenicError):
    """402 ``credits_insuffisants`` on the API key rail (no x402 quote):
    ``solde`` and ``prix`` in EUR, ``recharge_url`` to top up."""

    @property
    def solde(self) -> Any:
        return self.body.get("solde") if isinstance(self.body, dict) else None

    @property
    def prix(self) -> Any:
        return self.body.get("prix") if isinstance(self.body, dict) else None

    @property
    def recharge_url(self) -> Optional[str]:
        return self.body.get("recharge_url") if isinstance(self.body, dict) else None


class NotFound(SirenicError):
    """404: nothing to serve for this identifier (never charged)."""


class RateLimited(SirenicError):
    """429: a quota or rate limit was reached. ``retry_after`` is the
    ``Retry-After`` header in seconds, when the service sends it."""

    @property
    def retry_after(self) -> Optional[int]:
        for nom, valeur in self.headers.items():
            if nom.lower() == "retry-after":
                try:
                    return int(valeur)
                except (TypeError, ValueError):
                    return None
        return None


class ServiceUnavailable(SirenicError):
    """503: the call was not served and nothing was charged. ``code`` names
    the outage from the closed list ``motif_panne`` of ``GET /v1/lecture``."""


class UpstreamUnavailable(ServiceUnavailable):
    """503 ``amont_indisponible``: the official source did not answer; retry later."""
