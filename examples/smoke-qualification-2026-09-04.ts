/**
 * Smoke PAYANT — « Qualifier avant de servir » est-il vraiment en PRODUCTION ?
 * (chantier livré le 04/09/2026, décision CDU « tout, sans dette technique »)
 *
 * Le cas est celui du test externe du 01/09/2026 : ORANGE, SIREN 380129866.
 * La suite de tests prouve que le code qualifie ; seul un ACHAT prouve que la
 * PROD sert. Chaque épreuve rejoue un constat mesuré ce jour-là.
 *
 *   1. /finances — 0,01 $. UNE ligne par clôture (plus deux lignes 2019, plus
 *      deux 2016) ; la ligne 2019 saisie en millions et la ligne 2018 copie du
 *      consolidé sont SERVIES dans `exercices_ecartes` avec leur motif ; chaque
 *      exercice porte `qualite` ; le consolidé est qualifié lui aussi et sa
 *      liquidité « 0 » est servie null, nommée dans `champs_non_renseignes`.
 *   2. /alertes — 0,01 $. 202 annonces : `couverture` dit le total et garantit
 *      que les procédures collectives ont été relues en ENTIER ; la dénomination
 *      est celle de Sirene (plus « ORANGE STORE, Orange »).
 *   3. /score/defaillance — 0,10 $. `echelle` dit que 17 ne sont pas 17 % ;
 *      `perimetre_comptable` et `qualite_exercice_reference` sont servis.
 *   4. /sanctions/check?name=ORANGE — 0,01 $. « ORANGE VOLUNTEERS » reste
 *      « forte » (détecteur de candidats) mais porte `qualification:
 *      nom_englobant`, et le lexique est servi.
 *   5. /regulateurs/fr/alertes?siren=380129866 — 0,01 $. Sans nom, la liste
 *      noire est criblée avec la dénomination Sirene : `requete.nom_sirene`.
 *   6. GRATUIT : le devis 402 de /finances annonce `qualite` et
 *      `exercices_ecartes`.
 *
 * Coût réel attendu ≈ 0,14 $. Wallet de test 0x9218fd5A… — exclu du revenu réel.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-qualification-2026-09-04.ts
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
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-qualification-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const echecs: string[] = [];
const verifier = (ok: boolean, quoi: string): void => {
  console.log(`${ok ? "  ok  " : " ÉCHEC"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};

async function acheter(nom: string, url: string) {
  const r = await payer(url);
  const brut = await r.text();
  writeFileSync(`${dossier}/${nom}.json`, `HTTP ${r.status}\n${url}\n${brut}\n`);
  const regle = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  writeFileSync(`${dossier}/${nom}-reglement.txt`, String(regle ?? "(aucun en-tête de règlement)"));
  let corps: Record<string, any> = {};
  try {
    corps = JSON.parse(brut) as Record<string, any>;
  } catch {
    /* corps non JSON : les assertions échoueront d'elles-mêmes */
  }
  console.log(`\n— ${nom} → HTTP ${r.status}${regle ? " (réglé)" : ""}`);
  return { statut: r.status, corps, regle };
}

const ORANGE = "380129866";

// --- 1. /finances : une ligne par clôture, écartées servies, consolidé qualifié
const f = await acheter("1-orange-finances", `${api}/v1/entreprise/${ORANGE}/finances`);
verifier(f.statut === 200 && Boolean(f.regle), "finances : 200 réglé");
const exercices: Array<Record<string, any>> = f.corps.exercices ?? [];
const dates = exercices.map((e) => e.date_cloture);
verifier(new Set(dates).size === dates.length && dates.length >= 7, `finances : ${dates.length} exercices, une seule ligne par clôture`);
verifier(exercices.every((e) => e.qualite && ["exploitable", "a_verifier", "non_exploitable"].includes(e.qualite.fiabilite)), "finances : chaque exercice porte qualite.fiabilite");
const ecartes: Array<Record<string, any>> = f.corps.exercices_ecartes ?? [];
const codesEcartes = ecartes.flatMap((e) => e.qualite?.anomalies ?? []);
verifier(codesEcartes.includes("unite_incoherente_avec_la_jumelle"), "finances : la ligne 2019 en millions est écartée (unite_incoherente_avec_la_jumelle)");
verifier(codesEcartes.includes("copie_du_perimetre_consolide"), "finances : la ligne 2018 copie du groupe est écartée (copie_du_perimetre_consolide)");
verifier(ecartes.every((e) => e.motif_ecart && e.formulaire), "finances : chaque écartée porte formulaire et motif");
const ref2019 = exercices.find((e) => e.date_cloture === "2019-12-31");
verifier(ref2019?.qualite?.anomalies?.includes("ebe_superieur_au_ca") === true, "finances : 2019 servie, à vérifier sur l'EBE (185 % du CA)");
verifier(!exercices.some((e) => e.date_cloture === "2018-12-31"), "finances : plus de « point haut » 2018 à 41,38 Md€ dans la série sociale");
const k: Array<Record<string, any>> = f.corps.comptes_consolides?.exercices ?? [];
verifier(k.length >= 9 && k.every((e) => e.qualite), "finances : le consolidé est qualifié");
const k2024 = k.find((e) => e.date_cloture === "2024-12-31");
verifier(k2024?.ratios?.ratio_liquidite === null && k2024?.qualite?.champs_non_renseignes?.includes("ratio_liquidite") === true, "finances : liquidité 0 du consolidé servie null et nommée");
verifier(typeof f.corps.qualification?.anomalies === "object" && "copie_du_perimetre_consolide" in f.corps.qualification.anomalies, "finances : le lexique ne porte que les codes présents, dont la copie du consolidé");
verifier(String(f.corps.disclaimer ?? "").includes("qualification"), "finances : le disclaimer renvoie à `qualification`");

