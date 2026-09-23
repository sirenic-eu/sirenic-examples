/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 6 Europe — Lituanie, pays neuf, étape 0 du
 * 17/09/2026, livraison du 17/09/2026 ; version corrigée pour le ticket #98 le 23/09/2026).
 * BUT : prouver EN PRODUCTION, par des achats réels, que (1) la fiche d'UAB « Autotitanas »
 * (304500803) est servie depuis les photos quotidiennes de data.gov.lt avec ses blocs
 * `registre_lt` (capital, TVA, obligations de dépôt, associés comptés) et `fiscalite_lt`
 * (arriérés du jour ou absence mesurée, impôts payés), la commune seule en guise d'adresse ;
 * (2) les comptes annuels d'Autotitanas servent ses huit exercices avec des VALEURS RÉELLES
 * (exercice 2022 : actif non courant 1 415, actif courant 3 835, total 5 250, capitaux propres
 * 3 690, dettes 1 560, chiffre d'affaires 7 301, résultat avant impôt et net 3 000, déposé le
 * 16/05/2023 — lignes lt_comptes de la photo du 18/09/2026) ; (3) l'insolvabilité d'IS FASHION
 * BALTIC (110518825) lit le statut du registre ET le dossier AVNT (liquidation pour cause de
 * faillite, dossier ouvert le 30/07/2024) ; (4) l'IĮ 111485050, anonymisée par le registre, est
 * servie EXACTEMENT comme l'a décidé l'étape 0 (décision 2A) : le nom tel que le JAR le publie,
 * « Individuali įmonė », avec `denomination_anonymisee: true`, jamais le nom VMI ni AVNT ;
 * (5) un code JAR inconnu (404) et un code mal formé (400) ne règlent rien.
 * Chaque appel servi asserte le corps, `provenance[]` et le PRIX signé (option USDC du devis,
 * égale à la grille) ; le solde USDC est lu avant et après (stabilisé) pour prouver la dépense.
 * État de la collecte : cinq suivis en succès le 23/09/2026 entre 05:13 et 05:17 UTC (journal de
 * prod ; comptes en incrément quotidien).
 * COÛT estimé : 0,01 + 0,02 + 0,02 + 0,01 = 0,06 $ (USDC, Base mainnet), + 0,04 $ de compléments
 * (comptes sociaux ET consolidés d'AB Grigeo Group 110012450 ; absence de procédure d'Autotitanas)
 * sauf avec `--sans-complements` ; le 400 et le 404 ne règlent rien. Total : 0,10 $ (0,06 $ sans complément).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-lituanie-tranche6-2026-09-17.ts <commit attendu> [--sans-complements]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, erc20Abi } from "viem";
import { base } from "viem/chains";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const attendu = process.argv[2];
if (!attendu || attendu.startsWith("--")) throw new Error("commit attendu manquant (argument 1)");
const avecComplements = !process.argv.includes("--sans-complements");
const sante = (await (await fetch("https://api.sirenic.eu/healthz")).json()) as { commit: string };
if (sante.commit !== attendu) throw new Error(`la production sert ${sante.commit}, attendu ${attendu} : aucun achat`);

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
/** Prix le plus élevé de la campagne : un devis au-delà est refusé AVANT signature. */
const PLAFOND_APPEL_USD = 0.02;
const compte = privateKeyToAccount(process.env.TEST_WALLET_KEY as `0x${string}`);
/** Montant de l'option USDC signée pour l'appel en cours (null : aucun devis présenté). */
const capture: { devis: number | null } = { devis: null };
const devisSigne = (): number | null => capture.devis;
const c = new x402Client((_version, exigences) => {
  const usdc = exigences.find((e) => e.asset.toLowerCase() === USDC.toLowerCase());
  if (!usdc) throw new Error("devis sans option USDC sur Base : refusé");
  capture.devis = Number(usdc.amount) / 1e6;
  if (capture.devis > PLAFOND_APPEL_USD) throw new Error(`devis ${capture.devis} $ au-dessus du plafond ${PLAFOND_APPEL_USD} $ : refusé avant signature`);
  return usdc;
});
registerExactEvmScheme(c, { signer: compte });
const payer = wrapFetchWithPayment(fetch, c) as typeof fetch;

const rpc = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const solde = async (): Promise<bigint | null> => {
  try {
    return await rpc.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [compte.address] });
  } catch {
    return null;
  }
};
/** Deux lectures identiques à 10 s d'intervalle : un solde lu juste après le dernier appel rate les règlements pas encore minés. */
async function soldeStabilise(): Promise<bigint | null> {
  let precedent = await solde();
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const courant = await solde();
    if (courant !== null && courant === precedent) return courant;
    precedent = courant;
  }
  return precedent;
}

