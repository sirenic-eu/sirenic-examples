"""Python client of the Sirenic API: French and European company data from the official registers.

    import sirenic

    client = sirenic.Client()  # reads SIRENIC_API_KEY
    profil = client.entreprise("552032534")
    for p in profil.provenance:
        print(p.bloc, p.source_code, p.as_of, p.etat)

Paid routes are paid with an API key (prepaid credits) or per call in x402
(``pip install "sirenic[pay]"``, ``Client(wallet_key=..., max_price_usd=...)``).
Without either, a paid route raises :class:`PaymentRequired` with the quote.
"""

from ._version import __version__
from .client import DEFAULT_BASE_URL, DEFAULT_TIMEOUT, ENV_API_KEY, USER_AGENT, Client
from .errors import (
    AccountRequired,
    AuthenticationError,
    InsufficientCredits,
    InvalidRequest,
    NetworkError,
    NotFound,
    PaymentFailed,
    PaymentOption,
    PaymentRequired,
    PriceCapExceeded,
    RateLimited,
    ServiceUnavailable,
    SirenicError,
    UpstreamUnavailable,
)
from .response import Couverture, ListeBornee, Provenance, Response

__all__ = [
    "__version__",
    "Client",
    "DEFAULT_BASE_URL",
    "DEFAULT_TIMEOUT",
    "ENV_API_KEY",
    "USER_AGENT",
    "Response",
    "Provenance",
    "Couverture",
    "ListeBornee",
    "PaymentOption",
    "SirenicError",
    "NetworkError",
    "InvalidRequest",
    "AuthenticationError",
    "AccountRequired",
    "PaymentRequired",
    "PriceCapExceeded",
    "PaymentFailed",
    "InsufficientCredits",
    "NotFound",
    "RateLimited",
    "ServiceUnavailable",
    "UpstreamUnavailable",
]
