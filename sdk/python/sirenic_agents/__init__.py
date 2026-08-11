"""Sirenic for Python agents (LangChain, CrewAI).

Official French & European company data, paid per call via x402 (USDC or
EURC on Base). No account, no API key: bring a wallet key and a price cap.
Without a wallet the client still works and returns the x402 quote (handy
for discovery and dry runs). The server never sees your key: payments are
EIP-3009 authorizations signed locally (official ``x402`` package).
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

import requests
from urllib.parse import urlencode

__all__ = ["SirenicClient", "build_langchain_tools", "build_crewai_tools"]

_USDC_DECIMALS = 6
_CHEMIN_AUTORISE = re.compile(r"^/(v1|preview)/")


class SirenicClient:
    """Paying HTTP client for api.sirenic.eu.

    :param wallet_key: EVM private key (``0x...``) of YOUR paying wallet.
        Omit for quote-only mode (every call returns the x402 quote).
    :param max_price_usd: hard per-call cap (default 1.0 — the most
        expensive Sirenic call). Quotes above the cap are never signed.
    :param base_url: default ``https://api.sirenic.eu``.
    """

    def __init__(
        self,
        wallet_key: Optional[str] = None,
        max_price_usd: float = 1.0,
        base_url: str = "https://api.sirenic.eu",
    ) -> None:
        self.base_url = base_url.rstrip("/")
        if wallet_key:
            # Official x402 Foundation client: 402 -> select <= cap -> sign
            # EIP-3009 -> retry, all automatic. Import here so quote-only
            # users do not need the payment extras.
            from eth_account import Account
            from x402 import max_amount, x402ClientSync
            from x402.http.clients.requests import x402_requests
            from x402.mechanisms.evm import EthAccountSigner
            from x402.mechanisms.evm.exact import ExactEvmScheme

            client = x402ClientSync()
            client.register("eip155:*", ExactEvmScheme(signer=EthAccountSigner(Account.from_key(wallet_key))))
            client.register_policy(max_amount(int(round(max_price_usd * 10**_USDC_DECIMALS))))
            self._session: requests.Session = x402_requests(client)
        else:
            self._session = requests.Session()

    def get(self, path: str) -> str:
        """GET a Sirenic path (e.g. ``/v1/recherche?q=danone``), paying if
        needed. Always returns a JSON string (data, quote, or error)."""
        if not _CHEMIN_AUTORISE.match(path):
            return json.dumps({"error": "invalid_path", "message": "Only /v1/... and /preview/... paths are served."})
        try:
            reponse = self._session.get(
                f"{self.base_url}{path}", headers={"Accept": "application/json"}, timeout=120
            )
        except Exception as erreur:  # panne réseau OU refus de plafond
            return json.dumps(
                {
                    "error": "payment_refused_or_network",
                    "message": str(erreur)[:300],
                    "hint": "If this is a price-cap refusal, raise max_price_usd or call a cheaper endpoint.",
                }
            )
        try:
            corps: Any = reponse.json()
        except ValueError:
            corps = {}
        if reponse.status_code == 402:
            return json.dumps(
                {
                    "payment_required": True,
                    "hint": "No wallet configured (or quote above your price cap). Provide wallet_key to pay automatically.",
                    "quote": corps,
                }
            )
        if not reponse.ok:
            return json.dumps({"error": "http_error", "status": reponse.status_code, "body": corps})
        return json.dumps(corps)


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
        iban: Optional[str] = Field(default=None, description="Payee IBAN — optional, adds the bank check")

    class FacturationEu(BaseModel):
        pays: str = Field(description="BE (Belgium) or PL (Poland)")
        id: str = Field(description="Belgian enterprise number or Polish NIP (10 digits)")
        iban: Optional[str] = Field(default=None, description="Payee IBAN — unlocks the Polish account check")

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
            description="French company search and company lookup by name or SIREN in the official French company registry (INSEE/INPI, 30M companies), top 10 with confidence scores. Price: $0.001.",
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
            description="Same check for BELGIUM (mandate live since 1 Jan 2026, adds Peppol reachability) or POLAND — where it also answers a question with legal weight: is this IBAN actually DECLARED by that taxpayer in the official White List? Paying above 15,000 PLN into an undeclared account costs the buyer the VAT deduction. Price: $0.03.",
            args_schema=FacturationEu,
        ),
        StructuredTool.from_function(
            func=lambda siren: client.get(f"/v1/entreprise/{siren}/agrements"),
            name="sirenic_company_licences",
            description="Is this French company actually authorised, and for what? Payment institution, e-money, account information, payment agent or exempt entity (EBA PSD2 register, daily), insurer (EIOPA), telecom operator (ARCEP) — dates, licensed services, EEA passporting, withdrawals. Price: $0.02.",
            args_schema=Siren,
        ),
        StructuredTool.from_function(
            func=lambda path: client.get(path),
            name="sirenic_get",
            description="Call ANY other Sirenic endpoint by path — catalog and prices: https://api.sirenic.eu/llms.txt. Free sample: /preview/entreprise/55203253400646.",
            args_schema=Chemin,
        ),
    ]


def build_crewai_tools(client: SirenicClient) -> list:
    """CrewAI tools (crewai >= 1.15). ``pip install sirenic-agents[crewai]``.

    Tip: CrewAI also speaks MCP natively — ``Agent(..., mcps=["https://api.sirenic.eu/mcp"])``
    exposes all 38 Sirenic tools in one line; these curated tools add the
    automatic x402 payment with a price cap.
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
        description: str = "Search 30M French companies by name or SIREN (official data), scored matches. Price: $0.001."
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
        description: str = "Call ANY Sirenic endpoint by path — catalog and prices: https://api.sirenic.eu/llms.txt."
        args_schema: Type[BaseModel] = Chemin

        def _run(self, path: str) -> str:
            return client.get(path)

    return [OutilRecherche(), OutilKyb(), OutilIntelligence(), OutilGenerique()]
