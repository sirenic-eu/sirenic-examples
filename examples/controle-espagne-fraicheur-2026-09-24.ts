/**
 * Contrôle post-déploiement du ticket 163 (24/09/2026) : fraîcheur PAR FLUX de la route espagnole des marchés publics
 * (PLACSP). La garde lisait le seul dernier passage réussi ; une source figée (mesuré le 24/09 : la PLACSP rejoue
 * d'anciennes périodes depuis le 23/09) ne la faisait jamais tomber, et l'enveloppe revendiquait une publication officielle
 * du jour du passage, âge 0.
 *
 * Gratuit :
 *   1. /healthz sert le commit attendu (argument 1, sha COURT de 7 caractères) ;
 *   2. /openapi.json : la 503 de la route dit la fermeture sur un flux figé, la 200 décrit stock.flux ;
 *   3. /v1/lecture : la règle zero_marche_placsp_nest_pas_absence gouverne stock.flux.
 * Payant, un seul appel (0,02 $, x402) :
 *   4. /v1/eu/entreprise/ES/A28582013/marches-publics (CHM OBRAS) : stock.flux date chaque flux, dernier_mis_a_jour est le
 *      plus récent des deux (en instants), l'enveloppe date le plus ANCIEN des deux (publication officielle), l'âge suit, aucun
 *      flux au-delà de 7 jours entiers (sinon la route aurait dû rendre 503), data_freshness dit la règle.
 *
 * Valider le harnais AVANT d'acheter (règle du 24/09) : HORS_LIGNE=<corps.json> rejoue le constat 4 sur un corps déjà payé,
 * par exemple celui du 24/09 (prod 083ce0a, avant le correctif), qui doit être refusé ; SANS_ACHAT=1 ne joue que 1 à 3.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-espagne-fraicheur-2026-09-24.ts <sha7>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const BASE = process.env.SIRENIC_BASE ?? "https://api.sirenic.eu";
const ROUTE = "/v1/eu/entreprise/ES/{nif}/marches-publics";
const NIF = "A28582013";
const SEUIL_JOURS = 7;
const attendu = process.argv[2] ?? "";
const horsLigne = process.env.HORS_LIGNE;
const sansAchat = process.env.SANS_ACHAT === "1";
const wallet = process.env.TEST_WALLET_KEY;
if (!horsLigne && !/^[0-9a-f]{7}$/.test(attendu)) {
  console.error("usage : <sha court de 7 caractères servi par /healthz> (ou HORS_LIGNE=<corps.json>)");
  process.exit(2);
}
if (!horsLigne && !sansAchat && !wallet?.startsWith("0x")) {
  console.error("TEST_WALLET_KEY absente : rien pour payer l'appel 4");
  process.exit(2);
}

const dossier = join("resultats", `controle-espagne-fraicheur-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(dossier, { recursive: true });
const ecrire = (nom: string, contenu: string): void => writeFileSync(join(dossier, nom), contenu);

interface Constat { nom: string; ok: boolean; details: string }
const constats: Constat[] = [];
const constater = (nom: string, defaut: string | null): void => {
  constats.push({ nom, ok: defaut === null, details: defaut ?? "conforme" });
  console.log(`${defaut === null ? "✓" : "✗"} ${nom} : ${defaut ?? "conforme"}`);
};
const texte = async (chemin: string): Promise<{ statut: number; corps: string }> => {
  const r = await fetch(`${BASE}${chemin}`, { signal: AbortSignal.timeout(60_000) });
  const corps = await r.text();
  ecrire(`${chemin.replace(/[^a-z0-9]+/gi, "_")}.txt`, corps);
  return { statut: r.status, corps };
};
const finir = (): never => {
  ecrire("recap.json", JSON.stringify({ campagne: "controle-espagne-fraicheur-2026-09-24", base: BASE, commit_attendu: attendu || null, hors_ligne: horsLigne ?? null, sans_achat: sansAchat, constats }, null, 2));
  ecrire("RECAP.md", ["# Contrôle fraîcheur par flux, Espagne PLACSP (ticket 163), 24/09/2026", "", "| Constat | Verdict |", "|---|---|", ...constats.map((c) => `| ${c.nom} | ${c.ok ? "✓" : "✗"} ${c.details} |`), ""].join("\n"));
  console.log(`\n${constats.filter((c) => c.ok).length}/${constats.length} conformes, dossier ${dossier}`);
  process.exit(constats.every((c) => c.ok) ? 0 : 1);
};

type Corps = Record<string, unknown>;
/** Constat 4 : jugé sur le corps servi, jamais sur le dépôt. */
function jugerCorps(statut: number, brut: string, maintenant: Date): string | null {
  if (statut !== 200) return `HTTP ${statut}`;
  let corps: Corps;
  try { corps = JSON.parse(brut) as Corps; } catch { return "corps non JSON"; }
  const stock = (corps.stock ?? {}) as { dernier_mis_a_jour?: string; flux?: Record<string, { dernier_mis_a_jour?: string }> };
  const flux = stock.flux;
  if (!flux || typeof flux !== "object") return "stock.flux absent";
  const dates = ["licitaciones", "agregadas"].map((f) => flux[f]?.dernier_mis_a_jour ?? "");
  const instants = dates.map((d) => Date.parse(d));
  if (instants.some((t) => !Number.isFinite(t))) return `stock.flux illisible : ${JSON.stringify(flux)}`;
  const plusRecent = dates[instants.indexOf(Math.max(...instants))];
  if (stock.dernier_mis_a_jour !== plusRecent) return `stock.dernier_mis_a_jour ${stock.dernier_mis_a_jour}, attendu le plus récent des flux ${plusRecent}`;
  const ages = instants.map((t) => Math.floor((maintenant.getTime() - t) / 86_400_000));
  if (ages.some((a) => a > SEUIL_JOURS)) return `un flux au-delà de ${SEUIL_JOURS} jours entiers (${ages.join(", ")}) servi en 200 : la garde aurait dû fermer`;
  const complet = new Date(Math.min(...instants)).toISOString().slice(0, 10);
  const provenance = (corps.provenance ?? []) as Array<{ bloc?: string; as_of?: string; precision_as_of?: string; age_jours?: number }>;
  for (const bloc of ["attributions", "avis_emis"]) {
    const p = provenance.find((e) => e.bloc === bloc);
    if (!p) return `bloc ${bloc} absent de la provenance`;
    if (p.as_of !== complet || p.precision_as_of !== "publication_officielle") return `${bloc} : as_of ${p.as_of} (${p.precision_as_of}), attendu ${complet} (publication_officielle, le plus ancien des deux flux)`;
    const age = Math.floor((maintenant.getTime() - Date.parse(complet)) / 86_400_000);
    if (p.age_jours !== age) return `${bloc} : age_jours ${p.age_jours}, attendu ${age}`;
  }
  if (!String(corps.data_freshness ?? "").includes("sans nouvelle publication de l'un des deux flux")) return "data_freshness sans la règle des deux flux";
  return null;
}

