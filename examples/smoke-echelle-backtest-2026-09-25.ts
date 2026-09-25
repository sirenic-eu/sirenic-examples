/**
 * Smoke PAYANT : le backtest français du barème servi AVEC le score, `echelle.backtest` (ticket #112, décision
 * CDU A du 08/09/2026, livré sur main le 25/09/2026).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-echelle-backtest-2026-09-25.ts
 *
 * COÛT ANNONCÉ : **0,10 $** : UN appel payé, jamais plus (règle CDU du 24/09, #166).
 *   `GET /v1/score/defaillance/552032534` (DANONE, la société de l'exemple servi par la vitrine) : le bloc `echelle.backtest` est
 *   servi (mesure du 08/09, design cas-témoins, deux AUC, dix bandes, seuils 25 et 50), il nomme le barème
 *   rejoué (`defaillance-v1.8`) et `versions_couvertes` contient la version du score servi.
 * Témoin SANS achat : le corps du même score servi en v1.8 par le jeu de référence du 25/09 à 05:00 UTC (prod
 * encore figée sur 081e997, dépôt de traces) : le score servi doit rendre les mêmes points (SMOKE_TEMOIN).
 * Gratuit : le devis 402 (100 000 unités = 0,10 $), `/v1/lecture` (règle et liste fermée), `/openapi.json`,
 * `tools/list` du MCP (description de l'outil score), `/healthz` (le commit servi).
 *
 * Mode HORS LIGNE (aucun appel, aucun achat) pour valider le harnais AVANT d'acheter (règle #166) :
 *   SMOKE_CORPS=<corps du score> SMOKE_TEMOIN=<corps témoin> SMOKE_SORTIE=<dossier> \
 *     node --import tsx examples/smoke-echelle-backtest-2026-09-25.ts
 * SMOKE_SEULEMENT_GRATUIT=1 : aucun achat, les contrôles gratuits seulement.
 *
 * Rien de nominatif n'est imprimé : codes, nombres et états. Les corps sont conservés dans le dépôt privé de traces.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

type Obj = Record<string, any>;

const horsLigne = Boolean(process.env.SMOKE_CORPS);
const seulementGratuit = process.env.SMOKE_SEULEMENT_GRATUIT === "1";
const api = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const SIREN = "552032534";
const PRIX_SCORE_UNITES = 100_000; // 0,10 $ en unités atomiques USDC (6 décimales)
const REGLE = "taux_observes_du_backtest_ne_sont_pas_une_probabilite";
const BANDES = ["0-9", "10-24", "25-49", "50-79", "80-100"];
const TEMOIN =
  process.env.SMOKE_TEMOIN ?? "/home/ubuntu/sirenic-resultats/jeu/2026-09-25T05-00-03-035Z/552032534/score.json";
const TIRET_LONG = "\u2014";

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier =
  process.env.SMOKE_SORTIE ?? `/home/ubuntu/sirenic-examples/resultats/smoke-echelle-backtest-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const echecs: string[] = [];
const verifier = (ok: boolean, quoi: string): void => {
  console.log(`${ok ? "  ok  " : " ÉCHEC"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};

function lireCorps(fichier: string): Obj {
  const brut = readFileSync(fichier, "utf8");
  return JSON.parse(brut.slice(brut.indexOf("{"))) as Obj;
}

/** Même règle que l'invariant `chiffre_d_exemple_dans_texte` du jeu de référence. */
function chiffresDExemple(texte: unknown, valeurReelle: number): number[] {
  if (typeof texte !== "string") return [];
  const trouves = new Set<number>();
  for (const m of texte.matchAll(/(\d+)\s*points?\b/gi)) {
    const n = Number(m[1]);
    if (n !== valeurReelle && n !== 100 && n !== 0) trouves.add(n);
  }
  return [...trouves];
}

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

