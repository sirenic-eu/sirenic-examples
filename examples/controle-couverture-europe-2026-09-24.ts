/**
 * Contrôle post-déploiement du ticket 180 (couverture européenne écrite à la main, 24/09/2026).
 *
 * Gratuit :
 *   1. /healthz sert le commit attendu (argument 1, sha COURT de 7 caractères) ;
 *   2. les surfaces d'agent nomment les quinze registres des fiches nationales, rangés comme l'API les sert
 *      (copies locales BE CY EE HR IE LT LV NO RO SE, en direct CH CZ FI PL SK) : OpenAPI (info, `pays` de la
 *      fiche et de la recherche), llms.txt (en-tête et lignes de la grille), carte A2A, outils MCP (`tools/list`),
 *      devis 402 de la recherche (description de la ressource et contrat d'entrée lus par le Bazaar) ;
 *   3. la page européenne date chaque ligne de son tableau (HR, IE, LT, CY, RO au 24/09, CH en direct, ES et
 *      PT sous le tableau, pied aux deux dates), la fiche irlandaise cite sa ligne et un pied au 24/09.
 * Payant, trois appels (0,023 $, x402, ou clé d'API si SIRENIC_API_KEY est posée), listés au ticket avant achat :
 *   4. /v1/eu/entreprise/HR/92803032010 (KOESTLIN, 0,01 $) : le bloc `fiche` de `provenance[]` vient du Sudski
 *      registar, plus de GLEIF ; la mention `source` nomme le Sudski registar ;
 *   5. /v1/eu/recherche?q=KOESTLIN&pays=HR (0,003 $) : les résultats croates ont leur bloc de provenance (aucun
 *      avant) ; règle aussi la ressource, donc rafraîchit sa carte au Bazaar (dernière indexation le 09/09) ;
 *   6. /v1/eu/entreprise/GB/00000006 (0,01 $, route générique) : `source` nouvelle ; rafraîchit la carte de la
 *      fiche générique au Bazaar (dernière indexation le 05/09, « Live: Norway… »).
 * Ni la fiche générique ni la recherche n'étaient réindexées depuis : une carte ne change qu'au règlement suivant.
 *
 * Harnais validé d'abord sans achat : SANS_ACHAT=1 rejoue le contrôle 4 sur un corps enregistré
 * (CORPS_ENREGISTRE=<fichier>, par exemple une fiche croate payée avant le correctif), qui doit rougir ;
 * les contrôles 5 et 6 ne se jouent qu'en achat.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-couverture-europe-2026-09-24.ts <sha7>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const BASE = process.env.SIRENIC_BASE ?? "https://api.sirenic.eu";
const attendu = process.argv[2] ?? "";
if (!/^[0-9a-f]{7}$/.test(attendu)) {
  console.error("usage : <sha court de 7 caractères servi par /healthz>");
  process.exit(2);
}
const sansAchat = process.env.SANS_ACHAT === "1";
const corpsEnregistre = process.env.CORPS_ENREGISTRE;
const cle = process.env.SIRENIC_API_KEY;
const wallet = process.env.TEST_WALLET_KEY;
if (!sansAchat && !cle && !wallet?.startsWith("0x")) {
  console.error("ni SIRENIC_API_KEY ni TEST_WALLET_KEY : rien pour payer l'appel 4");
  process.exit(2);
}

const dossier = join("resultats", `controle-couverture-europe-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(dossier, { recursive: true });
const ecrire = (nom: string, contenu: string): void => writeFileSync(join(dossier, nom), contenu);

interface Constat { nom: string; ok: boolean; details: string }
const constats: Constat[] = [];
const constater = (nom: string, defaut: string | null): void => {
  constats.push({ nom, ok: defaut === null, details: defaut ?? "conforme" });
  console.log(`${defaut === null ? "✓" : "✗"} ${nom} : ${defaut ?? "conforme"}`);
};
const texte = async (chemin: string): Promise<{ statut: number; corps: string; entetes: Headers }> => {
  const r = await fetch(`${BASE}${chemin}`, { signal: AbortSignal.timeout(60_000) });
  const corps = await r.text();
  ecrire(`${chemin.replace(/[^a-z0-9]+/gi, "_").slice(0, 80)}.txt`, corps);
  return { statut: r.status, corps, entetes: r.headers };
};
/** Le texte tel qu'un lecteur le lit : balises retirées, espaces insécables et blancs réduits. */
const lisible = (t: string): string =>
  t.replace(/<[^>]+>/g, " ").replaceAll("&#39;", "'").replaceAll("\u202f", " ").replaceAll("\u00a0", " ").replace(/\s+/g, " ");
