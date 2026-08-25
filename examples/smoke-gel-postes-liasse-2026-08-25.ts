/**
 * Smoke PAYANT — le GEL de la source des postes de liasse est-il DIT dans la
 * réponse payée ? (correctif du 25/08/2026, commit d01efb0)
 *
 * Ce qui est vendu ne se prouve qu'à l'ACHAT : la suite de tests prouve que le
 * code produit les champs, pas que la prod les sert.
 *
 * QUATRE ÉPREUVES, choisies pour couvrir les TROIS comportements de l'axe plus
 * la comparaison — un smoke qui n'achèterait que des silences ne prouverait
 * rien, et un smoke qui n'achèterait qu'un silence ne distinguerait pas ses
 * DEUX causes, qui ne se soignent pas de la même façon :
 *
 *   1. **BOBION & JOANIN (820954519)** — 0,10 $ : l'axe PARLE et pénalise
 *      (0,76 % → 12 points, 28/vigilance). Attendu : `data_freshness` porte la
 *      DATE de la photo amont, et AUCUNE note de silence.
 *   2. **DAMAFOUILLE DISTRIBUTION (824498141)** — 0,10 $ : l'axe est muet parce
 *      que la photo amont ne COUVRE PAS son exercice de référence. Attendu :
 *      `tresorerie_muette: "exercice_non_couvert"` et `note_tresorerie` citant
 *      la date. C'est le cas que le gel fabrique — 150 500 sociétés mesurées.
 *   3. **DANONE (552032534)** — 0,10 $ : l'axe est muet pour l'AUTRE cause (ses
 *      dettes à moins d'un an sont absentes de la liasse déposée). Attendu :
 *      `tresorerie_muette: "poste_non_publie"`, score 22 inchangé. Épreuve
 *      DISCRIMINANTE : sans elle, un code unique passerait pour deux.
 *   4. **Comparaison 400918041,824498141** (GET /v1/comparer) — 0,24 $ (0,12 × 2) : le couple RÉEL
 *      relevé le 25/08, mêmes NAF/catégorie/bilan et clôtures le MÊME jour.
 *      Attendu : avertissement `axe_tresorerie_indisponible` nommant la société
 *      non couverte, `fiable` toujours vrai, et la date de la photo dans
 *      `provenance`.
 *
 * Total ≈ 0,54 $ (wallet de test 0x9218fd5A…, exclu du revenu réel).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-gel-postes-liasse-2026-08-25.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const api = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const cle = process.env.TEST_WALLET_KEY;
if (!cle?.startsWith("0x")) {
  console.error("TEST_WALLET_KEY manquante (--env-file=.env.wallet-test)");
  process.exit(1);
}
const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(cle as `0x${string}`) });
const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-gel-postes-liasse-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const echecs: string[] = [];
const verifier = (ok: boolean, quoi: string): void => {
  console.log(`${ok ? "  ok  " : " ÉCHEC"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};

async function acheter(nom: string, url: string) {
  const r = await payer(url);
  const brut = await r.text();
  writeFileSync(`${dossier}/${nom}.json`, `HTTP ${r.status}\n${brut}\n`);
  const regle = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  writeFileSync(`${dossier}/${nom}-reglement.txt`, String(regle ?? "(aucun en-tête de règlement)"));
  let corps: Record<string, unknown> = {};
  try {
    corps = JSON.parse(brut) as Record<string, unknown>;
  } catch {
    /* corps non JSON : les assertions échoueront d'elles-mêmes */
  }
  console.log(`\n— ${nom} → HTTP ${r.status}${regle ? " (réglé)" : ""}`);
  return { statut: r.status, brut, corps, regle };
}

const infos = (c: Record<string, unknown>) =>
  c.ratios_informatifs as Record<string, unknown> | undefined;

// --- 1. L'axe PARLE : la date est servie, le silence ne l'est pas -----------
const b = await acheter("1-bobion-axe-parle", `${api}/v1/score/defaillance/820954519`);
verifier(b.statut === 200, `BOBION : 200 (lu ${b.statut})`);
verifier(b.regle !== null, "BOBION : paiement RÉGLÉ (en-tête de règlement présent)");
verifier(b.corps.score_risque === 28, `BOBION : score 28 inchangé (lu ${String(b.corps.score_risque)})`);
// LE correctif : la quatrième source est nommée ET datée.
verifier(
  String(b.corps.data_freshness).includes("postes de liasse : photo amont du"),
  `BOBION : data_freshness NOMME la source et sa photo (lu « ${String(b.corps.data_freshness)} »)`,
);
verifier(
  /photo amont du \d{4}-\d{2}-\d{2}/.test(String(b.corps.data_freshness)),
  "BOBION : la date de la photo est une VRAIE date, lue en base",
);
// Et quand l'axe parle, aucune note de silence ne doit apparaître.
verifier(b.corps.tresorerie_muette === undefined, "BOBION : aucun code de silence (l'axe a parlé)");
verifier(b.corps.note_tresorerie === undefined, "BOBION : aucune note de silence");
verifier(
  Number(infos(b.corps)?.tresorerie_nette_sur_dettes_court_terme_pourcent) === 0.76,
  `BOBION : ratio 0,76 % servi (lu ${String(infos(b.corps)?.tresorerie_nette_sur_dettes_court_terme_pourcent)})`,
);

