/**
 * Contrôle PAYANT : score de défaillance v1.9, axe contentieux INERTE (ticket #107, lot 3 de l'épopée justice).
 *
 * Deux temps, parce que l'inertie se prouve par un AVANT et un APRÈS sur le même cas réel :
 *
 *   CONTROLE_ETAPE=avant node --env-file=.env.wallet-test --import tsx examples/controle-score-contentieux-2026-09-24.ts
 *   CONTROLE_ETAPE=apres CONTROLE_AVANT=<dossier de l'étape avant> CONTROLE_SHA=<sha court servi> \
 *     node --env-file=.env.wallet-test --import tsx examples/controle-score-contentieux-2026-09-24.ts
 *
 * COÛT ANNONCÉ : **0,21 $**, trois appels payés, jamais plus (règle CDU du 24/09, #166), listés au ticket avant achat :
 *   1. avant le déploiement : `GET /v1/score/defaillance/450776968` (LOXAM, 0,10 $), photo de référence ;
 *   2. après : le même achat (0,10 $) : axe calculé, bloc `contentieux_informatif` compté sur TOUTES les décisions
 *      (LOXAM : 283 au 24/09, au-delà des 100 que la route liste), score, classe, composantes et confiance
 *      identiques à la photo 1 ;
 *   3. après : `GET /v1/entreprise/450776968/contentieux` (0,01 $) : les compteurs de la synthèse se calculent
 *      avant la coupe (sommes = total) et égalent ceux du bloc du score (même agrégat).
 * Gratuit : devis 402, `/healthz` (sha court), `/v1/lecture` (axe et motifs), `/openapi.json`.
 *
 * Mode HORS LIGNE (aucun appel, aucun achat) pour valider le harnais AVANT d'acheter (règle #166) :
 *   SMOKE_CORPS_DIR=<dossier contenant 01-avant-score.json, 02-apres-score.json, 03-contentieux.json> \
 *     node --import tsx examples/controle-score-contentieux-2026-09-24.ts
 *
 * Rien de nominatif n'est imprimé : compteurs, codes et états seulement. Les corps vont au dépôt privé de traces.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

type Obj = Record<string, any>;

const horsLigne = Boolean(process.env.SMOKE_CORPS_DIR);
const etape = horsLigne ? "hors_ligne" : process.env.CONTROLE_ETAPE;
if (etape !== "avant" && etape !== "apres" && etape !== "hors_ligne") {
  console.error("CONTROLE_ETAPE=avant ou CONTROLE_ETAPE=apres (ou SMOKE_CORPS_DIR pour le mode hors ligne)");
  process.exit(1);
}
const api = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const LOXAM = "450776968";
const PRIX_SCORE_UNITES = 100_000; // 0,10 $ en unités atomiques USDC (6 décimales)
const PRIX_CONTENTIEUX_UNITES = 10_000; // 0,01 $
const LIMITE_ROUTE = 100;

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier =
  process.env.SMOKE_SORTIE ?? `/home/ubuntu/sirenic-examples/resultats/controle-score-contentieux-${etape}-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const echecs: string[] = [];
const verifier = (ok: boolean, quoi: string): void => {
  console.log(`${ok ? "  ok  " : " ÉCHEC"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};
const somme = (o: unknown): number =>
  Object.values((o ?? {}) as Record<string, number>).reduce((s, n) => s + (typeof n === "number" ? n : NaN), 0);
const egal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

let payer: typeof fetch = fetch;
if (!horsLigne) {
  const cle = process.env.TEST_WALLET_KEY;
  if (!cle?.startsWith("0x")) {
    console.error("TEST_WALLET_KEY manquante (--env-file=.env.wallet-test)");
    process.exit(1);
  }
  const { privateKeyToAccount } = await import("viem/accounts");
  const { wrapFetchWithPayment } = await import("@x402/fetch");
  const { x402Client } = await import("@x402/core/client");
  const { registerExactEvmScheme } = await import("@x402/evm/exact/client");
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: privateKeyToAccount(cle as `0x${string}`) });
  payer = wrapFetchWithPayment(fetch, client) as typeof fetch;
}

async function devisAnnonce(url: string): Promise<number | null> {
  const r = await fetch(url);
  const entete = r.headers.get("payment-required");
  if (!entete) return null;
  const d = JSON.parse(Buffer.from(entete, "base64").toString()) as { accepts?: Array<{ amount?: string }> };
  return Number(d.accepts?.[0]?.amount ?? NaN);
}

function lireCorpsEnregistre(fichier: string): Obj {
  const brut = readFileSync(fichier, "utf8");
  return JSON.parse(brut.slice(brut.indexOf("{"))) as Obj;
}

interface Achat {
  corps: Obj;
  statut: number;
  regle: boolean;
  devis: number | null;
}

/** Un achat réel (corps et règlement conservés), ou la relecture d'un corps enregistré (hors ligne). */
async function acheter(chemin: string, fichier: string, devisAttendu: number): Promise<Achat> {
  if (horsLigne) {
    return { corps: lireCorpsEnregistre(`${process.env.SMOKE_CORPS_DIR}/${fichier}`), statut: 200, regle: true, devis: devisAttendu };
  }
  const url = `${api}${chemin}`;
  const devis = await devisAnnonce(url);
  const r = await payer(url);
  const brut = await r.text();
  writeFileSync(`${dossier}/${fichier}`, `HTTP ${r.status}\ndevis annoncé: ${devis}\n${brut}\n`);
  const regle = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  writeFileSync(`${dossier}/${fichier.replace(/\.json$/, "-reglement.txt")}`, String(regle ?? "(aucun en-tête de règlement)"));
  console.log(`\n${chemin} → HTTP ${r.status} (devis annoncé ${devis} unités atomiques)`);
  let corps: Obj = {};
  try {
    corps = JSON.parse(brut) as Obj;
  } catch {
    /* corps non-JSON conservé sur disque */
  }
  return { corps, statut: r.status, regle: Boolean(regle), devis };
}

