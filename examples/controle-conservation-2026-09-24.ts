/**
 * Contrôle post-déploiement du ticket 100 (restes Jautiva, 24/09/2026) : conservation du cache
 * /capital et des transactions de dirigeants.
 *
 * Gratuit :
 *   1. /confidentialite et /en/privacy disent les durées réelles (cinq ans pour les notifications
 *      FSMA, 90 jours pour une extraction qui compte des associés personnes physiques) et ne
 *      promettent plus qu'un retrait par la FSMA est répercuté ;
 *   2. /openapi.json : description de /capital (90 jours) et du paramètre `depuis` (cinq ans) ;
 *   3. /healthz sert le commit attendu (argument 1, sha COURT de 7 caractères).
 * Payant, un seul appel (0,02 $) :
 *   4. /v1/eu/entreprise/BE/0428750985/transactions-dirigeants?depuis=2015-01-01 (IBA) : la fenêtre
 *      est bornée à cinq ans et le dit (periode.depuis_demande, periode.borne), bloc `partiel`.
 *      Rail clé d'API si SIRENIC_API_KEY est posée (contenu, règle du 24/09), sinon x402.
 *
 * La preuve du STOCKAGE sans nom ne passe pas par un achat : journal du job RGPD (06:30 UTC) et
 * dump de la nuit suivante, relus dans le ticket.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-conservation-2026-09-24.ts <sha7>
 */
import { mkdirSync, writeFileSync } from "node:fs";
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
const sansAchat = process.env.SANS_ACHAT === "1"; // contrôles gratuits seulement (valider le harnais)
const cle = process.env.SIRENIC_API_KEY;
const wallet = process.env.TEST_WALLET_KEY;
if (!sansAchat && !cle && !wallet?.startsWith("0x")) {
  console.error("ni SIRENIC_API_KEY ni TEST_WALLET_KEY : rien pour payer l'appel 4");
  process.exit(2);
}