// --- 2. Silence PAR LE GEL : l'exercice n'est pas couvert -------------------
const d1 = await acheter("2-damafouille-exercice-non-couvert", `${api}/v1/score/defaillance/824498141`);
verifier(d1.statut === 200, `DAMAFOUILLE : 200 (lu ${d1.statut})`);
verifier(d1.regle !== null, "DAMAFOUILLE : paiement RÉGLÉ");
verifier(
  d1.corps.tresorerie_muette === "exercice_non_couvert",
  `DAMAFOUILLE : cause « exercice_non_couvert » (lu ${String(d1.corps.tresorerie_muette)})`,
);
verifier(
  /\d{4}-\d{2}-\d{2}/.test(String(d1.corps.note_tresorerie ?? "")),
  "DAMAFOUILLE : la note PORTE la date de la photo amont",
);
verifier(
  String(d1.corps.note_tresorerie ?? "").includes("jamais un bon résultat"),
  "DAMAFOUILLE : la note dit que l'absence n'est PAS un bon résultat",
);
verifier(infos(d1.corps) === undefined, "DAMAFOUILLE : silence entier — aucun bloc ratios_informatifs");

// --- 3. Silence STRUCTUREL : la ligne n'est pas publiée (cause DIFFÉRENTE) --
const d2 = await acheter("3-danone-poste-non-publie", `${api}/v1/score/defaillance/552032534`);
verifier(d2.statut === 200, `DANONE : 200 (lu ${d2.statut})`);
verifier(d2.corps.score_risque === 22, `DANONE : score 22 inchangé (lu ${String(d2.corps.score_risque)})`);
verifier(
  d2.corps.tresorerie_muette === "poste_non_publie",
  `DANONE : cause « poste_non_publie » (lu ${String(d2.corps.tresorerie_muette)})`,
);
// La preuve que les deux causes sont bien DEUX : la note de DANONE ne parle pas
// de la photo amont, celle de DAMAFOUILLE si.
verifier(
  d1.corps.tresorerie_muette !== d2.corps.tresorerie_muette,
  "les deux silences reçoivent deux causes DIFFÉRENTES sur données réelles",
);
verifier(
  !String(d2.corps.note_tresorerie ?? "").includes("photo"),
  "DANONE : la note ne met PAS son silence sur le compte du gel",
);

// --- 4. /v1/comparer : l'asymétrie de l'axe est enfin DITE ------------------
const c = await acheter("4-comparer-asymetrie", `${api}/v1/comparer?sirens=400918041,824498141`);
verifier(c.statut === 200, `COMPARER : 200 (lu ${c.statut})`);
verifier(c.regle !== null, "COMPARER : paiement RÉGLÉ");
const comparabilite = c.corps.comparabilite as Record<string, unknown> | undefined;
const avertissements = (comparabilite?.avertissements ?? []) as Array<Record<string, unknown>>;
const a = avertissements.find((x) => x.code === "axe_tresorerie_indisponible");
verifier(a !== undefined, "COMPARER : avertissement axe_tresorerie_indisponible SERVI");
verifier(
  JSON.stringify(a?.cibles) === JSON.stringify(["824498141"]),
  `COMPARER : cibles nomme la société non couverte (lu ${JSON.stringify(a?.cibles)})`,
);
verifier(a?.portee === "information", `COMPARER : portée information (lu ${String(a?.portee)})`);
verifier(comparabilite?.fiable === true, "COMPARER : le lot reste annoncé fiable");
// L'inversion elle-même, servie : la société NON couverte passe devant.
const classements = c.corps.classements as Record<string, string[]> | undefined;
verifier(
  classements?.risque_le_plus_faible?.[0] === "824498141",
  `COMPARER : le classement place la non couverte en tête (lu ${JSON.stringify(classements?.risque_le_plus_faible)})`,
);
// Et la DATE que l'avertissement promet est réellement dans la réponse.
const provenance = (c.corps.provenance ?? []) as Array<Record<string, unknown>>;
const bloc = provenance.find((p) => String(p.bloc).includes("postes_liasse"));
verifier(bloc !== undefined, "COMPARER : provenance porte le bloc des postes de liasse");
verifier(
  /\d{4}-\d{2}-\d{2}/.test(String(bloc?.as_of ?? "")),
  `COMPARER : as_of est une date de PUBLICATION amont (lu ${String(bloc?.as_of)} / ${String(bloc?.precision_as_of)})`,
);
verifier(
  bloc?.precision_as_of === "publication_officielle",
  `COMPARER : précision « publication_officielle », pas « ingestion » (lu ${String(bloc?.precision_as_of)})`,
);

writeFileSync(
  `${dossier}/verdict.txt`,
  echecs.length === 0 ? "TOUT VERT\n" : `ÉCHECS :\n${echecs.map((e) => `- ${e}`).join("\n")}\n`,
);
console.log(`\n${"=".repeat(70)}`);
console.log(echecs.length === 0 ? "SMOKE VERT" : `SMOKE ROUGE — ${echecs.length} échec(s)`);
for (const e of echecs) console.log(`  - ${e}`);
console.log(`résultats : ${dossier}`);
process.exit(echecs.length === 0 ? 0 : 1);
