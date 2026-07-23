/**
 * LangChain.js tools for Sirenic — official French & European company data,
 * paid per call via x402 (USDC/EURC on Base). Each tool pays automatically
 * with your wallet (hard price cap) or, without a wallet, returns the quote.
 *
 * Prices are stated in each description so the agent can budget.
 */
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { Sirenic, type SirenicOptions } from "./client.js";

const SIREN = z.string().regex(/^\d{9}$/).describe("9-digit SIREN of the French company");

/** Build the Sirenic tool belt for a LangChain.js agent. */
export function sirenicTools(options: SirenicOptions = {}) {
  const client = new Sirenic(options);

  return [
    tool(
      async ({ q }) => client.get(`/v1/recherche?q=${encodeURIComponent(q)}`),
      {
        name: "sirenic_search_companies",
        description:
          "Search 30M French companies by name or SIREN (official INSEE/INPI data). Top 10 matches with a 0-1 confidence score. Price: $0.001.",
        schema: z.object({ q: z.string().min(1).max(100).describe("Company name or SIREN") }),
      },
    ),
    tool(
      async ({ siren, geo }) =>
        client.get(`/v1/entreprise/${encodeURIComponent(siren)}${geo ? "?geo=true" : ""}`),
      {
        name: "sirenic_company_profile",
        description:
          "Full official profile of a French company: legal form, head office, NAF, workforce, officers, VAT number, Egapro index, RGE certifications. Price: $0.005.",
        schema: z.object({ siren: SIREN, geo: z.boolean().optional().describe("Include GPS coordinates") }),
      },
    ),
    tool(
      async ({ siren }) => client.get(`/v1/kyb/${encodeURIComponent(siren)}`),
      {
        name: "sirenic_kyb_file",
        description:
          "Complete KYB file in one call: identity, officers, BODACC legal alerts, filed financials, sanctions screening of the company and each officer (6 official lists), completeness score. Price: $0.15.",
        schema: z.object({ siren: SIREN }),
      },
    ),
    tool(
      async ({ name, birth_year }) => {
        const query = new URLSearchParams({ name });
        if (birth_year) query.set("birth_year", birth_year);
        return client.get(`/v1/sanctions/check?${query.toString()}`);
      },
      {
        name: "sirenic_screen_sanctions",
        description:
          "Screen a person or company name against 6 official sanctions lists (UN, EU, OFAC, UK, FR, Swiss SECO). Scored fuzzy matches, never a bare yes/no. Price: $0.02.",
        schema: z.object({
          name: z.string().min(2).max(100).describe("Person or company name"),
          birth_year: z.string().regex(/^\d{4}$/).optional().describe("Optional birth year (YYYY)"),
        }),
      },
    ),
    tool(
      async ({ nom, siren }) => {
        const query = new URLSearchParams();
        if (nom) query.set("nom", nom);
        if (siren) query.set("siren", siren);
        return client.get(`/v1/regulateurs/fr/alertes?${query.toString()}`);
      },
      {
        name: "sirenic_amf_alerts",
        description:
          "French regulator (AMF) check: blacklists (scams, unauthorized sites, AMF impersonation) plus PSAN crypto-provider and SGP asset-manager registers, by name or SIREN. Price: $0.01.",
        schema: z.object({
          nom: z.string().min(2).max(100).optional().describe("Name to screen"),
          siren: SIREN.optional(),
        }),
      },
    ),
    tool(
      async ({ q, pays }) => {
        const query = new URLSearchParams({ q });
        if (pays) query.set("pays", pays);
        return client.get(`/v1/eu/agrements?${query.toString()}`);
      },
      {
        name: "sirenic_eu_financial_authorisations",
        description:
          "Is this financial firm regulated in the EU? Search ESMA Registers (~14,000 MiFID entities, all EU/EEA) by name or LEI: status, competent authority, home/host states. Price: $0.01.",
        schema: z.object({
          q: z.string().min(1).max(100).describe("Entity name or 20-char LEI"),
          pays: z.string().regex(/^[A-Za-z]{2}$/).optional().describe("ISO-3166 alpha-2 home state filter"),
        }),
      },
    ),
    tool(
      async ({ siren }) => client.get(`/v1/intelligence/${encodeURIComponent(siren)}`),
      {
        name: "sirenic_company_intelligence",
        description:
          "Flagship due-diligence report: every Sirenic block cross-referenced (financial trend, sector position, failure-risk score, sanctions, Seveso industrial risk, lobbying, EU procurement, VIES) with closed-list signals and a deterministic verdict (solide/correct/fragile/critique). Ed25519-signed. Price: $1.00.",
        schema: z.object({ siren: SIREN }),
      },
    ),
    tool(
      async ({ cibles, webhook, email }) => {
        const query = new URLSearchParams({ cibles });
        if (webhook) query.set("webhook", webhook);
        if (email) query.set("email", email);
        return client.get(`/v1/surveillance/creer?${query.toString()}`);
      },
      {
        name: "sirenic_create_watch",
        description:
          "Create a 30-day watchlist: Sirenic checks each target DAILY (filings, status, officers, sanctions, AMF, Seveso, procurement) and pushes events via Ed25519-signed webhook and/or e-mail; always pollable with the returned token. Targets: SIRENs and/or `dirigeant:Name`. Price: $0.05 per target per 30 days.",
        schema: z.object({
          cibles: z.string().min(2).describe("Comma-separated targets: SIRENs and/or dirigeant:Name (1-100)"),
          webhook: z.string().url().optional().describe("Public https URL for signed event batches"),
          email: z.string().optional().describe("E-mail for digests"),
        }),
      },
    ),
    tool(
      async ({ path }) => client.get(path),
      {
        name: "sirenic_get",
        description:
          "Call ANY other Sirenic endpoint by path (catalog and prices: https://api.sirenic.eu/llms.txt — e.g. /v1/entreprise/{siren}/risques-industriels $0.01 Seveso, /v1/entreprise/{siren}/lobbying $0.01, /v1/score/defaillance/{siren} $0.10, /v1/entreprise/{siren}/marches-publics-ue $0.02, /v1/tva/verifier/{n} $0.003). Free sample: /preview/entreprise/55203253400646.",
        schema: z.object({ path: z.string().regex(/^\/(v1|preview)\//).describe("Sirenic path with query string") }),
      },
    ),
  ];
}
