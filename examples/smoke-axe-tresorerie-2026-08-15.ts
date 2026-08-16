/**
 * Smoke PAYANT de l'axe TRÉSORERIE NETTE — score `defaillance-v1.8` (15/08/2026).
 *
 * ⚠️ À LANCER SEULEMENT APRÈS L'INGESTION `postes-liasse`. Le code déployé est
 * INERTE tant que la table `postes_liasse` est vide : lancé avant, ce smoke
 * verrait l'axe muet PARTOUT et passerait « au vert » sur les deux cas de
 * silence sans rien prouver du tout — le contrôle à vide que ce projet
 * s'interdit. Vérifier d'abord EN BASE :
 *   select count(*) from postes_liasse;         -- doit être > 0
 *   select version, lignes from ingestions where source like 'postes-liasse%';
 *
 * TROIS ÉPREUVES, choisies pour couvrir les trois COMPORTEMENTS de l'axe — un
 * smoke qui n'achèterait que des silences ne prouverait rien :
 *
 *   1. **BOBION & JOANIN (820954519)** — 0,10 $ : le cas qui a ouvert le
 *      chantier. Vendu 16/sain le 11/08 parce que sa liquidité de 115,7 % ne
 *      coûte rien. Attendu v1.8 : **28 / vigilance**, composante `tresorerie`
 *      à 12 points, ratio 0,76 %.
 *      ⚠️ 28, PAS 31 : le tableau §5.1 de l'étape 0 donne 31 sous le barème
 *      MÉDIAN, qui n'a pas été retenu. Le barème arrêté est le PRUDENT.
 *   2. **ROYAL CANIN SAS (700200983)** — 0,10 $ : l'axe PARLE et ne coûte RIEN
 *      (22,46 % sur l'exercice 2024). Attendu : le ratio est SERVI dans
 *      `ratios_informatifs`, et il n'y a AUCUNE composante `tresorerie`.
 *      C'est l'épreuve qui distingue « la trésorerie va bien » de « nous
 *      n'avons pas la donnée » — les deux se ressemblaient avant la v1.8.
 *   3. **DANONE (552032534)** — 0,10 $ : l'axe est MUET, et pour la BONNE
 *      raison. Ses dettes à moins d'un an sont ABSENTES de la source (ce qui
 *      est écrêté chez elle, c'est le TOTAL des dettes, que l'axe ne lit pas).
 *      Attendu : aucun bloc `ratios_informatifs`, score **22 inchangé**.
 *
 * Total ≈ 0,30 $ (wallet de test 0x9218fd5A…, exclu du revenu réel).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-axe-tresorerie-2026-08-15.ts
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
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-axe-tresorerie-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const echecs: string[] = [];
const verifier = (ok: boolean, quoi: string): void => {
  console.log(`${ok ? "  ok  " : " ÉCHEC"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};

async function acheter(nom: string, url: string): Promise<{ statut: number; brut: string; corps: Record<string, unknown> }> {
  const r = await payer(url);
  const brut = await r.text();
  writeFileSync(`${dossier}/${nom}.json`, `HTTP ${r.status}\n${brut}\n`);
  const regle = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  writeFileSync(`${dossier}/${nom}-reglement.txt`, String(regle ?? "(aucun en-tête de règlement)"));
  let corps: Record<string, unknown> = {};
  try {
    corps = JSON.parse(brut) as Record<string, unknown>;
  } catch {
    /* corps non JSON : les assertions sur `corps` échoueront d'elles-mêmes */
  }
  console.log(`\n— ${nom} → HTTP ${r.status}`);
  return { statut: r.status, brut, corps };
}

type Composante = { axe?: string; indicateur?: string; valeur?: unknown; points?: number };
const composantes = (c: Record<string, unknown>): Composante[] => (c.composantes ?? []) as Composante[];
const tresorerie = (c: Record<string, unknown>): Composante | undefined =>
  composantes(c).find((x) => x.axe === "tresorerie");
const infos = (c: Record<string, unknown>): Record<string, unknown> | undefined =>
  c.ratios_informatifs as Record<string, unknown> | undefined;

// --- 1. BOBION & JOANIN : l'axe PÉNALISE, et fait basculer la bande ---------
const b = await acheter("1-bobion-820954519", `${api}/v1/score/defaillance/820954519`);
verifier(b.statut === 200, `BOBION : réponse 200 (lu ${b.statut})`);
verifier(String(b.corps.version_modele) === "defaillance-v1.8", `BOBION : version_modele v1.8 (lu ${String(b.corps.version_modele)})`);
verifier(b.corps.score_risque === 28, `BOBION : score 28 — barème PRUDENT, pas 31 (lu ${String(b.corps.score_risque)})`);
verifier(b.corps.classe === "vigilance", `BOBION : classe vigilance, plus « sain » (lu ${String(b.corps.classe)})`);
const tb = tresorerie(b.corps);
verifier(tb !== undefined, "BOBION : la composante tresorerie est présente");
verifier(tb?.points === 12, `BOBION : l'axe coûte 12 points (lu ${String(tb?.points)})`);
verifier(Math.abs(Number(tb?.valeur) - 0.76) < 0.01, `BOBION : ratio 0,76 % (lu ${String(tb?.valeur)})`);
// Le MÊME fait, au MÊME arrondi, dans le bloc informatif : une divergence ici
// serait un même fait dit deux fois différemment dans une seule réponse.
verifier(
  infos(b.corps)?.tresorerie_nette_sur_dettes_court_terme_pourcent === tb?.valeur,
  "BOBION : le bloc informatif porte EXACTEMENT la valeur de la composante",
);
// La liquidité, elle, ne coûte toujours rien : l'axe n'est pas un doublon.
verifier(
  !composantes(b.corps).some((x) => String(x.indicateur).startsWith("ratio_liquidite")),
  "BOBION : le ratio de liquidité ne coûte toujours RIEN (l'axe voit ce qu'il ne voit pas)",
);

