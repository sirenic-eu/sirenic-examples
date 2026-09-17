/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 6 Europe — Lituanie, pays neuf, étape 0 du
 * 17/09/2026, livraison du 17/09/2026). BUT : prouver EN PRODUCTION, par des achats
 * réels, que (1) la fiche lituanienne est servie depuis les photos quotidiennes de
 * data.gov.lt avec ses blocs `registre_lt` (capital, TVA, obligations de dépôt,
 * associés comptés) et `fiscalite_lt` (arriérés du jour ou absence mesurée, impôts
 * payés), la commune seule en guise d'adresse ; (2) les comptes annuels servent
 * tous les exercices avec les dix postes en liste fermée, états sociaux et
 * consolidés séparés (AB Grigeo Group) ; (3) l'insolvabilité lit le statut du
 * registre ET les dossiers AVNT (IS FASHION BALTIC : liquidation pour cause de
 * faillite, dossier ouvert le 30/07/2024) ; (4) une entreprise individuelle
 * anonymisée par le registre est servie sous le nom publié par lui, jamais un nom
 * de personne ; (5) un code JAR inconnu et un code mal formé ne règlent rien. À
 * lancer APRÈS la première ingestion complète des cinq jeux (timer 05:10 UTC ou
 * passage manuel) — avant, fiche et routes rendent 503 et rien n'est débité.
 * COÛT estimé : 0,01 + 0,02 + 0,02 + 0,02 + 0,01 = 0,08 $ (USDC, Base mainnet) ; les 400/404 ne règlent rien.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-lituanie-tranche6-2026-09-17.ts <commit attendu>
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
const dossier = "resultats/2026-09-17-controle-lituanie-tranche6";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 6 Europe, Lituanie (17/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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
const liste = (v: unknown): Corps[] => (Array.isArray(v) ? (v as Corps[]) : []);
/** Un nom de personne physique que la source VMI/AVNT publie et que Sirenic ne sert jamais : la dénomination
 *  d'une IĮ vient du registre, qui la remplace par le libellé de la forme. */
const NOM_DE_PERSONNE_II = /ĮMONĖ$|IMONE$/i;

// UAB Autotitanas : fiche avec les deux blocs, commune seule, TVA radiée non servie comme identifiant courant.
await achat("LT_304500803_fiche", "https://api.sirenic.eu/v1/eu/entreprise/LT/304500803", 0.01, (corps) => {
  const r = corps.registre_lt as Corps | undefined;
  const f = corps.fiscalite_lt as Corps | undefined;
  const adresse = corps.adresse_siege as Corps | undefined;
  return [
    ok(corps.pays === "LT" && String(corps.denomination).includes("Autotitanas") && corps.statut === "actif", `sujet ${String(corps.denomination)} (${String(corps.statut)})`),
    ok(adresse?.adresse === null && adresse?.code_postal === null && typeof adresse?.ville === "string", `adresse : commune seule (${String(adresse?.ville)}), rue et code postal null`),
    ok(r?.statut === "servi" && r.adresse_non_publiee_sous_licence_ouverte === true && r.denomination_anonymisee === false, `registre_lt servi, adresse non publiée dite, nom non anonymisé`),
    ok(typeof (r?.capital as Corps | null)?.montant === "number", `capital : ${JSON.stringify(r?.capital)}`),
    ok(typeof ((r?.contribuable as Corps | undefined)?.tva as Corps | null)?.numero === "string", `contribuable : TVA ${JSON.stringify((r?.contribuable as Corps | undefined)?.tva)}, commune ${JSON.stringify((r?.contribuable as Corps | undefined)?.commune)}`),
    ok(typeof (r?.obligations_comptables as Corps | undefined)?.en_regle_selon_registre === "boolean", `obligations comptables : ${JSON.stringify(r?.obligations_comptables)}`),
    ok(typeof (r?.associes_par_categorie as Corps | null)?.personnes_physiques_lituaniennes === "number", `associés comptés par catégorie : ${JSON.stringify(r?.associes_par_categorie)}`),
    ok(f?.statut === "servi" && typeof f.aucun_arriere_publie === "boolean", `fiscalite_lt servi : arriérés ${JSON.stringify(f?.arrieres)}, aucun_arriere_publie ${String(f?.aucun_arriere_publie)}`),
    ok(entree(corps, "registre_lt")?.etat === "servi" && entree(corps, "registre_lt")?.source_code === "jar_lt", `provenance[registre_lt] = ${String(entree(corps, "registre_lt")?.etat)} / ${String(entree(corps, "registre_lt")?.source_code)}`),
    ok(["servi", "absence_mesuree"].includes(String(entree(corps, "fiscalite_lt")?.etat)), `provenance[fiscalite_lt] = ${String(entree(corps, "fiscalite_lt")?.etat)}`),
    ok(entree(corps, "fiche")?.source_code === "jar_lt", `provenance[fiche] = ${String(entree(corps, "fiche")?.source_code)}`),
  ];
});

// AB Grigeo Group : comptes sociaux ET consolidés, jamais fusionnés.
await achat("LT_110012450_comptes", "https://api.sirenic.eu/v1/eu/entreprise/LT/110012450/comptes", 0.02, (corps) => {
  const ex = liste(corps.exercices);
  const consolides = ex.filter((e) => e.consolide === true);
  const sociaux = ex.filter((e) => e.consolide === false);
  const dernier = ex[0];
  return [
    ok(ex.length >= 8 && Number(corps.nombre_exercices) === ex.length, `${ex.length} exercices servis (compte ${String(corps.nombre_exercices)}), dernier ${String(corps.dernier_exercice)}`),
    ok(consolides.length >= 1 && sociaux.length >= 1, `${sociaux.length} exercices sociaux, ${consolides.length} consolidés, tenus séparés`),
    ok(typeof (dernier?.bilan as Corps | undefined)?.actif_courant === "number" && typeof (dernier?.compte_resultat as Corps | undefined)?.resultat_net === "number", `dernier exercice : bilan ${JSON.stringify(dernier?.bilan)}, résultat ${JSON.stringify(dernier?.compte_resultat)}`),
    ok(ex.every((e) => e.devise === "EUR" && liste(e.etats).length >= 1 && Array.isArray(e.postes_divergents)), `chaque exercice : EUR, états déposés listés, postes_divergents présent`),
    ok(String(corps.licence).includes("Creative Commons Attribution 4.0"), `licence CC BY 4.0 servie`),
    ok(entree(corps, "exercices")?.etat === "servi" && entree(corps, "exercices")?.source_code === "jar_comptes_lt" && (entree(corps, "exercices")?.couverture as Corps | undefined)?.etat === "partielle", `provenance[exercices] = ${String(entree(corps, "exercices")?.etat)} / couverture ${String((entree(corps, "exercices")?.couverture as Corps | undefined)?.etat)}`),
  ];
});

// IS FASHION BALTIC : statut 26 au registre + dossier AVNT (faillite du 30/07/2024, liquidation le 14/01/2025).
await achat("LT_110518825_insolvabilite", "https://api.sirenic.eu/v1/eu/entreprise/LT/110518825/insolvabilite", 0.02, (corps) => {
  const p = liste(corps.procedures);
  const faillite = p.find((x) => x.nature === "faillite");
  const statut = corps.statut_registre as Corps | undefined;
  return [
    ok(corps.procedure_au_registre === true && statut?.famille === "faillite" && Number(statut?.code) === 26, `statut du registre : code ${String(statut?.code)} (${String(statut?.fr)}, depuis ${String(statut?.depuis)})`),
    ok(corps.aucune_procedure === false && p.length >= 1 && Number(corps.nombre_procedures) === p.length, `${p.length} dossier(s) AVNT (compte ${String(corps.nombre_procedures)})`),
    ok(faillite?.ouverture_le === "2024-07-30" && faillite?.tribunal === "Kauno apygardos teismas" && typeof faillite?.initiateur === "string", `faillite ouverte le ${String(faillite?.ouverture_le)} (${String(faillite?.tribunal)}, initiateur ${String(faillite?.initiateur)})`),
    ok(typeof faillite?.en_cours === "boolean" && (faillite?.liquidation_le === "2025-01-14" || typeof faillite?.liquidation_le === "string"), `liquidation_le ${String(faillite?.liquidation_le)}, en_cours ${String(faillite?.en_cours)}`),
    ok(!JSON.stringify(p).includes("imones_pavadinimas") && p.every((x) => !("denomination" in x)), `aucune raison sociale AVNT dans les dossiers (la dénomination vient du registre : ${String(corps.denomination)})`),
    ok(typeof (corps.photo as Corps | undefined)?.registre === "string" && typeof (corps.photo as Corps | undefined)?.avnt === "string", `photos : ${JSON.stringify(corps.photo)}`),
    ok(entree(corps, "procedure_au_registre")?.etat === "servi" && entree(corps, "procedures")?.etat === "servi", `provenance[procedure_au_registre] = ${String(entree(corps, "procedure_au_registre")?.etat)}, provenance[procedures] = ${String(entree(corps, "procedures")?.etat)}`),
  ];
});

// Une société sans procédure : aucune_procedure est un fait mesuré sur les deux photos.
await achat("LT_304500803_insolvabilite_aucune", "https://api.sirenic.eu/v1/eu/entreprise/LT/304500803/insolvabilite", 0.02, (corps) => [
  ok(corps.aucune_procedure === true && corps.procedure_au_registre === false && Number(corps.nombre_procedures) === 0, `aucune_procedure ${String(corps.aucune_procedure)} (statut ${String((corps.statut_registre as Corps | undefined)?.code)})`),
  ok(entree(corps, "procedure_au_registre")?.etat === "absence_mesuree" && entree(corps, "procedures")?.etat === "absence_non_conclusive", `provenance : registre ${String(entree(corps, "procedure_au_registre")?.etat)}, AVNT ${String(entree(corps, "procedures")?.etat)} (dossiers depuis 2020 seulement)`),
]);

// Une IĮ anonymisée par le registre : servie sous le nom publié (le libellé de la forme), jamais un nom de personne.
await achat("LT_111485050_ii_anonymisee", "https://api.sirenic.eu/v1/eu/entreprise/LT/111485050", 0.01, (corps) => {
  const r = corps.registre_lt as Corps | undefined;
  return [
    ok(String(corps.denomination) === "Individuali įmonė" && r?.denomination_anonymisee === true, `dénomination servie : « ${String(corps.denomination)} », denomination_anonymisee ${String(r?.denomination_anonymisee)}`),
    ok(!NOM_DE_PERSONNE_II.test(String(corps.denomination)) && !/[A-ZĄČĘĖĮŠŲŪŽ]\. [A-ZĄČĘĖĮŠŲŪŽ]/.test(JSON.stringify(corps)), `aucun nom de personne dans la réponse`),
    ok(corps.statut === "autre" && (r?.etat as Corps | undefined)?.famille === "faillite", `statut ${String(corps.statut)} — ${String((r?.etat as Corps | undefined)?.fr)}`),
  ];
});

// Un code mal formé (400) et un code inconnu (404) : rien n'est réglé.
await achat("LT_12345_mal_forme", "https://api.sirenic.eu/v1/eu/entreprise/LT/12345/comptes", 0.02, (corps, statut, regle) => [
  ok(statut === 400 && corps.error === "identifiant_invalide", `code mal formé : HTTP ${statut}, ${String(corps.error)}`),
  ok(!regle, `aucun règlement`),
]);
await achat("LT_999999999_inconnu", "https://api.sirenic.eu/v1/eu/entreprise/LT/999999999/insolvabilite", 0.02, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_inconnue", `code inconnu : HTTP ${statut}, ${String(corps.error)}`),
  ok(!regle, `paiement annulé (aucun règlement)`),
]);

L(`**Dépense** : ${depense.toFixed(2)} $ (${compte.address})`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