async function scorePaye(): Promise<{ corps: Obj; statut: number; regle: boolean; devis: number | null }> {
  if (horsLigne) return { corps: lireCorps(String(process.env.SMOKE_CORPS)), statut: 200, regle: true, devis: PRIX_SCORE_UNITES };
  const url = `${api}/v1/score/defaillance/${SIREN}`;
  const devis = await devisAnnonce(url);
  const r = await payer(url);
  const brut = await r.text();
  writeFileSync(`${dossier}/01-score.json`, `HTTP ${r.status}\ndevis annoncé: ${devis}\n${brut}\n`);
  const regle = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  writeFileSync(`${dossier}/01-reglement.txt`, String(regle ?? "(aucun en-tête de règlement)"));
  console.log(`\nscore ${SIREN} → HTTP ${r.status} (devis annoncé ${devis} unités atomiques)`);
  let corps: Obj = {};
  try {
    corps = JSON.parse(brut) as Obj;
  } catch {
    /* corps non-JSON conservé sur disque */
  }
  return { corps, statut: r.status, regle: Boolean(regle), devis };
}

/** La projection qui fait les POINTS et la bande : ce que le backtest a mesuré. */
const points = (s: Obj): string =>
  JSON.stringify({
    score_risque: s.score_risque,
    classe: s.classe,
    risque_12m: s.risque_12m,
    confiance: s.confiance,
    composantes: (Array.isArray(s.composantes) ? s.composantes : []).map((c: Obj) => [c.axe, c.indicateur, c.valeur, c.seuil, c.points]),
  });

