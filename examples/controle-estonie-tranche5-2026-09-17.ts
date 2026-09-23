/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 5 Europe — Estonie, étape 0 du 17/09/2026,
 * livraison du 17/09/2026 ; version corrigée pour le ticket #98 le 23/09/2026).
 * BUT : prouver EN PRODUCTION, par des achats réels, que
 * (1) les dirigeants de Swedbank AS (10060701) sont servis depuis la photo quotidienne du
 * e-äriregister (direction sur la carte, conseil de surveillance et cabinet d'audit hors carte,
 * le cabinet étant une entité avec son registrikood), sans AUCUN hash d'identifiant, date de
 * naissance, adresse ni e-mail de personne ; (2) les associés de Swedbank AS sont servis :
 * aucun osanik (société anonyme), l'actionnaire unique inscrit hors carte (rôle S) est une
 * personne morale nommée avec son code étranger ; (3) la fiche de Swedbank AS porte les blocs
 * `registre_ee` et `gages_commerciaux` déclarés par l'enveloppe ; (4) `/evenements` porte
 * `inscriptions_registre` ; (5) une entreprise individuelle (FIE 10211713, forme FIE vérifiée
 * sur la photo du 22/09) rend 404 SANS règlement et sans son nom, un registrikood inconnu aussi.
 * Chaque appel servi asserte le corps, `provenance[]` et le PRIX signé (option USDC du devis,
 * égale à la grille) ; le solde USDC est lu avant et après (stabilisé) pour prouver la dépense.
 * État de la collecte : six jeux en succès le 23/09/2026 entre 11:23 et 11:33 UTC (journal de prod).
 * COÛT estimé : 0,01 + 0,02 + 0,01 + 0,02 = 0,06 $ (USDC, Base mainnet), + 0,02 $ de complément
 * (associés de Bolt Operations OÜ 14532901, sujet de l'exemple de contrat actuel) sauf avec
 * `--sans-complements` ; les deux 404 ne règlent rien. Total : 0,08 $ (0,06 $ sans complément).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-estonie-tranche5-2026-09-17.ts <commit attendu> [--sans-complements]
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
const dossier = `resultats/controle-estonie-tranche5-${horodatage}`;
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 5 Europe, Estonie (ticket #98, ${horodatage})`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}. Compléments : ${avecComplements ? "oui" : "non"}.`, ``];
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
const CLES_PERSONNE = ["type", "prenom", "nom"];
const CLES_ENTITE = ["type", "registrikood", "code_etranger", "pays", "pays_libelle", "nom", "apport"];
/** Une trace personnelle que la source publie et que Sirenic refuse : hash uuid5 de l'identifiant,
 *  date de naissance (le portail la publie en JJ.MM.AAAA), e-mail, adresse de personne. */
const TRACE_PERSONNELLE = /[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}|synniaeg|isikukood|naissance|birth|@/i;

// Swedbank AS : conseil d'administration (carte), conseil de surveillance et cabinet d'audit hors carte.
await achat("EE_10060701_dirigeants", "https://api.sirenic.eu/v1/eu/entreprise/EE/10060701/dirigeants", 0.01, (corps) => {
  const m = liste(corps.mandats);
  const organes = new Set(m.map((x) => String(x.organe)));
  const titulaires = m.map((x) => x.titulaire as Corps);
  const audit = m.find((x) => x.role === "cabinet_audit");
  const clesInattendues = titulaires.flatMap((t) => Object.keys(t).filter((k) => !(t.type === "personne" ? CLES_PERSONNE : CLES_ENTITE).includes(k)));
  return [
    ok(corps.denomination === "Swedbank AS" && (corps.forme_juridique as Corps | undefined)?.code === "AS", `sujet ${String(corps.denomination)} (${String((corps.forme_juridique as Corps | undefined)?.code)})`),
    ok(Number(corps.nombre_mandats) >= 10 && m.length === Number(corps.nombre_mandats) && Number(corps.nombre_personnes_physiques) + Number(corps.nombre_entites) === m.length, `${m.length} mandats servis (compte ${String(corps.nombre_mandats)} : ${String(corps.nombre_personnes_physiques)} personnes, ${String(corps.nombre_entites)} entités)`),
    ok(corps.aucun_mandat_inscrit === false, `aucun_mandat_inscrit = ${String(corps.aucun_mandat_inscrit)}`),
    ok(organes.has("direction") && organes.has("conseil_surveillance") && organes.has("reviseur"), `organes : ${[...organes].join(", ")}`),
    ok((audit?.titulaire as Corps | undefined)?.type === "entite" && /^\d{8}$/.test(String((audit?.titulaire as Corps | undefined)?.registrikood)), `cabinet d'audit = entité ${String((audit?.titulaire as Corps | undefined)?.nom)} (${String((audit?.titulaire as Corps | undefined)?.registrikood)}), hors carte`),
    ok(m.some((x) => x.origine === "carte") && m.some((x) => x.origine === "hors_carte"), `mandats de la carte ET hors carte`),
    ok(clesInattendues.length === 0 && !TRACE_PERSONNELLE.test(JSON.stringify(m)), `titulaires : aucune clé hors liste, aucun hash, naissance, e-mail ni adresse`),
    ok(m.every((x) => typeof x.role_source === "string" && typeof x.role === "string" && typeof x.organe === "string"), `chaque mandat porte organe, role et role_source (code estonien)`),
    ok(liste((corps.regles_representation as Corps | undefined)?.standard).length >= 1, `règles de représentation standard servies`),
    ok(String(corps.licence).includes("CC BY 4.0"), `licence CC BY 4.0 servie`),
    ok(entree(corps, "mandats")?.etat === "servi" && entree(corps, "mandats")?.source_code === "rik_isikud_ee", `provenance[mandats] = ${String(entree(corps, "mandats")?.etat)} / ${String(entree(corps, "mandats")?.source_code)}`),
  ];
});

// Swedbank AS : aucun osanik (société anonyme) ; l'actionnaire unique est inscrit HORS carte (rôle S) —
// SWEDBANK BALTICS AS, personne morale lettone, code 40203295309, 100 % (fixtures réelles du 17/09/2026) ;
// capital 85 000 000 EUR (photo des données générales du 22/09/2026).
await achat("EE_10060701_associes", "https://api.sirenic.eu/v1/eu/entreprise/EE/10060701/associes", 0.02, (corps) => {
  const a = liste(corps.associes);
  const h = liste(corps.actionnaires_hors_carte);
  const fondateurs = corps.fondateurs as Corps | undefined;
  const tous = [...a, ...h, ...liste(fondateurs?.liste)];
  const morales = tous.filter((x) => x.type === "personne_morale" || x.type === "personne_morale_etrangere");
  const physiques = tous.filter((x) => x.type === "personne_physique");
  const actionnaire = h.find((x) => x.code_etranger === "40203295309");
  const capital = corps.capital as Corps | null | undefined;
  return [
    ok(corps.denomination === "Swedbank AS" && (corps.forme_juridique as Corps | undefined)?.code === "AS", `sujet ${String(corps.denomination)} (${String((corps.forme_juridique as Corps | undefined)?.code)})`),
    ok(corps.aucun_associe_inscrit === false && Number(corps.nombre_associes) === a.length && Number(corps.nombre_actionnaires_hors_carte) === h.length && h.length >= 1, `${a.length} associé(s) inscrit(s), ${h.length} actionnaire(s) hors carte, aucun_associe_inscrit = ${String(corps.aucun_associe_inscrit)}`),
    ok(actionnaire?.type === "personne_morale_etrangere" && String(actionnaire?.nom).includes("SWEDBANK BALTICS") && Number(actionnaire?.part_pct) === 100 && actionnaire?.role_source === "S", `actionnaire : ${String(actionnaire?.nom)} (${String(actionnaire?.pays)} ${String(actionnaire?.code_etranger)}), ${String(actionnaire?.part_pct)} %, ${String(actionnaire?.valeur_nominale)} ${String(actionnaire?.devise)}, depuis ${String(actionnaire?.depuis)}`),
    ok(morales.every((x) => typeof x.nom === "string" && (/^\d{8}$/.test(String(x.registrikood_entite)) || typeof x.code_etranger === "string")), `${morales.length} personne(s) morale(s) nommée(s) avec registrikood ou code étranger`),
    ok(physiques.every((x) => x.nom === null && x.registrikood_entite === null && x.code_etranger === null), `${physiques.length} personne(s) physique(s) comptée(s), jamais nommée(s)`),
    ok(Number(capital?.montant) === 85000000 && capital?.devise === "EUR", `capital : ${JSON.stringify(capital)}`),
    ok(typeof fondateurs?.nombre === "number", `fondateurs hors carte : ${String(fondateurs?.nombre)} (dont ${String(fondateurs?.nombre_personnes_physiques)} personnes physiques comptées)`),
    ok(!TRACE_PERSONNELLE.test(JSON.stringify({ a, h, f: fondateurs })), `aucune trace personnelle dans les associés, les actionnaires ni les fondateurs`),
    ok(String(corps.licence).includes("CC BY 4.0"), `licence CC BY 4.0 servie`),
    ok(entree(corps, "associes")?.etat === "servi" && entree(corps, "associes")?.source_code === "rik_osanikud_ee", `provenance[associes] = ${String(entree(corps, "associes")?.etat)} / ${String(entree(corps, "associes")?.source_code)}`),
    ok(entree(corps, "gages_sur_parts") !== undefined, `provenance[gages_sur_parts] = ${String(entree(corps, "gages_sur_parts")?.etat)}`),
  ];
});

// Complément : Bolt Operations OÜ, sujet de l'exemple de contrat /associes actuel (un associé personne morale
// estonienne, fondateur hors carte, capital) — permet de recapturer ce contrat sans changer de sujet.
if (avecComplements) {
  await achat("EE_14532901_associes", "https://api.sirenic.eu/v1/eu/entreprise/EE/14532901/associes", 0.02, (corps) => {
    const a = liste(corps.associes);
    const morales = a.filter((x) => x.type === "personne_morale" || x.type === "personne_morale_etrangere");
    const physiques = a.filter((x) => x.type === "personne_physique");
    return [
      ok(corps.aucun_associe_inscrit === false && a.length === Number(corps.nombre_associes) && a.length >= 1, `${a.length} associé(s) servi(s) (compte ${String(corps.nombre_associes)})`),
      ok(morales.every((x) => typeof x.nom === "string" && (/^\d{8}$/.test(String(x.registrikood_entite)) || typeof x.code_etranger === "string")), `${morales.length} personne(s) morale(s) nommée(s) avec registrikood ou code étranger`),
      ok(physiques.every((x) => x.nom === null && x.registrikood_entite === null && x.code_etranger === null), `${physiques.length} personne(s) physique(s) comptée(s), jamais nommée(s)`),
      ok(a.every((x) => typeof x.part_pct === "number" || x.part_pct === null) && a.every((x) => typeof x.depuis === "string" || x.depuis === null), `part publiée et date d'inscription sur chaque ligne`),
      ok(corps.capital === null || typeof (corps.capital as Corps).montant === "number", `capital : ${JSON.stringify(corps.capital)}`),
      ok(typeof (corps.fondateurs as Corps | undefined)?.nombre === "number", `fondateurs hors carte : ${String((corps.fondateurs as Corps | undefined)?.nombre)} (dont ${String((corps.fondateurs as Corps | undefined)?.nombre_personnes_physiques)} personnes physiques comptées)`),
      ok(!TRACE_PERSONNELLE.test(JSON.stringify(corps.associes)) && !TRACE_PERSONNELLE.test(JSON.stringify(corps.fondateurs)), `aucune trace personnelle dans les associés ni les fondateurs`),
      ok(entree(corps, "associes")?.etat === "servi" && entree(corps, "associes")?.source_code === "rik_osanikud_ee", `provenance[associes] = ${String(entree(corps, "associes")?.etat)} / ${String(entree(corps, "associes")?.source_code)}`),
    ];
  });
}

// Fiche Swedbank : blocs registre_ee et gages_commerciaux (une banque n'a pas de gage commercial : absence mesurée).
await achat("EE_10060701_fiche_blocs", "https://api.sirenic.eu/v1/eu/entreprise/EE/10060701", 0.01, (corps) => {
  const r = corps.registre_ee as Corps | undefined;
  const g = corps.gages_commerciaux as Corps | undefined;
  const contacts = (r?.contacts as Corps | undefined) ?? {};
  return [
    ok(corps.id_national === "10060701" && corps.denomination === "Swedbank AS", `fiche ${String(corps.denomination)} (${String(corps.id_national)}), statut ${String(corps.statut)}`),
    ok(r !== undefined && r.statut === "servi" && Number((r.capital as Corps | null)?.montant) === 85000000, `bloc registre_ee servi : capital ${JSON.stringify(r?.capital)}, statut ${JSON.stringify(r?.etat)}`),
    ok(liste(r?.activites).length >= 1 && liste(r?.historique_statuts).length >= 1, `activités EMTAK (${liste(r?.activites).length}) et historique des statuts (${liste(r?.historique_statuts).length}) servis`),
    ok(liste(contacts.emails).every((e) => !/gmail|hotmail|mail\.ee|outlook/i.test(String(e))), `e-mails servis sur domaine propre seulement (${liste(contacts.emails).length} servi(s), ${String(contacts.emails_retenus)} retenu(s))`),
    ok(g !== undefined && g.statut === "servi" && Number(g.nombre) === 0, `bloc gages_commerciaux servi : nombre ${String(g?.nombre)}`),
    ok(entree(corps, "registre_ee")?.etat === "servi" && entree(corps, "gages_commerciaux")?.etat === "absence_mesuree", `provenance[registre_ee] = ${String(entree(corps, "registre_ee")?.etat)}, provenance[gages_commerciaux] = ${String(entree(corps, "gages_commerciaux")?.etat)}`),
    ok(entree(corps, "fiche") !== undefined, `provenance[fiche] toujours présente`),
  ];
});

// Événements Swedbank : ordonnances + inscriptions des cartes (bloc additif, prix inchangé ; 73 inscriptions sur la photo du 22/09).
await achat("EE_10060701_evenements_inscriptions", "https://api.sirenic.eu/v1/eu/entreprise/EE/10060701/evenements", 0.02, (corps) => {
  const i = corps.inscriptions_registre as Corps | undefined;
  const cartes = liste(i?.cartes);
  return [
    ok(typeof corps.aucune_ordonnance === "boolean", `corps existant intact : aucune_ordonnance = ${String(corps.aucune_ordonnance)}, ${liste(corps.evenements).length} ordonnance(s)`),
    ok(i !== undefined && i.statut === "servi" && Number(i.nombre) >= 10 && cartes.length >= 1, `inscriptions_registre servi : ${String(i?.nombre)} inscriptions sur ${cartes.length} carte(s)`),
    ok(cartes.every((k) => liste(k.inscriptions).every((x) => typeof x.type_code === "string" && (typeof x.date === "string" || x.date === null))), `chaque inscription porte un type et une date, jamais de texte`),
    ok(entree(corps, "evenements") !== undefined, `provenance[evenements] (ordonnances) = ${String(entree(corps, "evenements")?.etat)}`),
    ok(entree(corps, "inscriptions_registre")?.etat === "servi" && entree(corps, "inscriptions_registre")?.source_code === "rik_registrikaardid_ee", `provenance[inscriptions_registre] = ${String(entree(corps, "inscriptions_registre")?.etat)}`),
  ];
});

// Une entreprise individuelle (FIE 10211713) : refusée sans règlement, et son nom (celui d'une personne) n'est pas renvoyé ;
// un registrikood inconnu : 404 sans règlement.
await achat("EE_FIE_refusee", "https://api.sirenic.eu/v1/eu/entreprise/EE/10211713/dirigeants", 0.01, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_individuelle_non_servie", `FIE : HTTP ${statut}, ${String(corps.error)}`),
  ok(Object.keys(corps).sort().join(",") === "error,message", `corps du refus : error + message seulement (aucune dénomination renvoyée)`),
  ok(!regle, `paiement annulé (aucun règlement)`),
]);
await achat("EE_90000099_inconnue", "https://api.sirenic.eu/v1/eu/entreprise/EE/90000099/associes", 0.02, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_inconnue", `registrikood inconnu : HTTP ${statut}, ${String(corps.error)}`),
  ok(!regle, `paiement annulé (aucun règlement)`),
]);

const apres = await soldeStabilise();
const depenseOnchain = avant !== null && apres !== null ? Number(avant - apres) / 1e6 : null;
L(`Solde USDC après (stabilisé) : ${apres === null ? "illisible" : (Number(apres) / 1e6).toFixed(6)} $`);
L(ok(depenseOnchain !== null && Math.abs(depenseOnchain - depenseAttendue) < 0.0005, `dépense on-chain ${depenseOnchain === null ? "?" : depenseOnchain.toFixed(6)} $ = somme des prix de grille des appels servis ${depenseAttendue.toFixed(2)} $ (aucun 404 débité)`));
L(`**Dépense** : ${depenseFacturee.toFixed(2)} $ facturés (devis signés et réglés) (${compte.address}) ; ${echecs} constat(s) en échec.`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, complements: avecComplements, depense_usd: depenseFacturee, depense_attendue_usd: depenseAttendue, solde_avant_usdc: avant === null ? null : Number(avant) / 1e6, solde_apres_usdc: apres === null ? null : Number(apres) / 1e6, depense_onchain_usd: depenseOnchain, echecs }, null, 2) + "\n");