if (horsLigne) {
  // Harnais : le même jugement sur un corps enregistré (la date de l'enregistrement fait foi pour les âges).
  const enregistre = JSON.parse(readFileSync(horsLigne, "utf8")) as Corps & { _paye_le?: string };
  const quand = new Date(process.env.HORS_LIGNE_LE ?? enregistre._paye_le ?? Date.now());
  constater(`corps enregistré ${horsLigne} (jugé au ${quand.toISOString()})`, jugerCorps(200, JSON.stringify(enregistre), quand));
  finir();
}

// 1. Commit servi.
const sante = JSON.parse((await texte("/healthz")).corps) as { commit?: string };
constater("healthz", sante.commit === attendu ? null : `commit servi ${sante.commit}, attendu ${attendu}`);

// 2. OpenAPI.
const spec = JSON.parse((await texte("/openapi.json")).corps) as {
  paths: Record<string, { get?: { responses?: Record<string, { description?: string }> } }>;
};
const reponses = spec.paths[ROUTE]?.get?.responses ?? {};
constater("openapi 503", (reponses["503"]?.description ?? "").includes("one feed with nothing newer published for 7 days") ? null : `503 : ${reponses["503"]?.description}`);
constater("openapi 200", (reponses["200"]?.description ?? "").includes("flux {licitaciones, agregadas}") ? null : "200 sans stock.flux");

// 3. Règle de lecture.
const lecture = JSON.parse((await texte("/v1/lecture")).corps) as { regles?: Array<{ code?: string; champs?: string[]; fr?: string }> };
const regle = lecture.regles?.find((r) => r.code === "zero_marche_placsp_nest_pas_absence");
constater("lecture", regle?.champs?.includes("stock.flux") && regle.fr?.includes("stock.flux date le dossier le plus récent") ? null : "règle sans stock.flux");

if (sansAchat) {
  console.log("– appel 4 non joué (SANS_ACHAT=1)");
  finir();
}

// 4. Un appel payant, x402 (le paiement n'est pas l'objet : le CONTENU l'est ; pas de clé de test posée au 24/09, #166).
const compte = privateKeyToAccount(wallet as `0x${string}`);
const client = new x402Client((_v, reqs) => {
  const usdc = reqs.find((r) => r.asset.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  if (!usdc) throw new Error("pas d'option USDC dans le devis");
  if (Number(usdc.amount) / 1e6 > 0.03) throw new Error("devis au-dessus de 0,03 $ : refus");
  return usdc;
});
registerExactEvmScheme(client, { signer: compte });
const chemin = ROUTE.replace("{nif}", NIF);
const reponse = await wrapFetchWithPayment(fetch, client)(`${BASE}${chemin}`, { signal: AbortSignal.timeout(60_000) });
const brut = await reponse.text();
const payeLe = new Date();
ecrire("4-es-chm-marches-corps.json", brut);
ecrire("4-es-chm-marches-trace.json", JSON.stringify({ chemin, statut: reponse.status, rail: "x402", paye_le: payeLe.toISOString(), reglement: reponse.headers.get("payment-response") ?? reponse.headers.get("x-payment-response") }, null, 2));
constater(`ES ${NIF} marches-publics`, jugerCorps(reponse.status, brut, payeLe));
finir();
