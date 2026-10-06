"""Sirenic for Python agents (LangChain, CrewAI).

Company data from the official French and European registers, as agent
tools. Three ways to call a paid route: an API key (prepaid credits:
``api_key=`` or the ``SIRENIC_API_KEY`` environment variable, with a per-call
cap in credits), a wallet that pays each call in x402 (USDC or EURC on Base:
``wallet_key=`` and a hard price cap), or neither: every tool then returns the
x402 quote (handy for discovery and dry runs). Built on the ``sirenic`` client;
x402 payments are EIP-3009 authorizations signed locally by the official
``x402`` package, and the server never sees your wallet key.
"""

from __future__ import annotations

import json
from typing import Optional

import requests
from requests.utils import requote_uri
from urllib.parse import urlencode

import sirenic

__all__ = ["SirenicClient", "build_langchain_tools", "build_crewai_tools", "__version__"]
__version__ = "0.3.0"

# What a 402 quote means, by rail: the hint returned with it.
_INDICES = {
    "quote": "No API key or wallet configured. Provide api_key (prepaid credits) or wallet_key (x402) to pay.",
    "x402": "The quote offers no option the wallet can read: nothing was signed.",
    "api_key": "The service asked for an x402 payment although an API key is set: nothing was charged. Check the key.",
}


