/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 5 Europe — Estonie, étape 0 du 17/09/2026,
 * livraison du 17/09/2026). BUT : prouver EN PRODUCTION, par des achats réels, que
 * (1) les dirigeants estoniens sont servis depuis la photo quotidienne du
 * e-äriregister (direction, conseil de surveillance hors carte, cabinet d'audit
 * entité avec son registrikood), sans AUCUN hash d'identifiant, date de
 * naissance, adresse ni e-mail de personne ; (2) les associés de Bolt Operations
 * sont servis avec les personnes morales nommées et codées ; (3) la fiche EE porte
 * les blocs `registre_ee` et `gages_commerciaux` déclarés par l'enveloppe ;
 * (4) `/evenements` porte `inscriptions_registre` ; (5) une entreprise individuelle
 * (FIE) rend 404 SANS règlement et un registrikood inconnu aussi. À lancer APRÈS la
 * première ingestion complète des six fichiers (timer 11:20 UTC ou passage
 * manuel) — avant, les routes rendent 503 `collecte_en_cours` et rien n'est débité.
 * COÛT estimé : 0,01 + 0,02 + 0,01 + 0,02 = 0,06 $ (USDC, Base mainnet) ; les deux 404 ne règlent rien.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-estonie-tranche5-2026-09-17.ts <commit attendu>
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
const dossier = "resultats/2026-09-17-controle-estonie-tranche5";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 5 Europe, Estonie (17/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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
const CLES_PERSONNE = ["type", "prenom", "nom"];
const CLES_ENTITE = ["type", "registrikood", "code_etranger", "pays", "pays_libelle", "nom", "apport"];
/** Une trace personnelle que la source publie et que Sirenic refuse : hash uuid5 de l'identifiant,
 *  date de naissance (le portail la publie en JJ.MM.AAAA), e-mail, adresse de personne. */
const TRACE_PERSONNELLE = /[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}|synniaeg|isikukood|naissance|birth|@/i;

// Swedbank AS : conseil d'administration, conseil de surveillance et cabinet d'audit hors carte.
await achat("EE_10060701_dirigeants", "https://api.sirenic.eu/v1/eu/entreprise/EE/10060701/dirigeants", 0.01, (corps) => {
  const m = liste(corps.mandats);
  const organes = new Set(m.map((x) => String(x.organe)));
  const titulaires = m.map((x) => x.titulaire as Corps);
  const audit = m.find((x) => x.role === "cabinet_audit");
  const clesInattendues = titulaires.flatMap((t) => Object.keys(t).filter((k) => !(t.type === "personne" ? CLES_PERSONNE : CLES_ENTITE).includes(k)));
  return [
    ok(corps.denomination === "Swedbank AS" && (corps.forme_juridique as Corps | undefined)?.code === "AS", `sujet ${String(corps.denomination)} (${String((corps.forme_juridique as Corps | undefined)?.code)})`),
    ok(Number(corps.nombre_mandats) >= 10 && m.length === Number(corps.nombre_mandats), `${m.length} mandats servis (compte ${String(corps.nombre_mandats)} : ${String(corps.nombre_personnes_physiques)} personnes, ${String(corps.nombre_entites)} entités)`),
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

// Bolt Operations OÜ : un associé personne morale (holding), fondateur hors carte, capital.
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

// Fiche Swedbank : blocs registre_ee et gages_commerciaux (une banque n'a pas de gage commercial : absence mesurée).
await achat("EE_10060701_fiche_blocs", "https://api.sirenic.eu/v1/eu/entreprise/EE/10060701", 0.01, (corps) => {
  const r = corps.registre_ee as Corps | undefined;
  const g = corps.gages_commerciaux as Corps | undefined;
  const contacts = (r?.contacts as Corps | undefined) ?? {};
  return [
    ok(r !== undefined && r.statut === "servi" && typeof (r.capital as Corps | null)?.montant === "number", `bloc registre_ee servi : capital ${JSON.stringify(r?.capital)}, statut ${JSON.stringify(r?.etat)}`),
    ok(liste(r?.activites).length >= 1 && liste(r?.historique_statuts).length >= 1, `activités EMTAK (${liste(r?.activites).length}) et historique des statuts (${liste(r?.historique_statuts).length}) servis`),
    ok(liste(contacts.emails).every((e) => !/gmail|hotmail|mail\.ee|outlook/i.test(String(e))), `e-mails servis sur domaine propre seulement (${liste(contacts.emails).length} servi(s), ${String(contacts.emails_retenus)} retenu(s))`),
    ok(g !== undefined && g.statut === "servi" && Number(g.nombre) === 0, `bloc gages_commerciaux servi : nombre ${String(g?.nombre)}`),
    ok(entree(corps, "registre_ee")?.etat === "servi" && entree(corps, "gages_commerciaux")?.etat === "absence_mesuree", `provenance[registre_ee] = ${String(entree(corps, "registre_ee")?.etat)}, provenance[gages_commerciaux] = ${String(entree(corps, "gages_commerciaux")?.etat)}`),
    ok(entree(corps, "fiche") !== undefined, `provenance[fiche] toujours présente`),
  ];
});

// Événements Swedbank : ordonnances + inscriptions des cartes (bloc additif, prix inchangé).
await achat("EE_10060701_evenements_inscriptions", "https://api.sirenic.eu/v1/eu/entreprise/EE/10060701/evenements", 0.02, (corps) => {
  const i = corps.inscriptions_registre as Corps | undefined;
  const cartes = liste(i?.cartes);
  return [
    ok(typeof corps.aucune_ordonnance === "boolean", `corps existant intact : aucune_ordonnance = ${String(corps.aucune_ordonnance)}, ${liste(corps.evenements).length} ordonnance(s)`),
    ok(i !== undefined && i.statut === "servi" && Number(i.nombre) >= 10 && cartes.length >= 1, `inscriptions_registre servi : ${String(i?.nombre)} inscriptions sur ${cartes.length} carte(s)`),
    ok(cartes.every((k) => liste(k.inscriptions).every((x) => typeof x.type_code === "string" && (typeof x.date === "string" || x.date === null))), `chaque inscription porte un type et une date, jamais de texte`),
    ok(entree(corps, "inscriptions_registre")?.etat === "servi" && entree(corps, "inscriptions_registre")?.source_code === "rik_registrikaardid_ee", `provenance[inscriptions_registre] = ${String(entree(corps, "inscriptions_registre")?.etat)}`),
  ];
});

// Une entreprise individuelle (FIE) : refusée sans règlement ; un registrikood inconnu : 404 sans règlement.
await achat("EE_FIE_refusee", "https://api.sirenic.eu/v1/eu/entreprise/EE/10211713/dirigeants", 0.01, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_individuelle_non_servie", `FIE : HTTP ${statut}, ${String(corps.error)}`),
  ok(!regle, `paiement annulé (aucun règlement)`),
]);
await achat("EE_90000099_inconnue", "https://api.sirenic.eu/v1/eu/entreprise/EE/90000099/associes", 0.02, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_inconnue", `registrikood inconnu : HTTP ${statut}, ${String(corps.error)}`),
  ok(!regle, `paiement annulé (aucun règlement)`),
]);

L(`**Dépense** : ${depense.toFixed(2)} $ (${compte.address})`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