let versionServie: string | null = null;
let resumeScore = "(aucun achat)";
if (!seulementGratuit) {
  const d = await scorePaye();
  const c = d.corps;
  verifier(d.statut === 200, `score : achat → 200 (lu ${d.statut})`);
  verifier(d.devis === PRIX_SCORE_UNITES, `score : devis annoncé = ${PRIX_SCORE_UNITES} unités (0,10 $), lu ${d.devis}`);
  verifier(d.regle, "score : en-tête de règlement présent (le paiement a été réglé)");
  verifier(c.siren === SIREN, `score : siren servi = ${SIREN}`);
  versionServie = typeof c.version_modele === "string" ? c.version_modele : null;
  verifier(/^defaillance-v\d+\.\d+$/.test(String(versionServie)), `score : version_modele servie lisible (lu ${versionServie})`);
  const e: Obj = c.echelle ?? {};
  verifier(e.est_une_probabilite === false, "score : echelle.est_une_probabilite reste false");
  verifier(typeof e.lecture === "string" && e.lecture.includes("PAS une probabilité"), "score : la lecture de l'échelle est intacte");
  const b: Obj = e.backtest ?? {};
  verifier(typeof e.backtest === "object" && e.backtest !== null, "score : echelle.backtest présent");
  verifier(b.mesure_le === "2026-09-08" && b.design === "cas_temoins", `backtest : mesure du 2026-09-08, design cas_temoins (lu ${b.mesure_le}, ${b.design})`);
  verifier(b.version_modele === "defaillance-v1.8", `backtest : le barème rejoué est nommé, defaillance-v1.8 (lu ${b.version_modele})`);
  const couvertes: string[] = Array.isArray(b.versions_couvertes) ? b.versions_couvertes.map(String) : [];
  verifier(couvertes.includes(String(b.version_modele)), `backtest : versions_couvertes contient la version rejouée (${couvertes.join(", ")})`);
  verifier(versionServie !== null && couvertes.includes(versionServie), `backtest : versions_couvertes contient la version du score servi (${versionServie})`);
  verifier(b.fenetre_ouvertures?.du === "2024-01-01" && b.fenetre_ouvertures?.au === "2025-12-31", "backtest : fenêtre des jugements 2024-01-01 → 2025-12-31");
  verifier(b.auc?.tous_delais === 0.682 && b.auc?.comptes_recents === 0.747, `backtest : AUC 0,682 et 0,747 (lu ${b.auc?.tous_delais}, ${b.auc?.comptes_recents})`);
  for (const cle of ["bandes", "bandes_comptes_recents"]) {
    const bandes: Obj[] = Array.isArray(b[cle]) ? b[cle] : [];
    verifier(JSON.stringify(bandes.map((x) => x.score)) === JSON.stringify(BANDES), `backtest : ${cle}, les cinq bandes dans l'ordre`);
    verifier(bandes.every((x, i) => i === 0 || x.part_defauts_pct > bandes[i - 1]!.part_defauts_pct), `backtest : ${cle}, part de défauts croissante avec le score`);
    verifier(bandes.every((x) => Array.isArray(x.ic95_pct) && x.ic95_pct[0] < x.part_defauts_pct && x.part_defauts_pct < x.ic95_pct[1]), `backtest : ${cle}, chaque part dans son intervalle de Wilson`);
  }
  const somme = (cle: string) => ((b.bandes ?? []) as Obj[]).reduce((s, x) => s + Number(x[cle]), 0);
  verifier(somme("defauts") === b.defauts_notes && somme("temoins") === b.temoins_notes, `backtest : les bandes comptent les ${b.defauts_notes} défauts et ${b.temoins_notes} témoins notés`);
  verifier(b.defauts_notes + b.defauts_sans_comptes === b.defauts_rejoues, "backtest : notés + sans comptes = rejoués");
  verifier(JSON.stringify((b.seuils ?? []).map((s: Obj) => [s.seuil, s.classe])) === JSON.stringify([[25, "vigilance"], [50, "risque_eleve"]]), "backtest : seuils 25 (vigilance) et 50 (risque élevé)");
  verifier(typeof b.lecture === "string" && b.lecture.includes(" / ") && b.lecture.includes("pas une probabilité") && b.lecture.includes("not a probability"), "backtest : lecture bilingue, « pas une probabilité »");
  verifier(![b.lecture, b.source].some((t) => String(t).includes(TIRET_LONG)), "backtest : aucun tiret long dans la lecture ni la source");
  verifier(chiffresDExemple(b.lecture, Number(c.score_risque)).length === 0, "backtest : aucun chiffre d'exemple suivi de « point(s) » dans la lecture (invariant du jeu)");
  verifier(Array.isArray(c.provenance) && c.provenance.length > 0, `score : enveloppe provenance[] servie (${(c.provenance ?? []).length} entrées)`);
  // Le témoin v1.8 du jeu de 05:00 : mêmes points attendus, sinon la « couverture » de la v1.9 serait fausse.
  const t = lireCorps(TEMOIN);
  verifier(t.version_modele === "defaillance-v1.8" && !("backtest" in (t.echelle ?? {})), `témoin : servi en v1.8, sans backtest (lu ${t.version_modele})`);
  verifier(points(c) === points(t), `score : mêmes points que le témoin v1.8 (score ${c.score_risque} contre ${t.score_risque}, classe ${c.classe} contre ${t.classe})`);
  resumeScore = `score ${c.score_risque}, classe ${c.classe}, version ${versionServie} ; backtest v${String(b.version_modele).replace("defaillance-v", "")} couvrant ${couvertes.join(", ")}`;
}

