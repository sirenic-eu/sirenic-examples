"""HTTP client of the Sirenic API (https://api.sirenic.eu).

Three ways to call a paid route, one per client:

* an API key (``api_key=`` or the ``SIRENIC_API_KEY`` environment variable),
  sent in the ``X-Api-Key`` header and paid with the account's prepaid credits,
  never above ``max_credits`` when it is set;
* a wallet (``wallet_key=``, extra ``sirenic[pay]``): each call is paid in
  x402 by the official ``x402`` package, which signs locally, never above
  ``max_price_usd``, in USDC or EURC on Base;
* neither: a paid route raises :class:`sirenic.PaymentRequired`, carrying the
  quote (a free dry run).

Free routes (``suggestions``) need nothing. The client stores nothing, embeds
no key, and sends the key to ``base_url`` only: :meth:`Client.get` takes a path,
never a full URL, and a redirect is followed only on the host of ``base_url``.
"""

from __future__ import annotations

import os
import re
from decimal import ROUND_FLOOR, Decimal
from importlib import metadata
from typing import Any, Dict, Iterable, Mapping, Optional, Tuple, Union
from urllib.parse import urljoin, urlsplit

import requests

from ._version import __version__
from .errors import (
    AccountRequired,
    AuthenticationError,
    CreditCapExceeded,
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
    UnsupportedAsset,
    UpstreamUnavailable,
    _libelle,
)
from .response import Response

__all__ = ["Client", "DEFAULT_BASE_URL", "DEFAULT_TIMEOUT", "ENV_API_KEY", "USER_AGENT"]

DEFAULT_BASE_URL = "https://api.sirenic.eu"
DEFAULT_TIMEOUT = 120.0
ENV_API_KEY = "SIRENIC_API_KEY"
USER_AGENT = f"sirenic-python/{__version__}"

