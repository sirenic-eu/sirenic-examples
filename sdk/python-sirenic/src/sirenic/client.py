"""HTTP client of the Sirenic API (https://api.sirenic.eu).

Three ways to call a paid route, one per client:

* an API key (``api_key=`` or the ``SIRENIC_API_KEY`` environment variable),
  sent in the ``X-Api-Key`` header and paid with the account's prepaid credits;
* a wallet (``wallet_key=``, extra ``sirenic[pay]``): each call is paid in
  x402 by the official ``x402`` package, which signs locally, never above
  ``max_price_usd``;
* neither: a paid route raises :class:`sirenic.PaymentRequired`, carrying the
  quote (a free dry run).

Free routes (``suggestions``) need nothing. The client stores nothing, embeds
no key, and sends the key to ``base_url`` only: :meth:`Client.get` takes a path,
never a full URL.
"""

from __future__ import annotations

import os
import re
from decimal import ROUND_FLOOR, Decimal
from typing import Any, Dict, Iterable, Mapping, Optional, Union

import requests

from ._version import __version__
from .errors import (
    AccountRequired,
    AuthenticationError,
    InsufficientCredits,
    InvalidRequest,
    NetworkError,
    NotFound,
    PaymentFailed,
    PaymentRequired,
    PriceCapExceeded,
    RateLimited,
    ServiceUnavailable,
    SirenicError,
    UpstreamUnavailable,
)
from .response import Response

__all__ = ["Client", "DEFAULT_BASE_URL", "DEFAULT_TIMEOUT", "ENV_API_KEY", "USER_AGENT"]

DEFAULT_BASE_URL = "https://api.sirenic.eu"
DEFAULT_TIMEOUT = 120.0
ENV_API_KEY = "SIRENIC_API_KEY"
USER_AGENT = f"sirenic-python/{__version__}"

_SIREN = re.compile(r"\d{9}")
_CHEMIN = re.compile(r"/(?:v1|preview)/\S*")
_BASE = re.compile(r"https?://[^/\s?#]+(?:/[^\s?#]*)?")
_DECIMALES = 6  # USDC and EURC on Base


def _siren(valeur: Any) -> str:
    texte = str(valeur).replace(" ", "")
    if not _SIREN.fullmatch(texte):
        raise ValueError(f"siren must be 9 digits, got {valeur!r}")
    return texte


def _atomique(max_price_usd: Union[float, Decimal]) -> int:
    """Price cap in atomic units (6 decimals), rounded down: never above the cap."""
    return int((Decimal(str(max_price_usd)) * (10**_DECIMALES)).to_integral_value(rounding=ROUND_FLOOR))


def _client_x402(wallet_key: str, max_price_usd: Union[float, Decimal]) -> Any:
    try:
        from eth_account import Account
        from x402 import max_amount, x402ClientSync
        from x402.http import x402HTTPClientSync
        from x402.mechanisms.evm import EthAccountSigner
        from x402.mechanisms.evm.exact import ExactEvmScheme
    except ImportError as erreur:
        raise ImportError('Paying per call with a wallet needs the payment extra: pip install "sirenic[pay]"') from erreur
    client = x402ClientSync()
    client.register("eip155:*", ExactEvmScheme(signer=EthAccountSigner(Account.from_key(wallet_key))))
    client.register_policy(max_amount(_atomique(max_price_usd)))
    if hasattr(client, "set_spend_controls"):
        # Recent x402 releases cap every payment at $1 by default: the cap becomes ours.
        client.set_spend_controls({"max_amount_per_payment": "$" + format(Decimal(str(max_price_usd)), "f")})
    return x402HTTPClientSync(client)


