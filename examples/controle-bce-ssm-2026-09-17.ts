/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 3 Europe « superviseurs » — liste BCE/SSM et
 * administrateurs d'indices ESMA derrière /v1/eu/agrements, livraison du
 * 17/09/2026). BUT : prouver EN PRODUCTION, par des achats réels, que (1) BNP
 * Paribas par LEI reçoit les trois registres : MiFID, liste BCE (tête du groupe
 * 54, significative, supervision directe) et administrateur d'indices, enveloppe
 * COMPLÈTE par LEI ; (2) « Crelan » par nom reçoit le groupe belge avec son
 * entité française, couverture non mesurable par nom ; (3) Swedbank AB par LEI
 * (Suède, hors union bancaire) rend une absence MESURÉE sur la liste BCE (zéro
 * conclusif par LEI) — et jamais « non supervisée » (règle de lecture) ;
 * `blocs_absents` vide partout. À lancer APRÈS la première ingestion.
 * COÛT estimé : 0,01 × 3 = 0,03 $ (USDC, Base mainnet).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-bce-ssm-2026-09-17.ts <commit attendu>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const attendu = process.argv[2];
if (!attendu) throw new Error("commit attendu manquant (argument 1)");
const sante = (await (await fetch("https://api.sirenic.eu/healthz")).json()) as { commit: string };
if (sante.commit !== attendu) throw new Error(`la production sert ${sante.commit}, attendu ${attendu} : aucun achat`);

const compte = privateKeyToAccount(process.env.TEST_WALLET_KEY as `0x${string}`);
const c = new x402Client(); registerExactEvmScheme(c, { signer: compte });
const payer = wrapFetchWithPayment(fetch, c) as typeof fetch;
const dossier = "resultats/2026-09-17-controle-bce-ssm";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 3 Europe, liste BCE/SSM + administrateurs d'indices ESMA (17/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
const L = (x: string) => { lignes.push(x); console.log(x); };
let depense = 0;

type Corps = Record<string, unknown>;
async function achat(nom: string, url: string, prix: number, verifier: (corps: Corps, statut: number, regle: boolean) => string[]) {
  const r = await payer(url);
  const texte = await r.text();
  writeFileSync(`${dossier}/${nom}.json`, texte);
  const regle = !!r.headers.get("payment-response");
  if (regle) depense += prix;
  let constats: string[] = [];
  try { constats = verifier(JSON.parse(texte) as Corps, r.status, regle); } catch (e) { constats = [`corps illisible : ${String(e)}`]; }
  L(`## ${nom} — HTTP ${r.status}, réglé ${regle ? "oui" : "NON"}, ${texte.length} o`);
  for (const x of constats) L(`- ${x}`);
  L(``);
}
const entree = (corps: Corps, nom: string) => (corps.provenance as Array<Corps> | undefined)?.find((e) => e.bloc === nom);
const ok = (b: boolean, texte: string) => `${b ? "✅" : "❌"} ${texte}`;
const objet = (v: unknown): Corps => (v && typeof v === "object" ? (v as Corps) : {});
const liste = (v: unknown): Corps[] => (Array.isArray(v) ? (v as Corps[]) : []);
const commun = (corps: Corps): string[] => [
  ok(liste(corps.blocs_absents).length === 0 && Object.keys(objet(corps.sources)).length === 3, `blocs_absents vide, trois sources attribuées (BCE citée, ESMA gratuit à la source)`),
  ok(String(objet(corps.sources).supervision_bce).includes("ECB cited") && String(objet(corps.sources).administrateurs_indices).includes("freely available"), `mentions de licence servies`),
  ok(!/@|telephone|streetAddress/i.test(JSON.stringify(objet(corps.supervision_bce))), `liste BCE : ni contact ni adresse`),
  ok(String(objet(objet(corps.supervision_bce).photo).version) === "202608" && String(objet(objet(corps.supervision_bce).photo).cut_off).length > 0, `photo BCE : version ${String(objet(objet(corps.supervision_bce).photo).version)}, butoir « ${String(objet(objet(corps.supervision_bce).photo).cut_off)} », ${String(objet(objet(corps.supervision_bce).photo).entites_significatives)} significatives + ${String(objet(objet(corps.supervision_bce).photo).entites_moins_significatives)} moins significatives`),
];

