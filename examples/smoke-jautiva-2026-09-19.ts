/**
 * Smoke post-déploiement — arrêt CJUE C-798/24 Jautiva appliqué le 19/09/2026
 * (docs/ETAPE-0-JAUTIVA-ACCES-ANONYME.md du dépôt principal).
 *
 * BUT : prouver sur la PROD, après déploiement, que
 *   1. la route lettone des bénéficiaires effectifs répond 410 route_fermee SANS devis (gratuit) ;
 *   2. un acte de /v1/documents demandé sans compte répond 401 compte_requis SANS devis (gratuit) ;
 *   3. la route PSC britannique (Gymshark 08130873, 0,02 $) ne sert plus que des personnes MORALES
 *      et COMPTE les personnes physiques (deux fondateurs cessés) — aucun nom d'individu dans le corps ;
 *   4. /capital (AIRVANCE GROUP 490586708, 0,35 $, cas de calibrage connu de CDU) sort du cache
 *      ANONYMISÉ : associés personnes physiques comptés, jamais nommés, personnes morales nommées.
 * COÛT ESTIMÉ : 0,37 $ (2 appels payés ; les deux refus sont gratuits par construction).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-jautiva-2026-09-19.ts
 *
 * Conservation (règle CDU du 24/07, étendue le 11/08) : un fichier par appel + recap.json + RECAP.md
 * sous resultats/smoke-jautiva-<horodatage>/, puis rsync vers sirenic-resultats/smokes/ et commit.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const BASE = process.env.SIRENIC_BASE ?? "https://api.sirenic.eu";
const key = process.env.TEST_WALLET_KEY;
if (!key?.startsWith("0x")) {
  console.error("TEST_WALLET_KEY absente (node --env-file=.env.wallet-test …)");
  process.exit(2);
}
const account = privateKeyToAccount(key as `0x${string}`);
console.log(`payeur : ${account.address}`);

const dossier = join("resultats", `smoke-jautiva-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(dossier, { recursive: true });
const ecrire = (nom: string, contenu: string): void => writeFileSync(join(dossier, nom), contenu);

const MAX_USD = 0.4;
const client = new x402Client((_v, reqs) => {
  const usdc = reqs.find((r) => r.asset.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  if (!usdc) throw new Error("pas d'option USDC dans le devis");
  const montant = Number(usdc.amount) / 1e6;
  if (montant > MAX_USD) throw new Error(`devis ${montant} $ > plafond ${MAX_USD} $ — refus`);
  return usdc;
});
registerExactEvmScheme(client, { signer: account });
const paidFetch = wrapFetchWithPayment(fetch, client);

interface Resultat { nom: string; chemin: string; attendu: string; statut: number; ok: boolean; details: string; paye: boolean; ms: number }
const resultats: Resultat[] = [];

async function appel(nom: string, chemin: string, options: { payer: boolean; attendu: string; verifier: (statut: number, entetes: Headers, corps: unknown) => string | null }): Promise<void> {
  const debut = Date.now();
  const f = options.payer ? paidFetch : fetch;
  const r = await f(`${BASE}${chemin}`, { signal: AbortSignal.timeout(240_000) });
  const ms = Date.now() - debut;
  const texte = await r.text();
  let corps: unknown = texte;
  try { corps = JSON.parse(texte); } catch { /* non JSON */ }
  const entetes: Record<string, string> = {};
  for (const [k, v] of r.headers) if (/payment|content-type|x-credits|x-request-id/i.test(k)) entetes[k] = k.toLowerCase().includes("payment") ? `<${v.length} octets>` : v;
  ecrire(`${nom}-trace.json`, JSON.stringify({ chemin, statut: r.status, ms, entetes }, null, 2));
  ecrire(`${nom}-corps.json`, typeof corps === "string" ? corps : JSON.stringify(corps, null, 2));
  const defaut = options.verifier(r.status, r.headers, corps);
  resultats.push({ nom, chemin, attendu: options.attendu, statut: r.status, ok: defaut === null, details: defaut ?? "conforme", paye: options.payer && r.status === 200, ms });
  console.log(`${defaut === null ? "✓" : "✗"} ${nom} — HTTP ${r.status} en ${ms} ms — ${defaut ?? "conforme"}`);
}

const contient = (corps: unknown, motif: RegExp): boolean => motif.test(JSON.stringify(corps));

// 1. Route lettone fermée : 410 sans devis, gratuit.
await appel("1-lv-ubo-410", "/v1/eu/entreprise/LV/40003032065/beneficiaires-effectifs", {
  payer: false,
  attendu: "410 route_fermee, aucun en-tête PAYMENT-REQUIRED",
  verifier: (statut, entetes, corps) => {
    if (statut !== 410) return `statut ${statut} au lieu de 410`;
    if (entetes.get("payment-required")) return "un devis a été émis";
    if ((corps as { error?: string })?.error !== "route_fermee") return "corps sans error=route_fermee";
    return null;
  },
});