// --- 2. /alertes : couverture et dénomination Sirene ---------------------------
const a = await acheter("2-orange-alertes", `${api}/v1/entreprise/${ORANGE}/alertes`);
verifier(a.statut === 200 && Boolean(a.regle), "alertes : 200 réglé");
verifier(a.corps.couverture?.annonces_total >= 200, `alertes : ${a.corps.couverture?.annonces_total} annonces au total`);
verifier(a.corps.couverture?.procedures_collectives_completes === true, "alertes : les procédures collectives ont été relues en entier");
verifier(a.corps.denomination === "ORANGE" && a.corps.denomination_source === "sirene", `alertes : dénomination Sirene « ${a.corps.denomination} » (plus ORANGE STORE)`);
verifier((a.corps.ventes_cessions ?? []).every((x: Record<string, unknown>) => "libelle_annonce" in x), "alertes : chaque annonce garde son libellé");

// --- 3. /score : échelle, périmètre, qualité de la référence -------------------
const s = await acheter("3-orange-score", `${api}/v1/score/defaillance/${ORANGE}`);
verifier(s.statut === 200 && Boolean(s.regle), "score : 200 réglé");
verifier(s.corps.echelle?.est_une_probabilite === false && s.corps.echelle?.maximum === 100, `score : ${s.corps.score_risque} points sur 100, pas une probabilité`);
verifier(s.corps.perimetre_comptable === "social", "score : périmètre social servi");
verifier(typeof s.corps.qualite_exercice_reference?.fiabilite === "string", `score : qualité de la référence servie (${s.corps.qualite_exercice_reference?.fiabilite})`);

// --- 4. /sanctions/check : la qualification est publiée -----------------------
const c = await acheter("4-orange-sanctions", `${api}/v1/sanctions/check?name=ORANGE`);
verifier(c.statut === 200 && Boolean(c.regle), "sanctions : 200 réglé");
const corr: Array<Record<string, any>> = c.corps.correspondances ?? [];
verifier(corr.length > 0 && corr.every((x) => typeof x.qualification === "string"), "sanctions : chaque correspondance porte sa qualification");
const volunteers = corr.find((x) => String(x.nom_correspondant).toUpperCase().includes("ORANGE VOLUNTEERS"));
verifier(volunteers?.niveau === "forte" && volunteers?.qualification === "nom_englobant", "sanctions : ORANGE VOLUNTEERS reste forte mais qualifiée « nom englobant »");
verifier(typeof c.corps.lexique_qualifications === "object" && typeof c.corps.note_qualification === "string", "sanctions : lexique et note de qualification servis");

// --- 5. /regulateurs/fr/alertes : la liste noire criblée par le SIREN ----------
const m = await acheter("5-orange-amf", `${api}/v1/regulateurs/fr/alertes?siren=${ORANGE}`);
verifier(m.statut === 200 && Boolean(m.regle), "AMF : 200 réglé");
verifier(m.corps.requete?.nom_sirene === "ORANGE", `AMF : dénomination Sirene résolue et criblée (« ${m.corps.requete?.nom_sirene} »)`);

// --- 6. GRATUIT : le devis dit ce qui est vendu -------------------------------
const devis = await fetch(`${api}/v1/entreprise/${ORANGE}/finances`);
const devisTexte = await devis.text();
writeFileSync(`${dossier}/6-devis-finances.txt`, `HTTP ${devis.status}\n${devisTexte}\n`);
verifier(devis.status === 402 && devisTexte.includes("qualite") && devisTexte.includes("exercices_ecartes"), "devis 402 : annonce qualite et exercices_ecartes");

writeFileSync(`${dossier}/RECAP.md`, `# Smoke qualification — ${horodatage}\n\n${echecs.length === 0 ? "✅ tout vert" : `❌ ${echecs.length} échec(s)\n\n- ${echecs.join("\n- ")}`}\n\nCoût attendu ≈ 0,14 $ (5 achats). Dossier : ${dossier}\n`);
console.log(`\n${echecs.length === 0 ? "✅" : "❌"} ${echecs.length} échec(s) — résultats dans ${dossier}`);
process.exit(echecs.length === 0 ? 0 : 1);