const horodatage = new Date().toISOString().slice(0, 16).replace(":", "-") + "Z";
const dossier = `resultats/controle-lituanie-tranche6-${horodatage}`;
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 6 Europe, Lituanie (ticket #98, ${horodatage})`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}. Compléments : ${avecComplements ? "oui" : "non"}.`, ``];
const L = (x: string) => { lignes.push(x); console.log(x); };
const avant = await solde();
L(`Solde USDC avant : ${avant === null ? "illisible" : (Number(avant) / 1e6).toFixed(6)} $`);
L(``);
let depenseFacturee = 0;
let depenseAttendue = 0;
let echecs = 0;

type Corps = Record<string, unknown>;
const ok = (b: boolean, texte: string) => { if (!b) echecs += 1; return `${b ? "✅" : "❌"} ${texte}`; };
async function achat(nom: string, url: string, prix: number, verifier: (corps: Corps, statut: number, regle: boolean) => string[]) {
  capture.devis = null;
  let reponse: { r: Response; texte: string };
  try {
    const r = await payer(url);
    reponse = { r, texte: await r.text() };
  } catch (e) {
    writeFileSync(`${dossier}/${nom}.erreur.txt`, String(e));
    L(`## ${nom} — appel interrompu avant réponse`);
    L(`- ${ok(false, `exception : ${String(e).slice(0, 200)} (devis présenté : ${String(devisSigne())} $)`)}`);
    L(``);
    return;
  }
  const { r, texte } = reponse;
  writeFileSync(`${dossier}/${nom}.json`, texte); // le corps est écrit AVANT d'être jugé
  const entete = r.headers.get("payment-response");
  const regle = !!entete;
  let transaction = "?";
  if (entete) {
    try { transaction = String((JSON.parse(Buffer.from(entete, "base64").toString()) as Corps).transaction ?? "?"); } catch { /* en-tête non décodable : le règlement reste constaté */ }
  }
  const d = devisSigne();
  if (regle) depenseFacturee += d ?? prix;
  if (r.status === 200) depenseAttendue += prix;
  let corps: Corps | null = null;
  try { corps = JSON.parse(texte) as Corps; } catch { /* jugé ci-dessous */ }
  let constats: string[] = [];
  if (corps === null) constats = [ok(false, `corps illisible (non JSON)`)];
  else {
    const lu = corps;
    try { constats = verifier(lu, r.status, regle); } catch (e) { constats = [ok(false, `vérification interrompue : ${String(e)}`)]; }
  }
  if (r.status === 200) {
    constats.push(ok(regle && d !== null && Math.abs(d - prix) < 1e-9, `prix facturé : devis USDC signé ${String(d)} $, grille ${prix} $, règlement ${transaction}`));
    constats.push(ok(Array.isArray(corps?.provenance) && (corps?.provenance as unknown[]).length > 0, `provenance[] présente dans le corps servi`));
  } else {
    constats.push(`ℹ️ devis présenté ${d === null ? "aucun (refus avant le paywall)" : `${d} $ (paywall avant validation)`}, règlement ${regle ? transaction : "aucun"}`);
  }
  L(`## ${nom} — HTTP ${r.status}, réglé ${regle ? "oui" : "NON"}, ${texte.length} o`);
  for (const x of constats) L(`- ${x}`);
  L(``);
}
const entree = (corps: Corps, nom: string) => (corps.provenance as Array<Corps> | undefined)?.find((e) => e.bloc === nom);
const liste = (v: unknown): Corps[] => (Array.isArray(v) ? (v as Corps[]) : []);
/** Un nom de personne physique que la source VMI/AVNT publie et que Sirenic ne sert jamais (« J. MIŠEIKIENĖS ĮMONĖ ») :
 *  initiale + point + nom + ĮMONĖ, SENSIBLE à la casse et SANS drapeau i — avec i, JavaScript replie Į/į et le motif
 *  matchait le libellé légal « Individuali įmonė » que le registre publie et que la réponse conforme DOIT servir. */
const NOM_DE_PERSONNE_II = /[A-ZĄČĘĖĮŠŲŪŽ]\.\s?[A-ZĄČĘĖĮŠŲŪŽ][A-ZĄČĘĖĮŠŲŪŽa-ząčęėįšųūž]+\s(?:ĮMONĖ|IMONE)/u;

// UAB Autotitanas : fiche avec les deux blocs, commune seule, TVA radiée non servie comme identifiant courant.
await achat("LT_304500803_fiche", "https://api.sirenic.eu/v1/eu/entreprise/LT/304500803", 0.01, (corps) => {
  const r = corps.registre_lt as Corps | undefined;
  const f = corps.fiscalite_lt as Corps | undefined;
  const adresse = corps.adresse_siege as Corps | undefined;
  return [
    ok(corps.pays === "LT" && corps.id_national === "304500803" && String(corps.denomination).includes("Autotitanas") && corps.statut === "actif", `sujet ${String(corps.denomination)} (${String(corps.statut)})`),
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

// UAB Autotitanas : comptes annuels, huit exercices sociaux (2017 → 2024) ; l'exercice 2022 est asserté VALEUR PAR VALEUR.
await achat("LT_304500803_comptes", "https://api.sirenic.eu/v1/eu/entreprise/LT/304500803/comptes", 0.02, (corps) => {
  const ex = liste(corps.exercices);
  const e2022 = ex.find((e) => e.fin === "2022-12-31" && e.consolide === false);
  const b = (e2022?.bilan as Corps | undefined) ?? {};
  const cr = (e2022?.compte_resultat as Corps | undefined) ?? {};
  const attenduBilan: Record<string, number> = { actif_non_courant: 1415, actif_courant: 3835, total_actif: 5250, capitaux_propres: 3690, dettes: 1560 };
  const attenduResultat: Record<string, number> = { chiffre_affaires: 7301, resultat_avant_impot: 3000, resultat_net: 3000 };
  const ecartsBilan = Object.entries(attenduBilan).filter(([k, v]) => Number(b[k]) !== v).map(([k]) => k);
  const ecartsResultat = Object.entries(attenduResultat).filter(([k, v]) => Number(cr[k]) !== v).map(([k]) => k);
  return [
    ok(corps.pays === "LT" && corps.id_national === "304500803", `sujet ${String(corps.id_national)}`),
    // ≥ : l'incrément quotidien peut avoir ajouté l'exercice 2025 depuis la photo du 18/09 (8 exercices, dernier 2024-12-31).
    ok(ex.length >= 8 && Number(corps.nombre_exercices) === ex.length && typeof corps.dernier_exercice === "string" && corps.dernier_exercice >= "2024-12-31",`${ex.length} exercices servis (compte ${String(corps.nombre_exercices)}), dernier ${String(corps.dernier_exercice)}`),
    ok(ex.every((e) => e.devise === "EUR" && liste(e.etats).length >= 1 && Array.isArray(e.postes_divergents) && e.consolide === false), `chaque exercice : EUR, états déposés listés, postes_divergents présent, sociaux seulement`),
    ok(e2022 !== undefined && e2022.debut === "2022-01-01" && e2022.depose_le === "2023-05-16", `exercice 2022 servi, déposé le ${String(e2022?.depose_le)}`),
    ok(ecartsBilan.length === 0, `bilan 2022 réel : ${JSON.stringify(b)}${ecartsBilan.length ? ` — écart sur ${ecartsBilan.join(", ")}` : ""}`),
    ok(ecartsResultat.length === 0, `compte de résultat 2022 réel : ${JSON.stringify(cr)}${ecartsResultat.length ? ` — écart sur ${ecartsResultat.join(", ")}` : ""}`),
    ok(liste(e2022?.postes_divergents).length === 0, `aucun poste divergent en 2022`),
    ok(String(corps.licence).includes("Creative Commons Attribution 4.0"), `licence CC BY 4.0 servie`),
    ok(entree(corps, "exercices")?.etat === "servi" && entree(corps, "exercices")?.source_code === "jar_comptes_lt" && (entree(corps, "exercices")?.couverture as Corps | undefined)?.etat === "partielle", `provenance[exercices] = ${String(entree(corps, "exercices")?.etat)} / couverture ${String((entree(corps, "exercices")?.couverture as Corps | undefined)?.etat)}`),
  ];
});

// Complément : AB Grigeo Group, comptes sociaux ET consolidés, jamais fusionnés.
if (avecComplements) {
  await achat("LT_110012450_comptes", "https://api.sirenic.eu/v1/eu/entreprise/LT/110012450/comptes", 0.02, (corps) => {
    const ex = liste(corps.exercices);
    const consolides = ex.filter((e) => e.consolide === true);
    const sociaux = ex.filter((e) => e.consolide === false);
    const dernier = ex[0];
    return [
      ok(ex.length >= 8 && Number(corps.nombre_exercices) === ex.length, `${ex.length} exercices servis (compte ${String(corps.nombre_exercices)}), dernier ${String(corps.dernier_exercice)}`),
      ok(consolides.length >= 1 && sociaux.length >= 1, `${sociaux.length} exercices sociaux, ${consolides.length} consolidés, tenus séparés`),
      ok(typeof (dernier?.bilan as Corps | undefined)?.actif_courant === "number" && typeof (dernier?.compte_resultat as Corps | undefined)?.resultat_net === "number", `premier exercice servi : bilan ${JSON.stringify(dernier?.bilan)}, résultat ${JSON.stringify(dernier?.compte_resultat)}`),
      ok(ex.every((e) => e.devise === "EUR" && liste(e.etats).length >= 1 && Array.isArray(e.postes_divergents)), `chaque exercice : EUR, états déposés listés, postes_divergents présent`),
      ok(String(corps.licence).includes("Creative Commons Attribution 4.0"), `licence CC BY 4.0 servie`),
      ok(entree(corps, "exercices")?.etat === "servi" && entree(corps, "exercices")?.source_code === "jar_comptes_lt" && (entree(corps, "exercices")?.couverture as Corps | undefined)?.etat === "partielle", `provenance[exercices] = ${String(entree(corps, "exercices")?.etat)} / couverture ${String((entree(corps, "exercices")?.couverture as Corps | undefined)?.etat)}`),
    ];
  });
}

// IS FASHION BALTIC : statut 26 au registre (depuis le 28/01/2025) + dossier AVNT (faillite du 30/07/2024, liquidation le 14/01/2025).
await achat("LT_110518825_insolvabilite", "https://api.sirenic.eu/v1/eu/entreprise/LT/110518825/insolvabilite", 0.02, (corps) => {
  const p = liste(corps.procedures);
  const faillite = p.find((x) => x.nature === "faillite");
  const statut = corps.statut_registre as Corps | undefined;
  return [
    ok(corps.id_national === "110518825" && String(corps.denomination).includes("IS FASHION BALTIC"), `sujet ${String(corps.denomination)}`),
    ok(corps.procedure_au_registre === true && statut?.famille === "faillite" && Number(statut?.code) === 26 && statut?.depuis === "2025-01-28", `statut du registre : code ${String(statut?.code)} (${String(statut?.fr)}, depuis ${String(statut?.depuis)})`),
    ok(corps.aucune_procedure === false && p.length >= 1 && Number(corps.nombre_procedures) === p.length, `${p.length} dossier(s) AVNT (compte ${String(corps.nombre_procedures)})`),
    ok(faillite?.ouverture_le === "2024-07-30" && faillite?.tribunal === "Kauno apygardos teismas" && typeof faillite?.initiateur === "string", `faillite ouverte le ${String(faillite?.ouverture_le)} (${String(faillite?.tribunal)}, initiateur ${String(faillite?.initiateur)})`),
    ok(typeof faillite?.en_cours === "boolean" && faillite?.liquidation_le === "2025-01-14", `liquidation_le ${String(faillite?.liquidation_le)}, en_cours ${String(faillite?.en_cours)}`),
    ok(!JSON.stringify(p).includes("imones_pavadinimas") && p.every((x) => !("denomination" in x)), `aucune raison sociale AVNT dans les dossiers (la dénomination vient du registre : ${String(corps.denomination)})`),
    ok(typeof (corps.photo as Corps | undefined)?.registre === "string" && typeof (corps.photo as Corps | undefined)?.avnt === "string", `photos : ${JSON.stringify(corps.photo)}`),
    ok(entree(corps, "procedure_au_registre")?.etat === "servi" && entree(corps, "procedures")?.etat === "servi" && entree(corps, "procedures")?.source_code === "avnt_lt", `provenance[procedure_au_registre] = ${String(entree(corps, "procedure_au_registre")?.etat)}, provenance[procedures] = ${String(entree(corps, "procedures")?.etat)} / ${String(entree(corps, "procedures")?.source_code)}`),
  ];
});

// Complément : une société sans procédure, aucune_procedure est un fait mesuré sur la photo du registre (AVNT : non conclusif avant 2020).
if (avecComplements) {
  await achat("LT_304500803_insolvabilite_aucune", "https://api.sirenic.eu/v1/eu/entreprise/LT/304500803/insolvabilite", 0.02, (corps) => [
    ok(corps.aucune_procedure === true && corps.procedure_au_registre === false && Number(corps.nombre_procedures) === 0, `aucune_procedure ${String(corps.aucune_procedure)} (statut ${String((corps.statut_registre as Corps | undefined)?.code)})`),
    ok(entree(corps, "procedure_au_registre")?.etat === "absence_mesuree" && entree(corps, "procedures")?.etat === "absence_non_conclusive", `provenance : registre ${String(entree(corps, "procedure_au_registre")?.etat)}, AVNT ${String(entree(corps, "procedures")?.etat)} (dossiers depuis 2020 seulement)`),
  ]);
}

// L'IĮ 111485050, anonymisée PAR LE REGISTRE : étape 0 Lituanie, décision 2A — « servir le nom tel que le JAR le publie
// (« Individuali įmonė » pour une IĮ) avec denomination_anonymisee: true, jamais le nom VMI/AVNT ». Statut 6 (failli) depuis le 09/03/2018.
await achat("LT_111485050_ii_anonymisee", "https://api.sirenic.eu/v1/eu/entreprise/LT/111485050", 0.01, (corps) => {
  const r = corps.registre_lt as Corps | undefined;
  const etat = r?.etat as Corps | undefined;
  return [
    ok(corps.id_national === "111485050" && String(corps.denomination) === "Individuali įmonė" && r?.denomination_anonymisee === true, `dénomination servie : « ${String(corps.denomination)} », denomination_anonymisee ${String(r?.denomination_anonymisee)}`),
    ok((corps.forme_juridique as Corps | undefined)?.code === "810", `forme : ${JSON.stringify(corps.forme_juridique)}`),
    // La dénomination est déjà exigée À L'IDENTIQUE ci-dessus ; ici, le corps ENTIER est balayé pour la forme VMI/AVNT.
    ok(!NOM_DE_PERSONNE_II.test(JSON.stringify(corps)) && !/[A-ZĄČĘĖĮŠŲŪŽ]\. [A-ZĄČĘĖĮŠŲŪŽ]/.test(JSON.stringify(corps)), `aucun nom de personne dans la réponse (ni initiale suivie d'un nom, ni « X. NOM ĮMONĖ » de VMI/AVNT)`),
    ok(corps.statut === "autre" && etat?.famille === "faillite" && Number(etat?.code) === 6, `statut ${String(corps.statut)} — code ${String(etat?.code)}, ${String(etat?.fr)}, depuis ${String(etat?.depuis)}`),
    ok(entree(corps, "fiche")?.source_code === "jar_lt", `provenance[fiche] = ${String(entree(corps, "fiche")?.source_code)}`),
  ];
});

// Un code mal formé (400, refusé avant le paywall) et un code inconnu (404) : rien n'est réglé.
await achat("LT_12345_mal_forme", "https://api.sirenic.eu/v1/eu/entreprise/LT/12345/comptes", 0.02, (corps, statut, regle) => [
  ok(statut === 400 && corps.error === "identifiant_invalide", `code mal formé : HTTP ${statut}, ${String(corps.error)}`),
  ok(!regle, `aucun règlement`),
]);
await achat("LT_999999999_inconnu", "https://api.sirenic.eu/v1/eu/entreprise/LT/999999999/insolvabilite", 0.02, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_inconnue", `code inconnu : HTTP ${statut}, ${String(corps.error)}`),
  ok(!regle, `paiement annulé (aucun règlement)`),
]);

const apres = await soldeStabilise();
const depenseOnchain = avant !== null && apres !== null ? Number(avant - apres) / 1e6 : null;
L(`Solde USDC après (stabilisé) : ${apres === null ? "illisible" : (Number(apres) / 1e6).toFixed(6)} $`);
L(ok(depenseOnchain !== null && Math.abs(depenseOnchain - depenseAttendue) < 0.0005, `dépense on-chain ${depenseOnchain === null ? "?" : depenseOnchain.toFixed(6)} $ = somme des prix de grille des appels servis ${depenseAttendue.toFixed(2)} $ (ni le 400 ni le 404 débités)`));
L(`**Dépense** : ${depenseFacturee.toFixed(2)} $ facturés (devis signés et réglés) (${compte.address}) ; ${echecs} constat(s) en échec.`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, complements: avecComplements, depense_usd: depenseFacturee, depense_attendue_usd: depenseAttendue, solde_avant_usdc: avant === null ? null : Number(avant) / 1e6, solde_apres_usdc: apres === null ? null : Number(apres) / 1e6, depense_onchain_usd: depenseOnchain, echecs }, null, 2) + "\n");