function controlesAchat(nom: string, a: Achat, devisAttendu: number): void {
  verifier(a.statut === 200, `${nom} : achat → 200 (lu ${a.statut})`);
  verifier(a.devis === devisAttendu, `${nom} : devis annoncé = ${devisAttendu} unités, lu ${a.devis}`);
  verifier(a.regle, `${nom} : en-tête de règlement présent (le paiement a été réglé)`);
}

// ---------------------------------------------------------------------------
// Étape AVANT : la photo de référence, sur la prod v1.8
// ---------------------------------------------------------------------------
if (etape === "avant") {
  const a = await acheter(`/v1/score/defaillance/${LOXAM}`, "01-avant-score.json", PRIX_SCORE_UNITES);
  controlesAchat("score avant", a, PRIX_SCORE_UNITES);
  verifier(a.corps.version_modele === "defaillance-v1.8", `score avant : version servie defaillance-v1.8 (lu ${a.corps.version_modele})`);
  verifier(a.corps.contentieux_informatif === undefined, "score avant : aucun bloc contentieux_informatif");
  console.log(`  photo : score ${a.corps.score_risque}, classe ${a.corps.classe}, confiance ${a.corps.confiance}, ${(a.corps.composantes ?? []).length} composante(s)`);
}

// ---------------------------------------------------------------------------
// Étape APRÈS (ou hors ligne) : l'axe, le bloc, l'inertie, les compteurs de la route
// ---------------------------------------------------------------------------
if (etape === "apres" || etape === "hors_ligne") {
  const fichierAvant = horsLigne ? `${process.env.SMOKE_CORPS_DIR}/01-avant-score.json` : `${process.env.CONTROLE_AVANT}/01-avant-score.json`;
  if (!existsSync(fichierAvant)) {
    console.error(`photo de référence introuvable : ${fichierAvant}`);
    process.exit(1);
  }
  const avant = lireCorpsEnregistre(fichierAvant);

  if (!horsLigne) {
    const sante = (await (await fetch(`${api}/healthz`)).json()) as Obj;
    const attendu = process.env.CONTROLE_SHA ?? "";
    // Le service publie 7 caractères : comparer au sha COURT, jamais au long.
    verifier(attendu.length > 0 && sante.commit === attendu.slice(0, 7), `healthz sert ${sante.commit}, attendu ${attendu.slice(0, 7)}`);
  }

  const b = await acheter(`/v1/score/defaillance/${LOXAM}`, "02-apres-score.json", PRIX_SCORE_UNITES);
  controlesAchat("score après", b, PRIX_SCORE_UNITES);
  const s = b.corps;
  verifier(s.version_modele === "defaillance-v1.9", `score après : version servie defaillance-v1.9 (lu ${s.version_modele})`);
  const calcules: string[] = s.couverture_axes?.calcules ?? [];
  const muets: Obj[] = s.couverture_axes?.non_calcules ?? [];
  verifier(calcules.includes("contentieux") && !muets.some((n) => n.axe === "contentieux"), "score après : axe contentieux calculé, dit une seule fois");
  verifier(!(s.composantes ?? []).some((c: Obj) => c.axe === "contentieux"), "score après : aucune composante contentieux (zéro point)");
  const bloc: Obj = s.contentieux_informatif ?? {};
  verifier(bloc.pese_dans_le_score === false, "bloc : pese_dans_le_score false");
  verifier(bloc.exhaustivite === "partielle", "bloc : exhaustivité partielle");
  verifier(typeof bloc.couverture?.taux_rattachement_mesure === "number", "bloc : couverture mesurée de la route servie");
  verifier(typeof bloc.nombre_decisions === "number" && bloc.nombre_decisions > LIMITE_ROUTE, `bloc : ${bloc.nombre_decisions} décisions, au-delà des ${LIMITE_ROUTE} que la route liste`);
  verifier(somme(bloc.par_nature) === bloc.nombre_decisions, `bloc : somme par nature ${somme(bloc.par_nature)} = total ${bloc.nombre_decisions}`);
  verifier(somme(bloc.par_role) === bloc.nombre_decisions, `bloc : somme par rôle ${somme(bloc.par_role)} = total ${bloc.nombre_decisions}`);
  verifier(typeof bloc.note === "string" && !/\d/.test(bloc.note), "bloc : note servie, sans chiffre");
  const prov = (s.provenance ?? []).find((p: Obj) => p.bloc === "contentieux_informatif") ?? {};
  verifier(prov.source_code === "judilibre_cour_de_cassation" && prov.couverture?.etat === "partielle", `enveloppe : contentieux_informatif déclaré (${prov.source_code}, ${prov.etat}, couverture ${prov.couverture?.etat})`);
  verifier(String(s.source).includes("Judilibre") && String(s.data_freshness).includes("Judilibre"), "source et data_freshness nomment le stock Judilibre");
  // L'inertie, sur un cas réel à plus de cent décisions : tout ce qui fait le verdict est identique à la photo v1.8.
  for (const champ of ["score_risque", "classe", "risque_12m", "confiance", "exercice_reference", "composantes"]) {
    verifier(egal(s[champ], avant[champ]), `inertie : ${champ} identique à la photo v1.8`);
  }

  const c = await acheter(`/v1/entreprise/${LOXAM}/contentieux`, "03-contentieux.json", PRIX_CONTENTIEUX_UNITES);
  controlesAchat("contentieux", c, PRIX_CONTENTIEUX_UNITES);
  const syn: Obj = c.corps.synthese ?? {};
  verifier(c.corps.tronque === true && (c.corps.decisions ?? []).length === LIMITE_ROUTE, `route : liste coupée à ${LIMITE_ROUTE}, coupe dite`);
  for (const [nom, cle] of [["nature", "par_nature"], ["rôle", "par_role"], ["année", "par_annee"]] as const) {
    verifier(somme(syn[cle]) === syn.nombre_decisions, `route : somme par ${nom} ${somme(syn[cle])} = total ${syn.nombre_decisions} (compteur avant la coupe)`);
  }
  for (const cle of ["nombre_decisions", "nombre_hors_procedure_collective", "par_nature", "par_role", "premiere_decision", "derniere_decision"]) {
    verifier(egal(syn[cle], bloc[cle]), `route = bloc du score : ${cle}`);
  }

  if (!horsLigne) {
    const lecture = (await (await fetch(`${api}/v1/lecture`)).json()) as Obj;
    const listes: Obj = lecture.listes_fermees ?? {};
    verifier((listes.axe_du_bareme?.valeurs ?? []).includes("contentieux"), "/v1/lecture : axe contentieux dans la liste fermée");
    for (const m of ["entite_non_couverte", "stock_jamais_constitue", "stock_perime"]) {
      verifier((listes.motif_axe_non_calcule?.valeurs ?? []).includes(m), `/v1/lecture : motif ${m}`);
    }
    const spec = await (await fetch(`${api}/openapi.json`)).text();
    verifier(spec.includes("contentieux_informatif"), "/openapi.json : la réponse du score décrit contentieux_informatif");
  }
}

writeFileSync(`${dossier}/RESUME.txt`, `${etape} : ${echecs.length === 0 ? "VERT" : `ROUGE (${echecs.length})`}\n${echecs.join("\n")}\n`);
console.log(`\n${echecs.length === 0 ? "VERT" : `ROUGE : ${echecs.length} échec(s)`} ; traces : ${dossier}`);
process.exit(echecs.length === 0 ? 0 : 1);