class SirenicClient:
    """Agent-facing client of api.sirenic.eu: every call returns a JSON string.

    :param wallet_key: EVM private key (``0x...``) of YOUR paying wallet, to
        pay each call in x402, in USDC or EURC on Base
        (``pip install "sirenic-agents[pay]"``).
    :param max_price_usd: hard per-call cap of the wallet rail (default 1.0),
        compared with the quoted amount. Quotes above the cap are never signed:
        the tool returns the quote instead. Calls priced per target or per
        entity (watchlists, batches) can cost more than 1.0: raise the cap for
        them.
    :param base_url: default ``https://api.sirenic.eu``.
    :param api_key: Sirenic API key (``srn_live_...``), paid with prepaid
        credits. When neither ``api_key`` nor ``wallet_key`` is given,
        ``SIRENIC_API_KEY`` is read from the environment. Without either, every
        paid tool returns the x402 quote.
    :param max_credits: hard per-call cap of the API key rail, in credits
        (1 credit = 1 EUR, the figure of the quote; default 1.0, the same sense
        as ``max_price_usd``). Each call first asks the free quote of the same
        request; above the cap the call is not made and the tool returns the
        price and the quote. ``None`` removes the cap and that extra request:
        your balance then bounds the spend. The quote request is sent without
        the key, so it counts against the service's per-IP rate limit for
        calls without a key (120 requests per minute): heavy use behind one IP
        address can get a 429 error before the paid call, which is then not
        made; for heavy traffic or a shared IP address, pass ``None``.
    :param timeout: seconds per HTTP request (default 120).
    :param session: an existing ``requests.Session`` (proxies, adapters).
    """

    def __init__(
        self,
        wallet_key: Optional[str] = None,
        max_price_usd: float = 1.0,
        base_url: str = sirenic.DEFAULT_BASE_URL,
        *,
        api_key: Optional[str] = None,
        max_credits: Optional[float] = 1.0,
        timeout: float = sirenic.DEFAULT_TIMEOUT,
        session: Optional[requests.Session] = None,
    ) -> None:
        self._client = sirenic.Client(
            api_key=api_key,
            wallet_key=wallet_key,
            max_price_usd=max_price_usd,
            max_credits=max_credits,
            base_url=base_url,
            timeout=timeout,
            session=session,
        )
        self.base_url = self._client.base_url

    @property
    def rail(self) -> str:
        """``"api_key"``, ``"x402"`` or ``"quote"`` (quote-only mode)."""
        return self._client.rail

    def get(self, path: str) -> str:
        """GET a Sirenic path (e.g. ``/v1/recherche?q=danone``), paying if
        needed. Always returns a JSON string (data, quote, or error). A space,
        or any character a URL cannot carry, is percent-encoded first, as
        ``requests`` does (``q=danone sa`` is sent as ``q=danone%20sa``)."""
        if not isinstance(path, str):
            return json.dumps({"error": "invalid_path", "message": "Only /v1/... and /preview/... paths are served."})
        try:
            reponse = self._client.get(requote_uri(path))
        except ValueError as erreur:
            return json.dumps({"error": "invalid_path", "message": str(erreur)})
        except sirenic.CreditCapExceeded as erreur:
            conseil = " Raise max_credits or call a cheaper endpoint." if erreur.credits is not None else ""
            return json.dumps(
                {
                    "payment_required": True,
                    "price_cap_exceeded": True,
                    "max_credits": float(erreur.max_credits),
                    "credits": None if erreur.credits is None else float(erreur.credits),
                    "hint": f"{erreur.message}{conseil}",
                    "quote": erreur.quote,
                }
            )
        except sirenic.PriceCapExceeded as erreur:
            return json.dumps(
                {
                    "payment_required": True,
                    "price_cap_exceeded": True,
                    "max_price_usd": float(erreur.max_price_usd),
                    "hint": "The quote is above max_price_usd: nothing was signed. Raise the cap or call a cheaper endpoint.",
                    "quote": erreur.quote,
                }
            )
        except sirenic.UnsupportedAsset as erreur:
            return json.dumps(
                {
                    "payment_required": True,
                    "unsupported_asset": True,
                    "assets": erreur.assets,
                    "hint": "No option of the quote is in USDC or EURC on Base, the assets this client pays: nothing was signed.",
                    "quote": erreur.quote,
                }
            )
        except sirenic.PaymentRequired as erreur:
            return json.dumps(
                {
                    "payment_required": True,
                    "hint": _INDICES[self.rail],
                    "quote": erreur.quote,
                }
            )
        except sirenic.PaymentFailed as erreur:
            return json.dumps({"error": "payment_failed", "status": erreur.status, "message": erreur.message})
        except sirenic.NetworkError as erreur:
            return json.dumps({"error": "network", "message": str(erreur)[:300]})
        except sirenic.SirenicError as erreur:
            return json.dumps({"error": "http_error", "status": erreur.status, "code": erreur.code, "body": erreur.body})
        if reponse.data is None:
            return json.dumps(
                {
                    "content_type": reponse.headers.get("content-type"),
                    "size_bytes": len(reponse.content),
                    "hint": "Binary response (for example a PDF): fetch it with the sirenic client to get the bytes.",
                }
            )
        return json.dumps(reponse.data)