def _erreur(reponse: requests.Response) -> SirenicError:
    """The typed error of a non-2xx response, read from the body the service serves."""
    statut = reponse.status_code
    corps: Any
    try:
        corps = reponse.json()
    except ValueError:
        corps = reponse.text
    code = corps.get("error") if isinstance(corps, dict) and isinstance(corps.get("error"), str) else None
    if isinstance(corps, dict) and isinstance(corps.get("message"), str):
        message: Optional[str] = corps["message"]
    else:
        message = (corps.strip()[:300] or None) if isinstance(corps, str) else None
    options: Dict[str, Any] = {
        "status": statut,
        "code": code,
        "body": corps,
        "headers": dict(reponse.headers),
        "url": reponse.url,
    }
    if statut == 400:
        return InvalidRequest(message, **options)
    if statut == 401:
        return (AccountRequired if code == "compte_requis" else AuthenticationError)(message, **options)
    if statut == 402:
        return (InsufficientCredits if code == "credits_insuffisants" else PaymentRequired)(message, **options)
    if statut == 403:
        return AuthenticationError(message, **options)
    if statut == 404:
        return NotFound(message, **options)
    if statut == 429:
        return RateLimited(message, **options)
    if statut == 503:
        return (UpstreamUnavailable if code == "amont_indisponible" else ServiceUnavailable)(message, **options)
    return SirenicError(message, **options)