const dossier = join("resultats", `controle-conservation-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(dossier, { recursive: true });
const ecrire = (nom: string, contenu: string): void => writeFileSync(join(dossier, nom), contenu);

interface Constat { nom: string; ok: boolean; details: string }
const constats: Constat[] = [];
const constater = (nom: string, defaut: string | null): void => {
  constats.push({ nom, ok: defaut === null, details: defaut ?? "conforme" });
  console.log(`${defaut === null ? "✓" : "✗"} ${nom} — ${defaut ?? "conforme"}`);
};
const texte = async (chemin: string): Promise<{ statut: number; corps: string }> => {
  const r = await fetch(`${BASE}${chemin}`, { signal: AbortSignal.timeout(60_000) });
  const corps = await r.text();
  ecrire(`${chemin.replace(/[^a-z0-9]+/gi, "_")}.txt`, corps);
  return { statut: r.status, corps };
};

// 3. Commit servi.
const sante = JSON.parse((await texte("/healthz")).corps) as { commit?: string };
constater("healthz", sante.commit === attendu ? null : `commit servi ${sante.commit}, attendu ${attendu}`);

// 1. Notice FR et EN.
const fr = await texte("/confidentialite");
constater(
  "notice FR",
  fr.statut !== 200
    ? `HTTP ${fr.statut}`
    : fr.corps.includes("un retrait opéré par la FSMA est répercuté")
      ? "promet encore la répercussion des retraits FSMA"
      : !fr.corps.includes("cinq ans au plus après sa publication")
        ? "durée de cinq ans absente"
        : !fr.corps.includes("effacée au bout de 90 jours")
          ? "durée de 90 jours absente"
          : null,
);
const en = await texte("/en/privacy");
constater(
  "notice EN",
  en.statut !== 200
    ? `HTTP ${en.statut}`
    : en.corps.includes("a removal by the FSMA is reflected")
      ? "still promises FSMA removals are reflected"
      : !en.corps.includes("five years at most after its publication")
        ? "five-year retention missing"
        : !en.corps.includes("deleted after 90 days")
          ? "90-day retention missing"
          : null,
);

// 2. OpenAPI.
const spec = JSON.parse((await texte("/openapi.json")).corps) as {
  paths: Record<string, { get?: { description?: string; parameters?: Array<{ name: string; description?: string }> } }>;
};
const capital = spec.paths["/v1/entreprise/{siren}/capital"]?.get?.description ?? "";
constater("openapi /capital", capital.includes("90 days at most when natural persons are counted") ? null : "description sans la conservation de 90 jours");
const depuis = spec.paths["/v1/eu/entreprise/{pays}/{id}/transactions-dirigeants"]?.get?.parameters?.find((p) => p.name === "depuis")?.description ?? "";
constater("openapi depuis", depuis.includes("Never earlier than five years back") ? null : "paramètre depuis sans la borne de cinq ans");

// 4. Un appel payant : la fenêtre bornée et dite.
if (sansAchat) {
  console.log("– appel 4 non joué (SANS_ACHAT=1)");
  ecrire("recap.json", JSON.stringify({ campagne: "controle-conservation-2026-09-24", base: BASE, commit_attendu: attendu, sans_achat: true, constats }, null, 2));
  console.log(`\n${constats.filter((c) => c.ok).length}/${constats.length} conformes (sans achat) — dossier ${dossier}`);
  process.exit(constats.every((c) => c.ok) ? 0 : 1);
}
const chemin = "/v1/eu/entreprise/BE/0428750985/transactions-dirigeants?depuis=2015-01-01";
let reponse: Response;
if (cle) {
  reponse = await fetch(`${BASE}${chemin}`, { headers: { "X-Api-Key": cle }, signal: AbortSignal.timeout(60_000) });
} else {
  const compte = privateKeyToAccount(wallet as `0x${string}`);
  const client = new x402Client((_v, reqs) => {
    const usdc = reqs.find((r) => r.asset.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    if (!usdc) throw new Error("pas d'option USDC dans le devis");
    if (Number(usdc.amount) / 1e6 > 0.03) throw new Error("devis au-dessus de 0,03 $ : refus");
    return usdc;
  });
  registerExactEvmScheme(client, { signer: compte });
  reponse = await wrapFetchWithPayment(fetch, client)(`${BASE}${chemin}`, { signal: AbortSignal.timeout(60_000) });
}
const brut = await reponse.text();
ecrire("4-transactions-iba-depuis-2015-corps.json", brut);
ecrire("4-transactions-iba-depuis-2015-trace.json", JSON.stringify({ chemin, statut: reponse.status, rail: cle ? "cle" : "x402", credits: reponse.headers.get("x-credits-charged") }, null, 2));
let corps: {
  periode?: { depuis?: string; depuis_demande?: string; borne?: string };
  provenance?: Array<{ bloc?: string; etat?: string }>;
  disclaimer?: string;
} = {};
try { corps = JSON.parse(brut); } catch { /* non JSON */ }
const limite = new Date();
limite.setUTCMonth(limite.getUTCMonth() - 60);
constater(
  "transactions IBA depuis 2015",
  reponse.status !== 200
    ? `HTTP ${reponse.status}`
    : corps.periode?.depuis !== limite.toISOString().slice(0, 10)
      ? `periode.depuis ${corps.periode?.depuis}, attendu ${limite.toISOString().slice(0, 10)}`
      : corps.periode?.depuis_demande !== "2015-01-01" || corps.periode?.borne !== "conservation_cinq_ans"
        ? "borne non dite (depuis_demande ou borne absents)"
        : corps.provenance?.find((p) => p.bloc === "transactions_dirigeants")?.etat !== "partiel"
          ? `bloc ${corps.provenance?.find((p) => p.bloc === "transactions_dirigeants")?.etat}, attendu partiel`
          : !corps.disclaimer?.includes("cinq ans")
            ? "disclaimer sans la conservation"
            : /jeton|declarant_jeton/.test(brut)
              ? "jeton de déclarant servi"
              : null,
);

ecrire("recap.json", JSON.stringify({ campagne: "controle-conservation-2026-09-24", base: BASE, commit_attendu: attendu, constats }, null, 2));
ecrire("RECAP.md", ["# Contrôle conservation (ticket 100) — 24/09/2026", "", "| Constat | Verdict |", "|---|---|", ...constats.map((c) => `| ${c.nom} | ${c.ok ? "✓" : "✗"} ${c.details} |`), ""].join("\n"));
console.log(`\n${constats.filter((c) => c.ok).length}/${constats.length} conformes — dossier ${dossier}`);
process.exit(constats.every((c) => c.ok) ? 0 : 1);