def build_langchain_tools(client: SirenicClient) -> list:
    """LangChain tools (langchain-core >= 1). ``pip install sirenic-agents[langchain]``."""
    from langchain_core.tools import StructuredTool
    from pydantic import BaseModel, Field

    class Recherche(BaseModel):
        q: str = Field(description="Company name or 9-digit SIREN")

    class Siren(BaseModel):
        siren: str = Field(description="9-digit SIREN of the French company", pattern=r"^\d{9}$")

    class Criblage(BaseModel):
        name: str = Field(description="Person or company name to screen")
        birth_year: Optional[str] = Field(default=None, description="Optional birth year (YYYY)")

    class Chemin(BaseModel):
        path: str = Field(description="Sirenic path with query string, e.g. /v1/entreprise/552032534/lobbying")

    class Facturation(BaseModel):
        siren: str = Field(description="9-digit SIREN of the company you want to invoice")
        iban: Optional[str] = Field(default=None, description="Payee IBAN (optional): adds the bank check")

    class FacturationEu(BaseModel):
        pays: str = Field(description="BE (Belgium) or PL (Poland)")
        id: str = Field(description="Belgian enterprise number or Polish NIP (10 digits)")
        iban: Optional[str] = Field(default=None, description="Payee IBAN (optional): unlocks the Polish account check")

    class Watch(BaseModel):
        cibles: str = Field(description="Comma-separated targets: SIRENs and/or dirigeant:Name (1-100)")
        duree: Optional[int] = Field(
            default=None,
            description="Watch duration in days: 30, 90 or 365 (default 30). Sets the unit price per target: 30=$0.05, 90=$0.135, 365=$0.50",
        )
        webhook: Optional[str] = Field(default=None, description="Public https URL for signed event batches")
        email: Optional[str] = Field(default=None, description="E-mail for digests")

    def _watch(
        cibles: str,
        duree: Optional[int] = None,
        webhook: Optional[str] = None,
        email: Optional[str] = None,
    ) -> str:
        params = [("cibles", cibles)]
        if duree:
            params.append(("duree", str(duree)))
        if webhook:
            params.append(("webhook", webhook))
        if email:
            params.append(("email", email))
        return client.get("/v1/surveillance/creer?" + urlencode(params))

    def _facturation(siren: str, iban: Optional[str] = None) -> str:
        params = [("siren", siren)] + ([("iban", iban)] if iban else [])
        return client.get("/v1/facturation/dossier?" + urlencode(params))

    def _facturation_eu(pays: str, id: str, iban: Optional[str] = None) -> str:
        params = [("pays", pays), ("id", id)] + ([("iban", iban)] if iban else [])
        return client.get("/v1/eu/facturation/dossier?" + urlencode(params))

    def _criblage(name: str, birth_year: Optional[str] = None) -> str:
        params = [("name", name)] + ([("birth_year", birth_year)] if birth_year else [])
        return client.get("/v1/sanctions/check?" + urlencode(params))

    return [
        StructuredTool.from_function(
            func=lambda q: client.get("/v1/recherche?" + urlencode([("q", q)])),
            name="sirenic_search_companies",
            description="French company search and company lookup by name or SIREN in the official French company registry (INSEE/INPI, 30M companies), top 10 with confidence scores. Price: $0.002.",
            args_schema=Recherche,
        ),
        StructuredTool.from_function(
            func=lambda siren: client.get(f"/v1/entreprise/{siren}"),
            name="sirenic_company_profile",
            description="Full French company profile from the official company registry (legal form, head office, officers, VAT...). Price: $0.005.",
            args_schema=Siren,
        ),
        StructuredTool.from_function(
            func=lambda siren: client.get(f"/v1/kyb/{siren}"),
            name="sirenic_kyb_file",
            description="Complete KYB (Know Your Business) due-diligence file: identity, officers, legal alerts, financials, sanctions screening (6 lists). Price: $0.15.",
            args_schema=Siren,
        ),
        StructuredTool.from_function(
            func=_criblage,
            name="sirenic_screen_sanctions",
            description="AML sanctions screening: screen a name against 6 official sanctions lists (UN, EU, OFAC, UK, FR, SECO), scored matches. Price: $0.02.",
            args_schema=Criblage,
        ),
        StructuredTool.from_function(
            func=lambda siren: client.get(f"/v1/intelligence/{siren}"),
            name="sirenic_company_intelligence",
            description="Flagship due-diligence report: every block cross-referenced, closed-list signals, deterministic verdict, Ed25519-signed. Price: $1.00.",
            args_schema=Siren,
        ),
        StructuredTool.from_function(
            func=_watch,
            name="sirenic_create_watch",
            description="Create a 30, 90 or 365-day watchlist (daily checks, signed webhooks/e-mail, expiry warning at D-7). Targets: SIRENs and/or dirigeant:Name. Price per target AND per duration: $0.05 for 30 days, $0.135 for 90, $0.50 for a year. No pro-rata refund.",
            args_schema=Watch,
        ),
        StructuredTool.from_function(
            func=_facturation,
            name="sirenic_invoice_file_france",
            description="Can you invoice this French company? Legal identity, computed VAT number checked live against VIES, payee bank identified from the IBAN, and the date it falls under the French e-invoicing mandate (every French company must RECEIVE e-invoices from 1 Sept 2026). Deterministic pret_a_facturer verdict. Price: $0.03.",
            args_schema=Facturation,
        ),
        StructuredTool.from_function(
            func=_facturation_eu,
            name="sirenic_invoice_file_europe",
            description="Same check for BELGIUM (mandate live since 1 Jan 2026, adds Peppol reachability) or POLAND, where it also answers a question with legal weight: is this IBAN actually DECLARED by that taxpayer in the official White List? Paying above 15,000 PLN into an undeclared account costs the buyer the VAT deduction. Price: $0.03.",
            args_schema=FacturationEu,
        ),
        StructuredTool.from_function(
            func=lambda siren: client.get(f"/v1/entreprise/{siren}/agrements"),
            name="sirenic_company_licences",
            description="Is this French company actually authorised, and for what? Payment institution, e-money, account information, payment agent or exempt entity (EBA PSD2 register, daily), insurer (EIOPA), telecom operator (ARCEP): dates, licensed services, EEA passporting, withdrawals. Price: $0.02.",
            args_schema=Siren,
        ),
        StructuredTool.from_function(
            func=lambda path: client.get(path),
            name="sirenic_get",
            description="Call ANY other Sirenic endpoint by path (catalog and prices: https://api.sirenic.eu/llms.txt). Free sample: /preview/entreprise/55203253400646.",
            args_schema=Chemin,
        ),
    ]


