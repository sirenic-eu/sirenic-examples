/**
 * Smoke PAYANT : le 6e bloc « contentieux » du dossier KYB (ticket #103, justice lot 4, 24/09/2026).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-kyb-contentieux-2026-09-24.ts
 *
 * COÛT ANNONCÉ : **0,30 $** : deux appels payés à 0,15 $ chacun, jamais plus (règle CDU du 24/09, #166).
 *   1. `GET /v1/kyb/450776968` (LOXAM) : 283 décisions rattachées au stock Judilibre (smoke du 10/09), le
 *      bloc en sert 20, la coupe est DITE (`tronque_dans_le_rapport`, `voir_aussi`), l'enveloppe la qualifie
 *      `partiel`, le score de complétude compte 6 blocs.
 *   2. `GET /v1/kyb/321613812` (entrepreneur individuel) : le bloc est `{ couvert: false, motif:
 *      "entreprise_individuelle" }`, hors des blocs manquants, l'enveloppe le dit `sans_objet`, le score
 *      de complétude compte 5 blocs (décision CDU 2C : un bloc sans objet n'entre pas au dénominateur).
 * Gratuit : le devis 402 (150 000 unités = 0,15 $), HEAD (405), `/openapi.json` (la note de version), `/v1/lecture`
 * (la règle « zéro décision n'est pas absence de contentieux » étendue au KYB), `/healthz` (le commit servi).
 *
 * Mode HORS LIGNE (aucun appel, aucun achat) pour valider le harnais AVANT d'acheter (règle #166) :
 *   SMOKE_CORPS_DIR=<dossier contenant 01-loxam-kyb.json et 02-ei-kyb.json> SMOKE_SORTIE=<dossier> \
 *     node --import tsx examples/smoke-kyb-contentieux-2026-09-24.ts
 *
 * Rien de nominatif n'est imprimé : compteurs, codes et états seulement. Les corps sont conservés dans le
 * dépôt privé de traces.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

type Obj = Record<string, any>;

const horsLigne = Boolean(process.env.SMOKE_CORPS_DIR);
/** SMOKE_SEULEMENT_GRATUIT=1 : aucun achat, seuls les contrôles gratuits (devis, HEAD, OpenAPI, lecture, healthz).
 *  Sert à rejouer un contrôle gratuit après un rouge du harnais sans racheter (règle #166). */
const seulementGratuit = process.env.SMOKE_SEULEMENT_GRATUIT === "1";
const api = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const LOXAM = "450776968";
const EI = "321613812";
const PRIX_KYB_UNITES = 150_000; // 0,15 $ en unités atomiques USDC (6 décimales)
const DECISIONS_DANS_LE_BLOC = 20;
const NATURES = new Set([
  "procedure_collective",
  "condamnation_ou_injonction_a_payer",
  "refere",
  "expertise_ou_mesure_d_instruction",
  "litige_commercial_autre",
  "indeterminee",
]);
const ROLES = new Set(["demandeur", "defendeur", "sujet_procedure", "indetermine"]);
const CLES_DECISION = new Set([
  "id_judilibre",
  "date",
  "juridiction",
  "code_juridiction",
  "numero_rg",
  "nature",
  "role",
  "mode_rattachement",
  "confiance",
  "redondante_bodacc",
  "autres_parties",
  "url_officielle",
]);
const CLES_AUTRE_PARTIE = new Set(["siren", "denomination", "role"]);

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier =
  process.env.SMOKE_SORTIE ?? `/home/ubuntu/sirenic-examples/resultats/smoke-kyb-contentieux-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const echecs: string[] = [];
const verifier = (ok: boolean, quoi: string): void => {
  console.log(`${ok ? "  ok  " : " ÉCHEC"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};