const exige = (corps: string, attendus: readonly string[]): string | null => {
  const manquants = attendus.filter((a) => !corps.includes(a));
  return manquants.length === 0 ? null : `absent : « ${manquants[0]} »${manquants.length > 1 ? ` (+${manquants.length - 1})` : ""}`;
};

const LOCALES_EN = "Belgium, Croatia, Cyprus, Estonia, Ireland, Latvia, Lithuania, Norway, Romania, Sweden";
const LOCALES = "BE, CY, EE, HR, IE, LT, LV, NO, RO, SE";
const DIRECT = "CH, CZ, FI, PL, SK";
const TOUTES = "BE, CH, CY, CZ, EE, FI, HR, IE, LT, LV, NO, PL, RO, SE, SK";

// 1. Commit servi.
const sante = JSON.parse((await texte("/healthz")).corps) as { commit?: string };
constater("healthz", sante.commit === attendu ? null : `commit servi ${sante.commit}, attendu ${attendu}`);

// 2. Surfaces d'agent.
const spec = JSON.parse((await texte("/openapi.json")).corps) as {
  info: { description: string };
  paths: Record<string, { get?: { parameters?: Array<{ name: string; description?: string }> } }>;
};
const parametre = (chemin: string, nom: string): string =>
  spec.paths[chemin]?.get?.parameters?.find((p) => p.name === nom)?.description ?? "";
constater("openapi info", exige(spec.info.description, [`from national registers (${TOUTES}; DK and GB when enabled)`]));
constater("openapi pays de la fiche", exige(parametre("/v1/eu/entreprise/{pays}/{id}", "pays"), [`local copies: ${LOCALES}; live: ${DIRECT};`]));
constater(
  "openapi pays de la recherche",
  exige(parametre("/v1/eu/recherche", "pays"), [`every local copy is searched (${LOCALES}, and ES from the BORME)`, "the live registers (CH, CZ, FI, SK) are only queried with it; PL goes through GLEIF"]),
);
const llms = (await texte("/llms.txt")).corps;
constater(
  "llms.txt",
  exige(llms, [
    "search & profiles from national registers (Belgium, Croatia, Cyprus, Czechia, Estonia, Finland, Ireland, Latvia, Lithuania, Norway, Poland, Romania, Slovakia, Sweden, Switzerland;",
    `National registers from local copies: Belgium (KBO, NACEBEL + establishments), Croatia, Cyprus, Estonia, Ireland, Latvia, Lithuania, Norway, Romania, Sweden; live: Czechia, Finland, Poland, Slovakia, Switzerland;`,
    `Local copies, all searched when pays is absent: ${LOCALES_EN}, Spain (BORME base, hoja key); live, only with pays set: Czechia, Finland, Slovakia, Switzerland; Poland through GLEIF`,
  ]) ?? (llms.includes("Live: Norway") ? "ancienne description de la fiche encore servie" : null),
);
const carte = JSON.parse((await texte("/.well-known/agent-card.json")).corps) as { description?: string };
constater("carte A2A", exige(carte.description ?? "", [`the national company registers of ${TOUTES}, plus worldwide`]));
const mcp = await fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  signal: AbortSignal.timeout(60_000),
});
const brutMcp = await mcp.text();
ecrire("mcp-tools-list.txt", brutMcp);
const outils = new Map(
  ((JSON.parse(/data: (\{.*\})/.exec(brutMcp)?.[1] ?? brutMcp) as { result: { tools: Array<{ name: string; description: string }> } }).result.tools).map((t) => [t.name, t.description]),
);
constater(
  "MCP search_european_companies",
  exige(outils.get("search_european_companies") ?? "", [`Local copies, all searched when pays is absent: ${LOCALES_EN}, Spain (BORME base, hoja key); live, only with pays set: Czechia, Finland, Slovakia, Switzerland; Poland through GLEIF`]),
);
constater(
  "MCP get_european_company_profile",
  exige(outils.get("get_european_company_profile") ?? "", [`National registers from local copies: ${LOCALES_EN}; live: Czechia, Finland, Poland, Slovakia, Switzerland;`]),
);
const devis = await texte("/v1/eu/recherche?q=controle");
const enTete = devis.entetes.get("payment-required");
const devisLu = enTete ? Buffer.from(enTete, "base64").toString("utf8") : "";
ecrire("devis-recherche.json", devisLu);
constater(
  "devis 402 de la recherche (Bazaar)",
  devis.statut !== 402
    ? `HTTP ${devis.statut}, 402 attendu`
    : exige(devisLu, ["Local copies, all searched when pays is absent: Belgium, Croatia", `every local copy is searched (${LOCALES}, and ES from the BORME)`]),
);