def build_crewai_tools(client: SirenicClient) -> list:
    """CrewAI tools (crewai >= 1.15). ``pip install sirenic-agents[crewai]``.

    Tip: CrewAI also speaks MCP natively: ``Agent(..., mcps=["https://api.sirenic.eu/mcp"])``
    exposes every Sirenic MCP tool in one line (109 on 2026-10-05); these
    curated tools add the API key or the automatic x402 payment with a price cap.
    """
    from typing import Type

    from crewai.tools import BaseTool
    from pydantic import BaseModel, Field

    class Recherche(BaseModel):
        q: str = Field(description="Company name or 9-digit SIREN")

    class Siren(BaseModel):
        siren: str = Field(description="9-digit SIREN", pattern=r"^\d{9}$")

    class Chemin(BaseModel):
        path: str = Field(description="Sirenic path with query string")

    class OutilRecherche(BaseTool):
        name: str = "Sirenic company search"
        description: str = "Search 30M French companies by name or SIREN (official data), scored matches. Price: $0.002."
        args_schema: Type[BaseModel] = Recherche

        def _run(self, q: str) -> str:
            return client.get("/v1/recherche?" + urlencode([("q", q)]))

    class OutilKyb(BaseTool):
        name: str = "Sirenic KYB file"
        description: str = "Complete KYB file: identity, officers, legal alerts, financials, sanctions screening. Price: $0.15."
        args_schema: Type[BaseModel] = Siren

        def _run(self, siren: str) -> str:
            return client.get(f"/v1/kyb/{siren}")

    class OutilIntelligence(BaseTool):
        name: str = "Sirenic intelligence report"
        description: str = "Flagship due-diligence report with deterministic verdict, Ed25519-signed. Price: $1.00."
        args_schema: Type[BaseModel] = Siren

        def _run(self, siren: str) -> str:
            return client.get(f"/v1/intelligence/{siren}")

    class OutilGenerique(BaseTool):
        name: str = "Sirenic API call"
        description: str = "Call ANY Sirenic endpoint by path (catalog and prices: https://api.sirenic.eu/llms.txt)."
        args_schema: Type[BaseModel] = Chemin

        def _run(self, path: str) -> str:
            return client.get(path)

    return [OutilRecherche(), OutilKyb(), OutilIntelligence(), OutilGenerique()]