_SIREN = re.compile(r"\d{9}")
_CHEMIN = re.compile(r"/(?:v1|preview)/\S*")
# https, or plain http on the loopback for tests.
_BASE = re.compile(r"(?:https://[^/\s?#]+|http://(?:localhost|127\.0\.0\.1)(?::\d+)?)(?:/[^\s?#]*)?")
_REDIRECTIONS = frozenset({301, 302, 303, 307, 308})
_MAX_REDIRECTIONS = 5
_PORTS = {"https": 443, "http": 80}
_DECIMALES = 6  # USDC and EURC on Base
# What the wallet rail pays: the x402 "exact" scheme (an EIP-3009 authorization) on Base mainnet, in
# USDC (an x402 default asset) or EURC (allowed explicitly: x402 pays only its default assets otherwise).
_BASE_MAINNET = "eip155:8453"
_EURC_BASE = "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42"
_ACTIFS_PAYES = frozenset(
    {
        (_BASE_MAINNET, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"),  # USDC
        (_BASE_MAINNET, _EURC_BASE.lower()),  # EURC
    }
)
# First x402 release whose handle_402_response takes the request URL: older ones build no payment.
X402_MIN = (2, 20)


def _siren(valeur: Any) -> str:
    texte = str(valeur).replace(" ", "")
    if not _SIREN.fullmatch(texte):
        raise ValueError(f"siren must be 9 digits, got {valeur!r}")
    return texte


def _payable(scheme: Any, network: Any, asset: Any) -> bool:
    """An option this client pays: the exact scheme, in USDC or EURC on Base."""
    return scheme == "exact" and (str(network), str(asset).lower()) in _ACTIFS_PAYES


def _seulement_payables(version: int, exigences: list) -> list:
    """x402 policy: keep the options in an asset this client pays."""
    return [e for e in exigences if _payable(e.scheme, e.network, e.asset)]


def _plafond_valide(nom: str, valeur: Any) -> None:
    """A cap is a positive, finite number (int, float or Decimal)."""
    if isinstance(valeur, bool) or not isinstance(valeur, (int, float, Decimal)):
        raise ValueError(f"{nom} must be a positive finite number")
    if not Decimal(str(valeur)).is_finite() or valeur <= 0:
        raise ValueError(f"{nom} must be a positive finite number")


def _atomique(max_price_usd: Union[float, Decimal]) -> int:
    """Price cap in atomic units (6 decimals), rounded down: never above the cap."""
    return int((Decimal(str(max_price_usd)) * (10**_DECIMALES)).to_integral_value(rounding=ROUND_FLOOR))


def _version_x402() -> str:
    """Version of the installed x402 distribution ("" when its metadata cannot be read)."""
    try:
        return metadata.version("x402")
    except metadata.PackageNotFoundError:
        return ""


def _client_x402(wallet_key: str, max_price_usd: Union[float, Decimal]) -> Any:
    try:
        from eth_account import Account
        from x402 import max_amount, x402ClientSync
        from x402.http import x402HTTPClientSync
        from x402.mechanisms.evm import EthAccountSigner
        from x402.mechanisms.evm.exact import ExactEvmScheme
    except ImportError as erreur:
        raise ImportError('Paying per call with a wallet needs the payment extra: pip install "sirenic[pay]"') from erreur
    installee = _version_x402()
    lue = re.match(r"(\d+)\.(\d+)", installee)
    if lue and (int(lue[1]), int(lue[2])) < X402_MIN:
        raise ImportError(
            f"Paying per call with a wallet needs x402 2.20 or later (installed: {installee}):"
            ' pip install -U "sirenic[pay]"'
        )
    plafond = _atomique(max_price_usd)
    client = x402ClientSync()
    client.register(_BASE_MAINNET, ExactEvmScheme(signer=EthAccountSigner(Account.from_key(wallet_key))))
    client.register_policy(_seulement_payables)
    client.register_policy(max_amount(plafond))
    # x402 caps every payment at $1 by default and pays its default assets only (USDC on Base):
    # the cap becomes ours, and EURC on Base is allowed under the same cap in atomic units.
    client.set_spend_controls(
        {
            "max_amount_per_payment": "$" + format(Decimal(str(max_price_usd)), "f"),
            "allowed_assets": [{"network": _BASE_MAINNET, "asset": _EURC_BASE, "max_amount_per_payment": str(plafond)}],
        }
    )
    return x402HTTPClientSync(client)


def _origine(url: str) -> Tuple[str, Optional[str], Optional[int]]:
    """Scheme, host and port of an address: a redirect is followed only within the origin of ``base_url``."""
    morceaux = urlsplit(url)
    schema = morceaux.scheme.lower()
    try:
        port = morceaux.port
    except ValueError:
        port = -1
    return schema, morceaux.hostname, port or _PORTS.get(schema)


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
    :param max_price_usd: hard per-call cap of the wallet rail (default 1.0),
        compared with the quoted amount (Sirenic quotes the same figure in USDC
        and EURC). A quote above it raises :class:`sirenic.PriceCapExceeded`
        and nothing is signed. The wallet pays the x402 ``exact`` scheme on
        Base, in USDC (the first option of every Sirenic quote) or EURC; a
        quote in no such asset raises :class:`sirenic.UnsupportedAsset`.
    :param max_credits: hard per-call cap of the API key rail, in credits
        (1 credit = 1 EUR; a call costs the figure of its x402 quote). Off by
        default (``None``): your prepaid balance bounds the spend. When set,
        each call first asks the free quote of the same request (one more
        request, without the key); above the cap it raises
        :class:`sirenic.CreditCapExceeded` and the paid call is not made. A call
        whose price is not quoted without a key (filed deeds answer 401
        ``compte_requis``) is not made under a cap either.
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
        max_credits: Optional[Union[float, Decimal]] = None,
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
        _plafond_valide("max_price_usd", max_price_usd)
        if max_credits is not None:
            _plafond_valide("max_credits", max_credits)
        if not isinstance(base_url, str) or not _BASE.fullmatch(base_url.rstrip("/")):
            raise ValueError(
                "base_url must be an https URL without query, e.g. https://api.sirenic.eu"
                " (plain http only on localhost or 127.0.0.1, for tests)"
            )
        self._api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_price_usd = max_price_usd
        self.max_credits = max_credits
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
        """One GET. Redirects are followed here, not by ``requests``, and only within the origin of
        ``base_url``: the API key and an x402 payment header are never sent to another host."""
        try:
            reponse = self._session.get(
                url, params=params, headers=dict(entetes), timeout=self.timeout, allow_redirects=False
            )
            for _ in range(_MAX_REDIRECTIONS):
                cible = reponse.headers.get("location") if reponse.status_code in _REDIRECTIONS else None
                if not cible:
                    break
                suivante = urljoin(reponse.url, cible)
                if _origine(suivante) != _origine(self.base_url):
                    raise SirenicError(
                        f"Redirect to another host not followed: {suivante} (the API key and payment headers"
                        f" are only sent to {self.base_url}).",
                        status=reponse.status_code,
                        headers=reponse.headers,
                        url=reponse.url,
                    )
                _ = reponse.content  # read the body, so that the connection is released
                reponse.close()
                reponse = self._session.get(
                    suivante, headers=dict(entetes), timeout=self.timeout, allow_redirects=False
                )
        except requests.RequestException as erreur:
            raise NetworkError(f"{type(erreur).__name__} while calling {url}", url=url) from erreur
        return reponse

    def _appeler(self, url: str, params: Optional[Dict[str, Any]]) -> Response:
        entetes = self._entetes()
        if self._api_key and self.max_credits is not None:
            gratuite = self._sous_le_plafond(url, params)
            if gratuite is not None:
                return gratuite
        reponse = self._envoyer(url, params, entetes)
        if reponse.status_code == 402 and self._x402 is not None:
            devis = _erreur(reponse)
            if isinstance(devis, PaymentRequired) and devis.accepts:
                reponse = self._payer(url, params, entetes, reponse, devis)
        if 200 <= reponse.status_code < 300:
            return Response(reponse.status_code, reponse.headers, reponse.content, reponse.url)
        raise _erreur(reponse)

    def _sous_le_plafond(self, url: str, params: Optional[Dict[str, Any]]) -> Optional[Response]:
        """API key rail under ``max_credits``: the same request without the key returns its free quote,
        and the service debits the key the amount it quotes. Returns None when the paid call may be made,
        the response itself when the route is free (nothing to pay), or raises."""
        sans_cle = {nom: valeur for nom, valeur in self._entetes().items() if nom != "X-Api-Key"}
        reponse = self._envoyer(url, params, sans_cle)
        if 200 <= reponse.status_code < 300:
            return Response(reponse.status_code, reponse.headers, reponse.content, reponse.url)
        devis = _erreur(reponse)
        contexte: Dict[str, Any] = {
            "max_credits": self.max_credits,
            "status": devis.status,
            "code": devis.code,
            "body": devis.body,
            "headers": devis.headers,
            "url": devis.url,
        }
        if isinstance(devis, PaymentRequired):
            montants = [o.amount for o in devis.accepts if o.amount is not None]
            if not montants:
                raise CreditCapExceeded(
                    "The quote of this call states no amount: it cannot be checked against max_credits,"
                    " so the call was not made.",
                    **contexte,
                )
            prix = Decimal(max(montants)) / (10**_DECIMALES)
            if prix <= Decimal(str(self.max_credits)):
                return None
            raise CreditCapExceeded(
                f"Price {prix} credits is above max_credits={self.max_credits}: the call was not made.",
                credits=prix,
                **contexte,
            )
        if devis.code == "compte_requis":
            raise CreditCapExceeded(
                "The price of this call is not quoted without an API key (401 compte_requis): it cannot be"
                " checked against max_credits, so the call was not made. Pass max_credits=None to make it.",
                **contexte,
            )
        raise devis

    def _payer(
        self,
        url: str,
        params: Optional[Dict[str, Any]],
        entetes: Mapping[str, str],
        reponse: requests.Response,
        devis: PaymentRequired,
    ) -> requests.Response:
        contexte: Dict[str, Any] = {
            "status": 402,
            "code": devis.code,
            "body": devis.body,
            "headers": devis.headers,
            "url": devis.url,
        }
        payables = [o for o in devis.accepts if _payable(o.scheme, o.network, o.asset)]
        if not payables:
            offerts = ", ".join(map(_libelle, devis.accepts))
            raise UnsupportedAsset(
                f"No option of the quote is in an asset this client pays (offered: {offerts};"
                " paid: USDC or EURC on Base): nothing was signed.",
                **contexte,
            )
        montants = [o.amount for o in payables if o.amount is not None]
        if not montants:
            raise PaymentFailed("The quote states no amount in atomic units: nothing was signed.", **contexte)
        if min(montants) > _atomique(self.max_price_usd):
            raise PriceCapExceeded(
                f"Quote {devis.price} is above max_price_usd={self.max_price_usd}: nothing was signed.",
                max_price_usd=self.max_price_usd,
                **contexte,
            )
        try:
            entetes_paiement, _ = self._x402.handle_402_response(dict(reponse.headers), reponse.content, reponse.url)
        except Exception as erreur:
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