// 2. Acte sans compte : 401 sans devis, gratuit (id = exemple public d'acte, Danone).
await appel("2-acte-401", "/v1/documents/actes/6a33ae8b0397b4bf6e0f5118", {
  payer: false,
  attendu: "401 compte_requis, aucun en-tête PAYMENT-REQUIRED",
  verifier: (statut, entetes, corps) => {
    if (statut !== 401) return `statut ${statut} au lieu de 401`;
    if (entetes.get("payment-required")) return "un devis a été émis";
    if ((corps as { error?: string })?.error !== "compte_requis") return "corps sans error=compte_requis";
    return null;
  },
});

// 3. PSC GB payé (0,02 $) : personnes morales seulement, personnes physiques comptées.
await appel("3-gb-psc-gymshark", "/v1/eu/entreprise/GB/08130873/beneficiaires-effectifs?inclure_cesses=true", {
  payer: true,
  attendu: "200 ; beneficiaires tous type=entite ; personnes_physiques_omises.cesses ≥ 2 ; aucun nom d'individu",
  verifier: (statut, _e, corps) => {
    if (statut !== 200) return `statut ${statut}`;
    const c = corps as { beneficiaires?: Array<{ type?: string }>; beneficiaires_cesses?: Array<{ type?: string }>; personnes_physiques_omises?: { actifs?: number; cesses?: number }; lecture_personnes_physiques?: string };
    const tous = [...(c.beneficiaires ?? []), ...(c.beneficiaires_cesses ?? [])];
    if (tous.some((b) => b.type !== "entite")) return "un PSC servi n'est pas une entité";
    if ((c.personnes_physiques_omises?.cesses ?? 0) < 2) return `personnes_physiques_omises.cesses = ${c.personnes_physiques_omises?.cesses}`;
    if (contient(corps, /Morgan|Francis|date_of_birth|"naissance"|"nationalite"|"type":"personne"/)) return "trace d'individu dans le corps";
    if (!c.lecture_personnes_physiques?.includes("C-798/24")) return "lecture_personnes_physiques absente";
    return null;
  },
});

// 4. /capital payé (0,35 $) : AIRVANCE GROUP, cache attendu, anonymisé.
await appel("4-capital-airvance", "/v1/entreprise/490586708/capital", {
  payer: true,
  attendu: "200 ; chaque associé porte type ; personne_physique ⇒ nom null et annee null ; compteurs présents",
  verifier: (statut, _e, corps) => {
    if (statut !== 200) return `statut ${statut}`;
    const c = corps as { depuis_cache?: boolean; lecture_associes?: string; capital?: { associes?: Array<{ type?: string; nom?: unknown; annee_naissance?: unknown }>; associes_personnes_physiques?: number; detenu_par_personnes_physiques_pct?: unknown } };
    const associes = c.capital?.associes ?? [];
    if (associes.some((a) => a.type !== "personne_morale" && a.type !== "personne_physique")) return "un associé sans type";
    if (associes.some((a) => a.type === "personne_physique" && (a.nom !== null || a.annee_naissance !== null))) return "une personne physique est nommée ou datée";
    if (typeof c.capital?.associes_personnes_physiques !== "number") return "associes_personnes_physiques absent";
    if (!("detenu_par_personnes_physiques_pct" in (c.capital ?? {}))) return "detenu_par_personnes_physiques_pct absent";
    if (!c.lecture_associes?.includes("C-798/24")) return "lecture_associes absente";
    return null;
  },
});

const depense = resultats.filter((r) => r.paye).reduce((s, r) => s + (r.nom.startsWith("3-") ? 0.02 : r.nom.startsWith("4-") ? 0.35 : 0), 0);
const recap = { campagne: "smoke-jautiva-2026-09-19", base: BASE, payeur: account.address, depense_usd_nominale: depense, resultats };
ecrire("recap.json", JSON.stringify(recap, null, 2));
ecrire("RECAP.md", [
  "# Smoke Jautiva — 19/09/2026",
  "",
  `Base : ${BASE} — payeur ${account.address} — dépense nominale ${depense.toFixed(2)} $ (2 appels payés au plus ; les refus 410 et 401 sont gratuits).`,
  "",
  "| Appel | Chemin | Attendu | HTTP | Verdict |",
  "|---|---|---|---|---|",
  ...resultats.map((r) => `| ${r.nom} | \`${r.chemin}\` | ${r.attendu} | ${r.statut} | ${r.ok ? "✓" : "✗"} ${r.details} |`),
  "",
].join("\n"));
console.log(`\n${resultats.filter((r) => r.ok).length}/${resultats.length} conformes — dossier ${dossier}`);
process.exit(resultats.every((r) => r.ok) ? 0 : 1);