class Client:
    """Client of the Sirenic API.

    :param api_key: Sirenic API key (``srn_live_...``). When neither
        ``api_key`` nor ``wallet_key`` is given, it is read from the
        ``SIRENIC_API_KEY`` environment variable.
    :param wallet_key: EVM private key of YOUR paying wallet, to pay each call
        in x402 (needs ``pip install "sirenic[pay]"``). It never leaves this
        process: payments are EIP-3009 authorizations signed locally.
    :param max_price_usd: hard per-call cap of the wallet rail (default 1.0).
        A quote above it raises :class:`sirenic.PriceCapExceeded` and nothing
        is signed.
    :param base_url: default ``https://api.sirenic.eu``.
    :param timeout: seconds per HTTP request (default 120).
    :param session: an existing ``requests.Session`` (proxies, adapters).
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        wallet_key: Optional[str] = None,
        max_price_usd: Union[float, Decimal] = 1.0,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        session: Optional[requests.Session] = None,
    ) -> None:
        api_key = (api_key or "").strip() or None
        wallet_key = (wallet_key or "").strip() or None
        if api_key and wallet_key:
            raise ValueError("Pass api_key or wallet_key, not both: one payment rail per client.")
        if api_key is None and wallet_key is None:
            api_key = (os.environ.get(ENV_API_KEY) or "").strip() or None
        if api_key is not None and any(c.isspace() for c in api_key):
            raise ValueError("api_key must not contain whitespace")
        if isinstance(max_price_usd, bool) or not isinstance(max_price_usd, (int, float, Decimal)) or max_price_usd <= 0:
            raise ValueError("max_price_usd must be a positive number")
        if not _BASE.fullmatch(base_url.rstrip("/")):
            raise ValueError("base_url must be an http(s) URL without query, e.g. https://api.sirenic.eu")
        self._api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_price_usd = max_price_usd
        self._propre_session = session is None
        self._session = session if session is not None else requests.Session()
        self._x402 = _client_x402(wallet_key, max_price_usd) if wallet_key else None

    @property
    def rail(self) -> str:
        """``"api_key"``, ``"x402"`` or ``"quote"`` (neither: paid routes raise PaymentRequired)."""
        if self._api_key:
            return "api_key"
        if self._x402 is not None:
            return "x402"
        return "quote"

    def __repr__(self) -> str:
        return f"Client(base_url={self.base_url!r}, rail={self.rail!r})"

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    def close(self) -> None:
        if self._propre_session:
            self._session.close()

    # Routes

    def suggestions(self, q: str) -> Response:
        """``GET /v1/suggestions``: free name autocomplete (name or SIREN to SIREN, 5 results at most)."""
        return self.get("/v1/suggestions", {"q": q})

    def entreprise(self, siren: str) -> Response:
        """``GET /v1/entreprise/{siren}``: full company profile."""
        return self.get(f"/v1/entreprise/{_siren(siren)}")

    def dossier(self, siren: str, blocs: Union[str, Iterable[str]]) -> Response:
        """``GET /v1/entreprise/{siren}/dossier``: identity plus the blocks you pick (each billed at its own price).

        ``blocs`` is a list of block names or a comma-separated string, e.g.
        ``["finances", "pi"]``; an unknown name is refused by the service (400).
        """
        noms = blocs.split(",") if isinstance(blocs, str) else [str(b) for b in blocs]
        liste = [b.strip() for b in noms if b and b.strip()]
        if not liste:
            raise ValueError("blocs: name at least one block")
        return self.get(f"/v1/entreprise/{_siren(siren)}/dossier", {"blocs": ",".join(liste)})

    def kyb(self, siren: str) -> Response:
        """``GET /v1/kyb/{siren}``: complete KYB file."""
        return self.get(f"/v1/kyb/{_siren(siren)}")

    def facturation_dossier(self, siren: str, iban: Optional[str] = None) -> Response:
        """``GET /v1/facturation/dossier``: can you invoice this French company (VAT checked live, optional IBAN check)."""
        params = {"siren": _siren(siren)}
        if iban:
            params["iban"] = iban
        return self.get("/v1/facturation/dossier", params)

    def get(self, chemin: str, params: Optional[Mapping[str, Any]] = None) -> Response:
        """``GET`` any Sirenic path (``/v1/...`` or ``/preview/...``), e.g.
        ``client.get("/v1/entreprise/552032534/finances")``. Returns a
        :class:`sirenic.Response` or raises a :class:`sirenic.SirenicError`."""
        if not isinstance(chemin, str) or not _CHEMIN.fullmatch(chemin):
            raise ValueError("chemin must be a Sirenic path starting with /v1/ or /preview/, never a full URL")
        return self._appeler(self.base_url + chemin, dict(params) if params else None)

    # Transport

    def _entetes(self) -> Dict[str, str]:
        entetes = {"Accept": "application/json", "User-Agent": USER_AGENT}
        if self._api_key:
            entetes["X-Api-Key"] = self._api_key
        return entetes

    def _envoyer(self, url: str, params: Optional[Dict[str, Any]], entetes: Mapping[str, str]) -> requests.Response:
        try:
            return self._session.get(url, params=params, headers=dict(entetes), timeout=self.timeout)
        except requests.RequestException as erreur:
            raise NetworkError(f"{type(erreur).__name__} while calling {url}", url=url) from erreur

    def _appeler(self, url: str, params: Optional[Dict[str, Any]]) -> Response:
        entetes = self._entetes()
        reponse = self._envoyer(url, params, entetes)
        if reponse.status_code == 402 and self._x402 is not None:
            devis = _erreur(reponse)
            if isinstance(devis, PaymentRequired) and devis.accepts:
                reponse = self._payer(url, params, entetes, reponse, devis)
        if 200 <= reponse.status_code < 300:
            return Response(reponse.status_code, reponse.headers, reponse.content, reponse.url)
        raise _erreur(reponse)

    def _payer(
        self,
        url: str,
        params: Optional[Dict[str, Any]],
        entetes: Mapping[str, str],
        reponse: requests.Response,
        devis: PaymentRequired,
    ) -> requests.Response:
        contexte: Dict[str, Any] = {
            "max_price_usd": self.max_price_usd,
            "status": 402,
            "code": devis.code,
            "body": devis.body,
            "headers": devis.headers,
            "url": devis.url,
        }
        montant = devis.min_amount
        if montant is None or montant > _atomique(self.max_price_usd):
            raise PriceCapExceeded(
                f"Quote {devis.price} is above max_price_usd={self.max_price_usd}: nothing was signed.", **contexte
            )
        try:
            entetes_paiement, _ = self._x402.handle_402_response(dict(reponse.headers), reponse.content, reponse.url)
        except Exception as erreur:
            if type(erreur).__name__ == "NoMatchingRequirementsError":
                raise PriceCapExceeded(
                    f"The x402 client refused every option of the quote ({erreur}): nothing was signed.", **contexte
                ) from erreur
            raise PaymentFailed(f"The x402 payment could not be built: {type(erreur).__name__}", url=url) from erreur
        payee = self._envoyer(url, params, {**entetes, **entetes_paiement})
        if payee.status_code == 402:
            refus = _erreur(payee)
            raise PaymentFailed(
                f"The signed payment was not accepted: {refus.message or refus.code or 402}",
                status=402,
                code=refus.code,
                body=refus.body,
                headers=refus.headers,
                url=refus.url,
            )
        return payee
