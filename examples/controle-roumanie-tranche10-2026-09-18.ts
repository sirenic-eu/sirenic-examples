/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 10 Europe — Roumanie, registre du commerce ONRC, livraison du 18/09/2026).
 * À lancer APRÈS la première collecte mensuelle (timer `sirenic-roumanie`, ≈ 15 min). BUT : prouver EN PRODUCTION, par des
 * achats réels, que (1) `/RO/{cui}` sert la fiche d'ORIENT COMEX S.R.L. (CUI 3474203) avec ses DEUX immatriculations (l'ancienne
 * radiée, la nouvelle en fonction), le statut lu sur la courante et le bloc `registre_ro` ; (2) la forme « RO0… » est servie sous
 * le CUI canonique et PAYÉE comme l'autre ; (3) `/dirigeants` sert les représentants dédoublonnés, nom + qualité + nature, sans
 * naissance ni domicile ; (4) `/insolvabilite` sert la faillite d'ALPIN IMPACT TELECOM SRL (CUI 29023037) avec son liquidateur
 * judiciaire, et l'absence mesurée pour ORIENT COMEX ; (5) une personne physique (PFA 19899014), un CUI mal formé et un CUI
 * inconnu ne règlent rien (404 / 400 / 404) ; (6) tranche 10 bis (comptes du ministère des Finances, livrée le 18/09/2026) :
 * `/comptes` sert les six exercices 2019-2024 d'ORIENT COMEX (bilan abrégé, dettes négatives telles que publiées, résultat =
 * bénéfice − perte, classe CAEN 5510 libellée) et la fiche porte `registre_ro.activite` ; TRANSIDEAL SRL (CUI 412052, radiée en
 * 1991, aucune situation publiée) répond 404 sans règlement.
 * COÛT estimé : 0,01 + 0,01 + 0,01 + 0,02 + 0,02 + 0,02 = 0,09 $ (USDC, Base mainnet) ; les quatre refus ne règlent rien.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-roumanie-tranche10-2026-09-18.ts <commit attendu>
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
const dossier = "resultats/2026-09-18-controle-roumanie-tranche10";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 10 Europe, Roumanie (18/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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
const FAMILLES_ROLE = new Set(["administrateur", "representant_personne_morale", "representant_legal", "directeur_general", "conseil_surveillance", "directoire", "liquidateur", "liquidateur_judiciaire", "administrateur_judiciaire", "administrateur_special", "administrateur_concordataire", "mandataire", "autre"]);

// ORIENT COMEX S.R.L., CUI 3474203 : J40/5594/1992 (Bucureşti, radiée) puis J2024004913234 (Ilfov, en fonction).
await achat("RO_3474203_fiche", "https://api.sirenic.eu/v1/eu/entreprise/RO/3474203", 0.01, (corps) => {
  const r = corps.registre_ro as Corps | undefined;
  const ins = liste(r?.inscriptions);
  return [
    ok(corps.id_national === "3474203" && String(corps.denomination).startsWith("ORIENT COMEX") && corps.statut === "actif", `${String(corps.denomination)} — statut ${String(corps.statut)}, première immatriculation ${String(corps.date_creation)}`),
    ok(ins.length >= 2 && ins[0]?.courante === true && ins[0]?.cod_inmatriculare === "J2024004913234" && ins.some((i) => i.cod_inmatriculare === "J40/5594/1992" && i.courante === false), `${ins.length} immatriculations, courante ${String(ins[0]?.cod_inmatriculare)}`),
    ok(r?.statut === "servi" && r?.procedure_au_registre === false && liste(r?.statuts).some((s) => s.code === 1048) && liste(r?.statuts).some((s) => s.code === 1084), `registre_ro : photo ${String(r?.photo)}, statuts ${liste(r?.statuts).map((s) => s.code).join(",")}`),
    ok((corps.adresse_siege as Corps | undefined)?.pays === "RO" && (r?.siege as Corps | undefined)?.judet === "Ilfov", `siège : ${JSON.stringify(corps.adresse_siege)}`),
    ok((r?.activite as Corps | undefined)?.caen === "5510" && (r?.activite as Corps | undefined)?.exercice === 2024, `registre_ro.activite (tranche 10 bis) : ${JSON.stringify(r?.activite)}`),
    ok(entree(corps, "registre_ro")?.etat === "servi" && entree(corps, "registre_ro")?.source_code === "onrc_ro" && entree(corps, "fiche")?.source_code === "onrc_ro", `provenance[registre_ro] = ${String(entree(corps, "registre_ro")?.etat)} / ${String(entree(corps, "registre_ro")?.source_code)}`),
  ];
});
await achat("RO_3474203_prefixe_RO", "https://api.sirenic.eu/v1/eu/entreprise/RO/RO03474203", 0.01, (corps, statut, regle) => [
  ok(statut === 200 && regle && corps.id_national === "3474203", `forme « RO0… » servie sous ${String(corps.id_national)}, réglée`),
]);
await achat("RO_3474203_dirigeants", "https://api.sirenic.eu/v1/eu/entreprise/RO/3474203/dirigeants", 0.01, (corps) => {
  const m = liste(corps.mandats);
  return [
    ok(Number(corps.nombre_mandats) === m.length && m.length >= 2 && corps.aucun_mandat_publie === false, `${m.length} mandats (compte ${String(corps.nombre_mandats)})`),
    ok(m.every((x) => typeof x.nom === "string" && ["personne", "entite"].includes(String(x.nature)) && FAMILLES_ROLE.has(String((x.role as Corps | undefined)?.famille)) && Object.keys(x).sort().join(",") === "cod_inmatriculare,nature,nom,role"), `chaque mandat : nom, nature, rôle en famille fermée, immatriculation — rien d'autre`),
    ok(!/naissance|DATA_NASTERE|JUDET_NASTERE|domicil/i.test(JSON.stringify(m)), `aucune naissance ni domicile dans les mandats`),
    ok(entree(corps, "mandats")?.etat === "servi" && entree(corps, "mandats")?.source_code === "onrc_reprezentanti_ro" && (entree(corps, "mandats")?.couverture as Corps | undefined)?.etat === "complete", `provenance[mandats] = ${String(entree(corps, "mandats")?.etat)}, couverture complète`),
    ok(String(corps.licence).includes("Creative Commons Attribution 4.0"), `licence : CC BY 4.0`),
  ];
});
// ALPIN IMPACT TELECOM SRL, CUI 29023037 : faliment + Legea 85/2014, liquidateur judiciaire A.R.T. INSOLV SPRL.
await achat("RO_29023037_insolvabilite", "https://api.sirenic.eu/v1/eu/entreprise/RO/29023037/insolvabilite", 0.02, (corps) => {
  const st = liste(corps.statuts_procedure);
  const md = liste(corps.mandataires);
  return [
    ok(corps.procedure_au_registre === true && corps.aucune_procedure === false && st.some((s) => s.code === 1070 && s.famille === "faillite" && s.libelle_ro === "faliment"), `statuts de procédure : ${st.map((s) => `${s.code}/${s.famille}`).join(", ")}`),
    ok(md.length >= 1 && md.every((x) => ["liquidateur", "liquidateur_judiciaire", "administrateur_judiciaire", "administrateur_special", "administrateur_concordataire"].includes(String((x.role as Corps | undefined)?.famille))), `mandataires : ${md.map((x) => `${String(x.nom)} (${String((x.role as Corps | undefined)?.famille)})`).join(", ")}`),
    ok((corps.statut_registre as Corps | undefined)?.unifie === "autre" && (corps.statut_registre as Corps | undefined)?.detail === "faillite", `statut : ${JSON.stringify(corps.statut_registre)}`),
    ok(entree(corps, "statuts_procedure")?.etat === "servi" && entree(corps, "mandataires")?.etat === "servi", `provenance : statuts ${String(entree(corps, "statuts_procedure")?.etat)}, mandataires ${String(entree(corps, "mandataires")?.etat)}`),
  ];
});
await achat("RO_3474203_insolvabilite_aucune", "https://api.sirenic.eu/v1/eu/entreprise/RO/3474203/insolvabilite", 0.02, (corps) => [
  ok(corps.aucune_procedure === true && corps.procedure_au_registre === false && Number(corps.nombre_mandataires) === 0, `aucune procédure`),
  ok(entree(corps, "statuts_procedure")?.etat === "absence_mesuree" && entree(corps, "mandataires")?.etat === "absence_mesuree", `provenance : absences mesurées`),
]);
// Refus : personne physique (PFA), CUI mal formé, CUI inconnu — aucun règlement.
await achat("RO_19899014_pfa", "https://api.sirenic.eu/v1/eu/entreprise/RO/19899014", 0.01, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_inconnue" && !regle, `PFA 19899014 : HTTP ${statut}, ${String(corps.error)}, paiement annulé`),
]);
// Tranche 10 bis : comptes du ministère des Finances — ORIENT COMEX dépose un bilan abrégé chaque année depuis 2019.
await achat("RO_3474203_comptes", "https://api.sirenic.eu/v1/eu/entreprise/RO/3474203/comptes", 0.02, (corps) => {
  const ex = liste(corps.exercices);
  const dernier = ex[0] ?? {};
  const bilan = (dernier.bilan ?? {}) as Corps;
  const cr = (dernier.compte_resultat ?? {}) as Corps;
  return [
    ok(corps.nombre_exercices === 6 && corps.dernier_exercice === 2024 && ex.map((e) => e.exercice).join(",") === "2024,2023,2022,2021,2020,2019", `${String(corps.nombre_exercices)} exercices : ${ex.map((e) => `${String(e.exercice)} (${String(e.format)})`).join(", ")}`),
    ok(dernier.format === "abrege" && dernier.devise === "RON" && bilan.dettes === -45266 && bilan.stocks === null && cr.resultat_net === 172884 && cr.benefice_net === 172884 && cr.perte_nette === 0, `2024 : dettes ${String(bilan.dettes)} (négatives telles que publiées), stocks ${String(bilan.stocks)}, résultat net ${String(cr.resultat_net)} = ${String(cr.benefice_net)} − ${String(cr.perte_nette)}`),
    ok((dernier.activite as Corps | undefined)?.caen === "5510" && typeof (dernier.activite as Corps | undefined)?.libelle_ro === "string", `activité 2024 : ${JSON.stringify(dernier.activite)}`),
    ok(entree(corps, "exercices")?.etat === "servi" && entree(corps, "exercices")?.source_code === "mf_comptes_ro" && (entree(corps, "exercices")?.couverture as Corps | undefined)?.etat === "partielle", `provenance[exercices] = ${String(entree(corps, "exercices")?.etat)} (${String(entree(corps, "exercices")?.source_code)}), photo ${JSON.stringify(corps.photo)}`),
    ok(String(corps.licence).includes("Creative Commons Attribution 4.0") && String(corps.source).includes("Finan"), `licence : ${String(corps.licence)}`),
  ];
});
await achat("RO_412052_comptes_aucun", "https://api.sirenic.eu/v1/eu/entreprise/RO/412052/comptes", 0.02, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_inconnue" && String(corps.message).includes("situation financière") && !regle, `CUI connu sans situation publiée : HTTP ${statut}, paiement annulé — ${String(corps.message).slice(0, 90)}…`),
]);
await achat("RO_mal_forme", "https://api.sirenic.eu/v1/eu/entreprise/RO/J40-1116-1991/dirigeants", 0.01, (corps, statut, regle) => [
  ok(statut === 400 && corps.error === "identifiant_invalide" && !regle, `CUI mal formé : HTTP ${statut}, ${String(corps.error)}, aucun règlement`),
]);
// 9999999999 EXISTE au registre (mesuré le 18/09/2026 : filiale radiée d'une SRL de Galați) — la route la sert, radiée, sans procédure :
// un « CUI inconnu » ne s'invente pas, il se vérifie (9999999998 est absent de ro_firme et de ro_comptes, contrôlé en base le 18/09).
await achat("RO_9999999999_radiee", "https://api.sirenic.eu/v1/eu/entreprise/RO/9999999999/insolvabilite", 0.02, (corps, statut, regle) => [
  ok(statut === 200 && regle && corps.statut_registre?.unifie === "cesse" && corps.aucune_procedure === true, `CUI radié : HTTP ${statut}, statut ${JSON.stringify(corps.statut_registre)}, aucune procédure ${String(corps.aucune_procedure)}`),
  ok(String(corps.denomination ?? "").endsWith("SRL GALATI FILIALA BRAILA"), `dénomination servie telle que publiée (filiale radiée)`),
]);
await achat("RO_9999999998_inconnu", "https://api.sirenic.eu/v1/eu/entreprise/RO/9999999998/insolvabilite", 0.02, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_inconnue" && !regle, `CUI inconnu : HTTP ${statut}, ${String(corps.error)}, paiement annulé`),
]);

L(`**Dépense** : ${depense.toFixed(2)} $ (${compte.address})`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