// --- 2. ROYAL CANIN : l'axe PARLE et ne coûte RIEN --------------------------
const rc = await acheter("2-royal-canin-700200983", `${api}/v1/score/defaillance/700200983`);
verifier(rc.statut === 200, `ROYAL CANIN : réponse 200 (lu ${rc.statut})`);
const taux = infos(rc.corps)?.tresorerie_nette_sur_dettes_court_terme_pourcent;
verifier(taux !== undefined, "ROYAL CANIN : le ratio est SERVI bien qu'il ne pénalise pas");
verifier(Math.abs(Number(taux) - 22.46) < 0.5, `ROYAL CANIN : ratio ≈ 22,46 % (lu ${String(taux)})`);
verifier(tresorerie(rc.corps) === undefined, "ROYAL CANIN : AUCUNE composante tresorerie — l'axe ne coûte rien");
verifier(
  typeof infos(rc.corps)?.note_tresorerie === "string",
  "ROYAL CANIN : la note dit dans quel cas le ratio pèse, et dans quel cas il ne pèse pas",
);

// --- 3. DANONE : l'axe est MUET, pour la BONNE raison ----------------------
const d = await acheter("3-danone-552032534", `${api}/v1/score/defaillance/552032534`);
verifier(d.statut === 200, `DANONE : réponse 200 (lu ${d.statut})`);
verifier(d.corps.score_risque === 22, `DANONE : score 22 INCHANGÉ par la v1.8 (lu ${String(d.corps.score_risque)})`);
verifier(d.corps.classe === "sain", `DANONE : classe sain inchangée (lu ${String(d.corps.classe)})`);
verifier(tresorerie(d.corps) === undefined, "DANONE : aucune composante tresorerie");
// Le silence doit être TOTAL : servir la note sans le ratio, ou un bloc vide,
// laisserait croire à une donnée qui n'existe pas.
verifier(infos(d.corps) === undefined, "DANONE : aucun bloc ratios_informatifs — le silence est entier, pas un bloc vide");
verifier(
  !d.brut.includes("tresorerie_nette_sur_dettes_court_terme"),
  "DANONE : le ratio n'apparaît nulle part dans la réponse",
);

// --- 4. NON-RÉGRESSION : les autres verdicts ACHETÉS le 11/08 --------------
// Les six dossiers connus de CDU ont été achetés le 11/08 sous la v1.5. Trois
// sont déjà couverts ci-dessus ; les quatre autres sont rejoués ici pour que la
// v1.8 ne se contente pas d'être juste sur son cas cible.
//
// ⚠️ Ces quatre-là sortent inchangées parce que l'axe est MUET (parquet en
// retard pour AIRVANCE, dettes à moins d'un an absentes pour STELLANTIS et BEL,
// bilan simplifié pour VERA). Ce sont donc des non-régressions par SILENCE, et
// c'est précisément pourquoi elles ne suffisent pas : l'épreuve 2 (ROYAL CANIN)
// est celle qui prouve que l'axe s'exécute et conclut « rien à signaler ».
const NON_REGRESSIONS: Array<{ siren: string; nom: string; score: number; classe: string }> = [
  { siren: "490586708", nom: "AIRVANCE GROUP", score: 18, classe: "sain" },
  { siren: "542065479", nom: "STELLANTIS AUTOMOBILES", score: 42, classe: "vigilance" },
  { siren: "818813172", nom: "VERA BIJOUX", score: 0, classe: "sain" },
  { siren: "481070803", nom: "BEL", score: 18, classe: "sain" },
];
for (const [i, c] of NON_REGRESSIONS.entries()) {
  const r = await acheter(`4-${i + 1}-non-regression-${c.siren}`, `${api}/v1/score/defaillance/${c.siren}`);
  verifier(r.statut === 200, `${c.nom} : réponse 200 (lu ${r.statut})`);
  verifier(r.corps.score_risque === c.score, `${c.nom} : score ${c.score} inchangé (lu ${String(r.corps.score_risque)})`);
  verifier(r.corps.classe === c.classe, `${c.nom} : classe ${c.classe} inchangée (lu ${String(r.corps.classe)})`);
  verifier(String(r.corps.version_modele) === "defaillance-v1.8", `${c.nom} : version_modele v1.8`);
}

writeFileSync(
  `${dossier}/verdict.txt`,
  echecs.length === 0 ? "TOUT VERT\n" : `ÉCHECS :\n${echecs.map((e) => `- ${e}`).join("\n")}\n`,
);
console.log(`\n${"=".repeat(70)}`);
console.log(echecs.length === 0 ? "SMOKE VERT" : `SMOKE ROUGE — ${echecs.length} échec(s)`);
for (const e of echecs) console.log(`  - ${e}`);
console.log(`résultats : ${dossier}`);
process.exit(echecs.length === 0 ? 0 : 1);