// 3. Pages.
const europeFr = lisible((await texte("/cas-usage/donnees-entreprises-europeennes-registres-officiels-schema")).corps);
constater(
  "page européenne FR",
  exige(europeFr, [
    "Croatie (HR) Sudski registar 186 131 2 229 846 24/09/2026",
    "Irlande (IE) Companies Registration Office (CRO) 824 918 — 24/09/2026",
    "Lituanie (LT) Juridinių asmenų registras (Registrų centras) 547 382 8 080 102 24/09/2026",
    "Suisse (CH) Zefix — — en direct",
    "et donc sans ligne ici : Espagne, Portugal",
    "mesurés en base les 19/08/2026 et 24/09/2026, selon le pays",
  ]),
);
const europeEn = lisible((await texte("/en/use-cases/european-company-data-official-registers-one-schema")).corps);
constater(
  "page européenne EN",
  exige(europeEn, ["HR Sudski registar 186,131 2,229,846 2026-09-24", "hence no row here: Portugal, Spain", "measured in our database on 2026-08-19 and 2026-09-24, depending on the country"]),
);
const irlande = await texte("/api/fiche-societe-irlandaise-registre-cro");
const irlandeLue = lisible(irlande.corps);
constater(
  "fiche irlandaise FR",
  irlande.statut !== 200
    ? `HTTP ${irlande.statut}`
    : (exige(irlandeLue, ["824 918 sociétés inscrites et radiées dans notre copie le 24/09/2026", "mesurés en base le 24/09/2026."]) ??
      (irlandeLue.includes("mesurés en base le 19/08/2026") ? "pied encore daté du 19/08" : null)),
);