let commit = "(hors ligne)";
if (!horsLigne) {
  const lecture = (await (await fetch(`${api}/v1/lecture`)).json()) as Obj;
  const trouver = (o: unknown): Obj | null => {
    if (!o || typeof o !== "object") return null;
    if ((o as Obj).code === REGLE) return o as Obj;
    for (const v of Object.values(o as Obj)) {
      const r = trouver(v);
      if (r) return r;
    }
    return null;
  };
  const regle = trouver(lecture);
  writeFileSync(`${dossier}/02-lecture-regle.json`, JSON.stringify({ regle, design_backtest: lecture.listes_fermees?.design_backtest ?? null, echelle: lecture.listes_fermees?.classe_score?.echelle ?? null }, null, 1));
  verifier(regle !== null, `/v1/lecture : la règle ${REGLE} existe`);
  const routes: string[] = Array.isArray(regle?.routes) ? regle!.routes.map(String) : [];
  verifier(routes.includes("/v1/score/defaillance/{siren}") && routes.includes("/v1/intelligence/{siren}"), `/v1/lecture : la règle couvre le score et le rapport (${routes.join(", ")})`);
  const champs: string[] = Array.isArray(regle?.champs) ? regle!.champs.map(String) : [];
  verifier(champs.includes("echelle.backtest.versions_couvertes[]"), "/v1/lecture : la règle gouverne echelle.backtest.versions_couvertes[]");
  verifier(![regle?.fr, regle?.en].some((t) => String(t ?? "").includes(TIRET_LONG) || /Depuis le 08\/09|Since 2026-09-08/.test(String(t ?? ""))), "/v1/lecture : règle sans tiret long ni date de service fausse");
  verifier(JSON.stringify(lecture.listes_fermees?.design_backtest?.valeurs) === JSON.stringify(["cas_temoins"]), "/v1/lecture : liste fermée design_backtest = [cas_temoins]");
  const couvertesLecture: string[] = lecture.listes_fermees?.classe_score?.echelle?.backtest?.versions_couvertes ?? [];
  verifier(couvertesLecture.includes(versionServie ?? "defaillance-v1.9"), `/v1/lecture : l'échelle servie porte le backtest et couvre ${versionServie ?? "defaillance-v1.9"}`);
  const openapi = (await (await fetch(`${api}/openapi.json`)).json()) as Obj;
  const route = JSON.stringify(openapi.paths?.["/v1/score/defaillance/{siren}"] ?? {});
  writeFileSync(`${dossier}/03-openapi-score.json`, route);
  verifier(route.includes("echelle.backtest") && !route.includes("Since 2026-09-08"), "OpenAPI : la route score décrit echelle.backtest, sans date de service fausse");
  const mcp = await fetch(`${api}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    signal: AbortSignal.timeout(60_000),
  });
  const brutMcp = await mcp.text();
  const outils = new Map(
    ((JSON.parse(/data: (\{.*\})/.exec(brutMcp)?.[1] ?? brutMcp) as { result?: { tools?: Array<{ name: string; description: string }> } }).result?.tools ?? []).map((t) => [t.name, t.description]),
  );
  const descr = outils.get("get_french_company_default_risk") ?? "";
  writeFileSync(`${dossier}/04-mcp-outil-score.txt`, descr);
  verifier(descr.includes("echelle.backtest") && descr.includes("versions_couvertes") && !descr.includes("Since 2026-09-08"), "MCP : l'outil score décrit echelle.backtest et versions_couvertes, sans date fausse");
  const sante = (await (await fetch(`${api}/healthz`)).json()) as Obj;
  commit = String(sante.commit ?? "?");
}

const resume = [
  `Smoke echelle.backtest (ticket #112) : ${new Date().toISOString()}${horsLigne ? " [HORS LIGNE : corps enregistrés, aucun achat]" : ""}`,
  `prod /healthz commit : ${commit}`,
  seulementGratuit ? "aucun appel payé (SMOKE_SEULEMENT_GRATUIT=1) : contrôles gratuits seulement" : `appel payé : 1 × 0,10 $ (GET /v1/score/defaillance/${SIREN}) ; devis, lecture, OpenAPI, MCP, healthz gratuits`,
  resumeScore,
  ``,
  echecs.length === 0 ? "RÉSULTAT : tous les contrôles au vert." : `RÉSULTAT : ${echecs.length} ÉCHEC(S)`,
  ...echecs.map((e) => `  - ${e}`),
].join("\n");
writeFileSync(`${dossier}/RESUME.txt`, `${resume}\n`);
console.log(`\n${resume}\n\nRésultats conservés : ${dossier}`);
process.exit(echecs.length === 0 ? 0 : 1);