// (1) BNP Paribas S.A. par LEI : tête du groupe 54 (significative), administrateur d'indices (art. 34, AMF), MiFID.
await achat("LEI_R0MUWSFPU8MPRO8K5P83_BNP", "https://api.sirenic.eu/v1/eu/agrements?q=R0MUWSFPU8MPRO8K5P83", 0.01, (corps) => {
  const ssm = objet(corps.supervision_bce); const e = objet(liste(ssm.entites)[0]); const adm = objet(liste(objet(corps.administrateurs_indices).administrateurs)[0]);
  return [
    ok(Number(ssm.nombre_total) === 1 && e.categorie === "significative" && e.groupe_tete === true && e.groupe_numero === 54 && e.type_entite === "CI", `liste BCE : ${String(e.nom)}, ${String(e.categorie)}, groupe ${String(e.groupe_numero)} (tête), ${String(e.motif_importance)}`),
    ok(String(e.supervision).includes("directe") && String(e.libelle_type).includes("établissement de crédit"), `supervision ${String(e.supervision)}`),
    ok(String(adm.nom).toUpperCase() === "BNP PARIBAS" && String(adm.statut_ue_eee).includes("Art. 34"), `administrateur d'indices : ${String(adm.nom)}, ${String(adm.statut_ue_eee)}, ${String(adm.autorite_ue_eee)}, ${String(adm.nombre_indices)} indice(s)`),
    ok(Number(corps.nombre_total) >= 1, `${String(corps.nombre_total)} entité(s) MiFID`),
    ...commun(corps),
    ok(objet(entree(corps, "supervision_bce")?.couverture).etat === "complete" && entree(corps, "supervision_bce")?.etat === "servi" && typeof entree(corps, "supervision_bce")?.age_jours === "number", `provenance[supervision_bce] = ${String(entree(corps, "supervision_bce")?.etat)}, couverture complète (LEI), âge ${String(entree(corps, "supervision_bce")?.age_jours)} j`),
    ok(objet(entree(corps, "administrateurs_indices")?.couverture).etat === "complete", `provenance[administrateurs_indices] couverture complète (LEI)`),
  ];
});

// (2) « Crelan » par nom : groupe belge 2 (Crelan SA tête, Crelan Home Loan SCF en France) ; couverture NON mesurable par nom.
await achat("nom_Crelan", "https://api.sirenic.eu/v1/eu/agrements?q=Crelan", 0.01, (corps) => {
  const ents = liste(objet(corps.supervision_bce).entites);
  return [
    ok(ents.length >= 2 && ents.some((e) => e.groupe_tete === true) && ents.some((e) => e.pays_etablissement === "France"), `liste BCE : ${ents.length} entités du groupe Crelan — ${ents.map((e) => `${String(e.nom)} (${String(e.pays_etablissement)})`).join(" ; ")}`),
    ok(objet(entree(corps, "supervision_bce")?.couverture).etat === "non_mesurable", `provenance[supervision_bce] couverture non mesurable (recherche par nom)`),
    ...commun(corps),
  ];
});

// (3) Swedbank AB par LEI (M312WZV08Y7LYUC71685) : Suède, hors union bancaire → zéro MESURÉ sur la liste BCE, jamais « non supervisée ».
await achat("LEI_M312WZV08Y7LYUC71685_Swedbank", "https://api.sirenic.eu/v1/eu/agrements?q=M312WZV08Y7LYUC71685", 0.01, (corps) => [
  ok(Number(objet(corps.supervision_bce).nombre_total) === 0, `liste BCE : 0 entité (Suède hors union bancaire)`),
  ok(entree(corps, "supervision_bce")?.etat === "absence_mesuree", `provenance[supervision_bce] = ${String(entree(corps, "supervision_bce")?.etat)} (zéro conclusif par LEI)`),
  ...commun(corps),
]);

L(`**Dépense totale : ${depense.toFixed(2)} $** (attendu 0,03 $ : trois achats à 0,01 $).`);
writeFileSync(`${dossier}/RAPPORT.md`, lignes.join("\n") + "\n");
console.log(`\nrapport : ${dossier}/RAPPORT.md`);