let payer: typeof fetch = fetch;
if (!horsLigne && !seulementGratuit) {
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

/** Un dossier KYB, acheté (mode réel) ou lu sur disque (mode hors ligne). */
async function dossierKyb(siren: string, prefixe: string): Promise<{ corps: Obj; statut: number; regle: boolean; devis: number | null }> {
  if (horsLigne) {
    const fichier = `${process.env.SMOKE_CORPS_DIR}/${prefixe}-kyb.json`;
    return { corps: lireCorpsEnregistre(fichier), statut: 200, regle: true, devis: PRIX_KYB_UNITES };
  }
  const url = `${api}/v1/kyb/${siren}`;
  const devis = await devisAnnonce(url);
  const r = await payer(url);
  const brut = await r.text();
  writeFileSync(`${dossier}/${prefixe}-kyb.json`, `HTTP ${r.status}\ndevis annoncé: ${devis}\n${brut}\n`);
  const regle = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  writeFileSync(`${dossier}/${prefixe}-reglement.txt`, String(regle ?? "(aucun en-tête de règlement)"));
  console.log(`\nKYB ${siren} → HTTP ${r.status} (devis annoncé ${devis} unités atomiques)`);
  let corps: Obj = {};
  try {
    corps = JSON.parse(brut) as Obj;
  } catch {
    /* corps non-JSON conservé sur disque */
  }
  return { corps, statut: r.status, regle: Boolean(regle), devis };
}

/** Contrôles communs aux deux dossiers : livraison, place du bloc, cohérence du score, attribution. */
function controlesCommuns(nom: string, d: { corps: Obj; statut: number; regle: boolean; devis: number | null }, siren: string, denominateur: number): Obj[] {
  const { corps } = d;
  verifier(d.statut === 200, `${nom} : achat → 200 (lu ${d.statut})`);
  verifier(d.devis === PRIX_KYB_UNITES, `${nom} : devis annoncé = ${PRIX_KYB_UNITES} unités (0,15 $), lu ${d.devis}`);
  verifier(d.regle, `${nom} : en-tête de règlement présent (le paiement a été réglé)`);
  verifier(corps.siren === siren, `${nom} : siren servi = ${siren}`);
  verifier("contentieux" in corps && corps.contentieux !== null && typeof corps.contentieux === "object", `${nom} : bloc contentieux présent`);
  const cles = Object.keys(corps);
  verifier(cles.indexOf("contentieux") === cles.indexOf("alertes_bodacc") + 1, `${nom} : contentieux suit alertes_bodacc dans le dossier`);
  const manquants: Obj[] = Array.isArray(corps.blocs_manquants) ? corps.blocs_manquants : [];
  verifier(!manquants.some((b) => b.bloc === "contentieux"), `${nom} : contentieux absent de blocs_manquants (${manquants.map((b) => b.bloc).join(", ") || "aucun"})`);
  const attendu = Math.round(((denominateur - manquants.length) / denominateur) * 100);
  verifier(corps.score_completude === attendu, `${nom} : score_completude ${corps.score_completude} = ${denominateur - manquants.length}/${denominateur} blocs (attendu ${attendu})`);
  // L'attribution du dossier ne nomme Judilibre que si des décisions ont été LUES (bloc couvert) :
  // pour une entité sans objet, rien n'a été consulté et le champ source ne le prétend pas.
  const couvert = (corps.contentieux as Obj | undefined)?.couvert === true;
  verifier(/Judilibre/.test(String(corps.source)) === couvert, `${nom} : le champ source du dossier ${couvert ? "cite" : "ne cite pas"} Judilibre (bloc ${couvert ? "couvert" : "sans objet"})`);
  verifier(!/PAR CES MOTIFS|\[[A-Z]{1,2}\]|"texte"|"text"/.test(JSON.stringify(corps.contentieux ?? {})), `${nom} : ni texte de décision ni jeton d'occultation dans le bloc`);
  const prov: Obj[] = Array.isArray(corps.provenance) ? corps.provenance : [];
  verifier(prov.length > 0, `${nom} : enveloppe provenance[] servie (${prov.length} entrées)`);
  return prov;
}

// 1. LOXAM : liste coupée à 20, dite, enveloppe partiel, 6 blocs comptés.
const vide = { corps: {} as Obj, statut: 0, regle: false, devis: null };
const loxam = seulementGratuit ? vide : await dossierKyb(LOXAM, "01-loxam");
if (!seulementGratuit) {
  const prov = controlesCommuns("LOXAM", loxam, LOXAM, 6);
  const bloc: Obj = loxam.corps.contentieux ?? {};
  verifier(bloc.couvert === true, "LOXAM : bloc couvert (personne morale diffusible)");
  const total = Number(bloc.synthese?.nombre_decisions);
  verifier(total >= 283, `LOXAM : synthese.nombre_decisions ≥ 283 (lu ${total})`);
  const recentes: Obj[] = Array.isArray(bloc.decisions_recentes) ? bloc.decisions_recentes : [];
  verifier(recentes.length === DECISIONS_DANS_LE_BLOC, `LOXAM : ${DECISIONS_DANS_LE_BLOC} décisions servies (lu ${recentes.length})`);
  verifier(bloc.nombre_decisions_dans_le_rapport === recentes.length, "LOXAM : nombre_decisions_dans_le_rapport = décisions servies");
  verifier(bloc.tronque_dans_le_rapport === true, "LOXAM : coupe dite (tronque_dans_le_rapport)");
  verifier(/\/v1\/entreprise\/\{siren\}\/contentieux/.test(String(bloc.voir_aussi ?? "")) && new RegExp(String(total)).test(String(bloc.voir_aussi ?? "")), "LOXAM : voir_aussi renvoie à la route avec le total");
  verifier(bloc.couverture?.taux_rattachement_mesure === 0.618 && Boolean(bloc.couverture?.mesure_le), "LOXAM : couverture mesurée servie (0,618, datée)");
  verifier(Boolean(bloc.avertissement) && Boolean(bloc.disclaimer) && Boolean(bloc.avis) && Boolean(bloc.consulte_le) && Boolean(bloc.data_freshness), "LOXAM : avertissement, disclaimer, avis, consulte_le, data_freshness servis");
  verifier(/Judilibre/.test(String(bloc.source)) && /Licence Ouverte 2\.0/.test(String(bloc.source)), "LOXAM : attribution Judilibre + Licence Ouverte 2.0 dans le bloc");
  const dates = recentes.map((x) => String(x.date));
  verifier(dates.every((v, i) => i === 0 || v <= dates[i - 1]), "LOXAM : décisions servies des plus récentes aux plus anciennes");
  verifier(recentes.every((x) => Object.keys(x).every((k) => CLES_DECISION.has(k))), "LOXAM : clés fermées sur chaque décision");
  verifier(recentes.every((x) => NATURES.has(String(x.nature)) && ROLES.has(String(x.role))), "LOXAM : nature et rôle en listes fermées");
  verifier(recentes.every((x) => /^https:\/\/www\.courdecassation\.fr\/decision\/[0-9a-f]{24}$/.test(String(x.url_officielle))), "LOXAM : lien officiel Cour de cassation sur chaque décision");
  verifier(recentes.every((x) => Array.isArray(x.autres_parties) && x.autres_parties.every((p: Obj) => Object.keys(p).every((k) => CLES_AUTRE_PARTIE.has(k)) && /^\d{9}$/.test(String(p.siren)))), "LOXAM : autres parties = personnes morales au SIREN (siren, denomination, role), rien d'autre");
  const entree = prov.find((p) => p.bloc === "contentieux");
  verifier(Boolean(entree), "LOXAM : enveloppe : une entrée contentieux");
  verifier(entree?.source_code === "judilibre_cour_de_cassation", `LOXAM : enveloppe : source judilibre_cour_de_cassation (lu ${entree?.source_code})`);
  verifier(entree?.etat === "partiel" && entree?.couverture?.etat === "partielle", `LOXAM : enveloppe : partiel sur couverture partielle (lu ${entree?.etat} / ${entree?.couverture?.etat})`);
  verifier(typeof entree?.as_of === "string" || typeof entree?.consulte_le === "string", "LOXAM : enveloppe : entrée datée");
}

// 2. Entrepreneur individuel : sans objet, hors des blocs manquants, 5 blocs comptés.
const ei = seulementGratuit ? vide : await dossierKyb(EI, "02-ei");
if (!seulementGratuit) {
  const prov = controlesCommuns("EI", ei, EI, 5);
  const bloc: Obj = ei.corps.contentieux ?? {};
  verifier(bloc.couvert === false, "EI : bloc non couvert (couvert: false)");
  verifier(bloc.motif === "entreprise_individuelle", `EI : motif entreprise_individuelle (lu ${bloc.motif})`);
  verifier(typeof bloc.note === "string" && bloc.note.length > 0, "EI : note servie");
  verifier(!("decisions_recentes" in bloc) && !("synthese" in bloc), "EI : ni liste ni synthèse (rien n'existe)");
  verifier(ei.corps.denomination_exposable === false, "EI : denomination_exposable false (personne physique)");
  const entree = prov.find((p) => p.bloc === "contentieux");
  verifier(Boolean(entree), "EI : enveloppe : une entrée contentieux");
  verifier(entree?.etat === "sans_objet", `EI : enveloppe : sans_objet (lu ${entree?.etat})`);
  verifier(Object.keys(bloc).every((k) => ["couvert", "motif", "note"].includes(k)), "EI : clés fermées du bloc non couvert");
}

// 3. Gratuit : devis, HEAD, note de version OpenAPI, règle de lecture, commit servi.
let commit = "(hors ligne)";
if (!horsLigne) {
  const tete = await fetch(`${api}/v1/kyb/${LOXAM}`, { method: "HEAD" });
  verifier(tete.status === 405, `HEAD → 405 (lu ${tete.status})`);
  const openapi = (await (await fetch(`${api}/openapi.json`)).json()) as Obj;
  const kybOpenapi = JSON.stringify(openapi.paths?.["/v1/kyb/{siren}"] ?? {});
  verifier(/commercial-court|contentieux|Judilibre/i.test(kybOpenapi), "OpenAPI : /v1/kyb/{siren} nomme les décisions de tribunaux de commerce");
  verifier(/2026-09-24/.test(kybOpenapi), "OpenAPI : la note de version est datée 2026-09-24");
  writeFileSync(`${dossier}/03-openapi-kyb.json`, kybOpenapi);
  const lecture = (await (await fetch(`${api}/v1/lecture`)).json()) as Obj;
  // La règle se cherche dans le JSON (pas par expression régulière : les routes portent des accolades,
  // « {siren} », qui coupaient l'extraction du premier passage du 24/09 : rouge du harnais, pas du produit).
  const trouver = (o: unknown): Obj | null => {
    if (!o || typeof o !== "object") return null;
    if ((o as Obj).code === "zero_decision_nest_pas_absence_de_contentieux") return o as Obj;
    for (const v of Object.values(o as Obj)) {
      const r = trouver(v);
      if (r) return r;
    }
    return null;
  };
  const regle = trouver(lecture);
  verifier(regle !== null, "/v1/lecture : la règle zero_decision_nest_pas_absence_de_contentieux existe");
  const routes: string[] = Array.isArray(regle?.routes) ? regle!.routes.map(String) : [];
  verifier(routes.includes("/v1/kyb/{siren}") && routes.includes("/v1/kyb/batch"), `/v1/lecture : la règle couvre /v1/kyb/{siren} et /v1/kyb/batch (routes : ${routes.join(", ")})`);
  writeFileSync(`${dossier}/04-lecture-regle.json`, JSON.stringify(regle ?? "(règle introuvable)", null, 1));
  const sante = (await (await fetch(`${api}/healthz`)).json()) as Obj;
  commit = String(sante.commit ?? "?");
}

const resume = [
  `Smoke KYB + contentieux (ticket #103, justice lot 4) : ${new Date().toISOString()}${horsLigne ? " [HORS LIGNE : corps enregistrés, aucun achat]" : ""}`,
  `prod /healthz commit : ${commit}`,
  seulementGratuit ? "aucun appel payé (SMOKE_SEULEMENT_GRATUIT=1) : contrôles gratuits seulement" : `appels payés : 2 × 0,15 $ (LOXAM ${LOXAM}, entrepreneur individuel ${EI}) ; devis, HEAD, OpenAPI, lecture gratuits`,
  ...(seulementGratuit
    ? []
    : [
        `LOXAM : ${loxam.corps.contentieux?.synthese?.nombre_decisions} décisions rattachées, ${loxam.corps.contentieux?.decisions_recentes?.length} servies, coupe ${loxam.corps.contentieux?.tronque_dans_le_rapport}, complétude ${loxam.corps.score_completude}/100, blocs manquants : ${((loxam.corps.blocs_manquants ?? []) as Obj[]).map((b) => b.bloc).join(", ") || "aucun"}`,
        `EI : couvert ${String(ei.corps.contentieux?.couvert)}, motif ${ei.corps.contentieux?.motif}, complétude ${ei.corps.score_completude}/100, blocs manquants : ${((ei.corps.blocs_manquants ?? []) as Obj[]).map((b) => b.bloc).join(", ") || "aucun"}`,
      ]),
  ``,
  echecs.length === 0 ? "RÉSULTAT : tous les contrôles au vert." : `RÉSULTAT : ${echecs.length} ÉCHEC(S)`,
  ...echecs.map((e) => `  - ${e}`),
].join("\n");
writeFileSync(`${dossier}/RESUME.txt`, `${resume}\n`);
console.log(`\n${resume}\n\nRésultats conservés : ${dossier}`);
process.exit(echecs.length === 0 ? 0 : 1);