// 4 à 6. Appels payants : un seul payeur, plafonné à 0,02 $ par appel.
let payer: ((chemin: string) => Promise<Response>) | null = null;
if (!sansAchat && cle) {
  payer = (chemin) => fetch(`${BASE}${chemin}`, { headers: { "X-Api-Key": cle }, signal: AbortSignal.timeout(60_000) });
} else if (!sansAchat) {
  const compte = privateKeyToAccount(wallet as `0x${string}`);
  const client = new x402Client((_v, reqs) => {
    const usdc = reqs.find((r) => r.asset.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    if (!usdc) throw new Error("pas d'option USDC dans le devis");
    if (Number(usdc.amount) / 1e6 > 0.02) throw new Error("devis au-dessus de 0,02 $ : refus");
    return usdc;
  });
  registerExactEvmScheme(client, { signer: compte });
  const paye = wrapFetchWithPayment(fetch, client);
  payer = (chemin) => paye(`${BASE}${chemin}`, { signal: AbortSignal.timeout(60_000) });
}
const rail = sansAchat ? "enregistre" : cle ? "cle" : "x402";
/** Un appel payant (ou le corps enregistré en mode sans achat), écrit dans le dossier, rendu en JSON. */
const appeler = async (nom: string, chemin: string, enregistre?: string): Promise<{ statut: number; corps: Record<string, unknown> } | null> => {
  let statut: number;
  let brut: string;
  if (payer) {
    const r = await payer(chemin);
    statut = r.status;
    brut = await r.text();
  } else if (enregistre) {
    statut = 200;
    brut = readFileSync(enregistre, "utf8");
  } else {
    console.log(`– ${nom} non joué (sans achat)`);
    return null;
  }
  ecrire(`${nom}-corps.json`, brut);
  ecrire(`${nom}-trace.json`, JSON.stringify({ chemin, statut, rail }, null, 2));
  let corps: Record<string, unknown> = {};
  try { corps = JSON.parse(brut) as Record<string, unknown>; } catch { /* non JSON */ }
  return { statut, corps };
};
type Provenance = Array<{ bloc?: string; registre?: string; licence?: string; nombre?: number | null }>;

// 4. La fiche croate : provenance et mention de source.
const fiche = await appeler("4-koestlin-fiche-hr", "/v1/eu/entreprise/HR/92803032010", corpsEnregistre);
if (fiche) {
  const c = fiche.corps as { pays?: string; registre?: string; source?: string; provenance?: Provenance };
  const bloc = c.provenance?.find((p) => p.bloc === "fiche");
  constater(
    "fiche croate KOESTLIN : provenance et source",
    fiche.statut !== 200
      ? `HTTP ${fiche.statut}`
      : c.pays !== "HR" || !c.registre?.startsWith("Sudski registar")
        ? "pas la fiche croate attendue"
        : !bloc?.registre?.startsWith("Sudski registar")
          ? `bloc fiche de provenance : « ${bloc?.registre ?? "absent"} » (${bloc?.licence ?? "?"}), Sudski registar attendu`
          : !c.source?.includes("Sudski registar (HR,")
            ? "mention source sans le Sudski registar"
            : null,
  );
}

// 5. La recherche croate : les résultats croates ont leur provenance (la carte Bazaar de la recherche se rafraîchit).
const recherche = await appeler("5-recherche-koestlin-hr", "/v1/eu/recherche?q=KOESTLIN&pays=HR");
if (recherche) {
  const c = recherche.corps as { resultats?: Array<{ pays?: string }>; source?: string; provenance?: Provenance };
  const croates = (c.resultats ?? []).filter((r) => r.pays === "HR").length;
  const bloc = c.provenance?.find((p) => p.bloc === "resultats" && p.registre?.startsWith("Sudski registar"));
  constater(
    "recherche KOESTLIN (HR) : provenance des résultats croates",
    recherche.statut !== 200
      ? `HTTP ${recherche.statut}`
      : croates === 0
        ? "aucun résultat croate"
        : !bloc
          ? "aucun bloc de provenance au Sudski registar"
          : !c.source?.includes("Sudski registar (HR,")
            ? "mention source sans le Sudski registar"
            : null,
  );
}

// 6. La fiche générique (GB, Companies House) : mention de source nouvelle (la carte Bazaar de la fiche générique se rafraîchit).
const generique = await appeler("6-fiche-generique-gb", "/v1/eu/entreprise/GB/00000006");
if (generique) {
  const c = generique.corps as { pays?: string; source?: string };
  constater(
    "fiche générique GB 00000006 : mention de source",
    generique.statut !== 200
      ? `HTTP ${generique.statut}`
      : c.pays !== "GB"
        ? "pas la fiche britannique attendue"
        : !["(GB, OGL)", "Sudski registar (HR,", "ONRC Registrul Comerțului (RO,", "BORME (ES)"].every((m) => c.source?.includes(m))
          ? "mention source incomplète"
          : null,
  );
}

ecrire("recap.json", JSON.stringify({ campagne: "controle-couverture-europe-2026-09-24", base: BASE, commit_attendu: attendu, sans_achat: sansAchat, constats }, null, 2));
ecrire("RECAP.md", ["# Contrôle couverture européenne (ticket 180) : 24/09/2026", "", "| Constat | Verdict |", "|---|---|", ...constats.map((c) => `| ${c.nom} | ${c.ok ? "✓" : "✗"} ${c.details} |`), ""].join("\n"));
console.log(`\n${constats.filter((c) => c.ok).length}/${constats.length} conformes${sansAchat ? " (sans achat)" : ""} : dossier ${dossier}`);
process.exit(constats.every((c) => c.ok) ? 0 : 1);
