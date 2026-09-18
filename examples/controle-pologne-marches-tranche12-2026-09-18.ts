/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 12 Europe — Pologne, marchés publics du Biuletyn Zamówień Publicznych par NIP, livraison du 18/09/2026).
 * À lancer APRÈS que le stock BZP couvre le 17/09/2026 (passage `pologne-marches --depuis=2026-09-10` puis rattrapage). BUT : prouver EN
 * PRODUCTION, par des achats réels, que (1) `/PL/{nip}/marches-publics` sert M&M JOB CONNECT Sp. z o.o. (NIP 6040248554) comme GAGNANTE
 * prouvée personne morale — partie 4 de l'avis 2026/BZP 00441969/01 (ZUS Gdańsk, contrat du 01/09/2026, 581 992,37 PLN) —, avec l'enveloppe
 * en couverture partielle et la licence CC0 ; (2) MOBIN Sp. z o.o. (NIP publié « NIP 7812034808 ») est servie sur l'avis 2026/BZP 00441979/01
 * (Gmina Oborniki, 1 600 000 PLN, 16/09/2026) ; (3) le Zakład Ubezpieczeń Społecznych Oddział w Gdańsku (NIP 5832622111) est servi comme
 * ACHETEUR (avis émis), sans attribution ; (4) un NIP sans ligne, un NIP mal formé et un autre pays ne règlent rien (404 / 400 / 404).
 * Jamais un entrepreneur individuel dans ce contrôle : son NIP est une donnée personnelle, il ne s'écrit pas dans une vitrine publique.
 * COÛT estimé : 0,02 × 3 = 0,06 $ (USDC, Base mainnet) ; les trois refus ne règlent rien.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-pologne-marches-tranche12-2026-09-18.ts <commit attendu>
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
const dossier = "resultats/2026-09-18-controle-pologne-marches-tranche12";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 12 Europe, Pologne, marchés BZP (18/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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
const sansTracePersonnelle = (corps: Corps) => !/@|\bul\.\s|\b\d{2}-\d{3}\b/.test(JSON.stringify(corps)); // courriel, rue, code postal polonais

// M&M JOB CONNECT Sp. z o.o. (6040248554) : partie 4 de l'avis de résultat 2026/BZP 00441969/01 (ZUS Gdańsk), contrat du 01/09/2026.
await achat("PL_6040248554_marches", "https://api.sirenic.eu/v1/eu/entreprise/PL/6040248554/marches-publics", 0.02, (corps) => {
  const attributions = liste(corps.attributions);
  const zus = attributions.find((a) => a.avis_id === "2026/BZP 00441969/01" && Number(a.partie) === 4);
  const gagnant = zus?.gagnant as Corps | undefined;
  const prov = entree(corps, "attributions");
  return [
    ok(corps.pays === "PL" && corps.nip === "6040248554" && Number(corps.nombre_attributions) >= 1 && corps.aucune_attribution === false && corps.nature_nip === "personne_morale", `${String(corps.nombre_attributions)} attribution(s), nature ${String(corps.nature_nip)}`),
    ok(!!zus && (zus.acheteur as Corps | undefined)?.nip === "5832622111" && zus.issue === "contrat conclu" && zus.valeur_contrat_pln === 581992.37 && zus.date_contrat === "2026-09-01" && zus.type_marche === "travaux", `avis 2026/BZP 00441969/01 partie 4 : ${zus ? `${String(zus.issue)}, ${String(zus.valeur_contrat_pln)} PLN le ${String(zus.date_contrat)}, acheteur ${String((zus.acheteur as Corps).nom)}` : "ABSENT"}`),
    ok(gagnant?.nom_publie === "M&M JOB CONNECT Sp. z o.o." && gagnant?.ville === "Pszczółki" && gagnant?.taille === "micro-entreprise", `gagnant : ${JSON.stringify(gagnant)}`),
    ok(prov?.etat === "servi" && prov?.source_code === "bzp_pl" && (prov?.couverture as Corps | undefined)?.etat === "partielle", `provenance[attributions] = ${String(prov?.etat)} (${String(prov?.source_code)}, couverture ${String((prov?.couverture as Corps | undefined)?.etat)})`),
    ok(String(corps.licence).includes("CC0") && String(corps.source).includes("Urząd Zamówień Publicznych"), `licence : ${String(corps.licence).slice(0, 70)}…`),
    ok(typeof (corps.stock as Corps | undefined)?.dernier_jour_complet === "string" && typeof (corps.stock as Corps | undefined)?.gagnants_a_classer === "number", `stock : ${JSON.stringify(corps.stock)}`),
    ok(sansTracePersonnelle(corps), "aucun courriel, aucune rue, aucun code postal dans la réponse"),
  ];
});
// MOBIN Sp. z o.o. : identifiant publié « NIP 7812034808 » (forme étiquetée), avis 2026/BZP 00441979/01 (Gmina Oborniki).
await achat("PL_7812034808_mobin", "https://api.sirenic.eu/v1/eu/entreprise/PL/7812034808/marches-publics", 0.02, (corps) => {
  const a = liste(corps.attributions).find((x) => x.avis_id === "2026/BZP 00441979/01");
  return [
    ok(!!a && (a.acheteur as Corps | undefined)?.nip === "6060081962" && a.valeur_contrat_pln === 1600000 && a.date_contrat === "2026-09-16" && (a.gagnant as Corps | undefined)?.nom_publie === "MOBIN Sp. z o.o.", `avis 2026/BZP 00441979/01 : ${a ? `${String(a.valeur_contrat_pln)} PLN le ${String(a.date_contrat)}, ${String((a.gagnant as Corps).nom_publie)}` : "ABSENT"}`),
    ok(Number(a?.offres_recues) === 4 && liste(a?.cpv).includes("45216129-4"), `offres reçues ${String(a?.offres_recues)}, CPV ${JSON.stringify(a?.cpv).slice(0, 60)}`),
    ok(sansTracePersonnelle(corps), "aucune trace personnelle"),
  ];
});
// ZUS Gdańsk (5832622111) : ACHETEUR de l'avis 2026/BZP 00441969/01 (quatre parties), jamais gagnant.
await achat("PL_5832622111_acheteur", "https://api.sirenic.eu/v1/eu/entreprise/PL/5832622111/marches-publics", 0.02, (corps) => {
  const avis = liste(corps.avis_emis).find((a) => a.avis_id === "2026/BZP 00441969/01");
  return [
    ok(Number(corps.nombre_avis_emis) >= 1 && !!avis && Number(avis.nombre_parties) === 4, `${String(corps.nombre_avis_emis)} avis émis (2026/BZP 00441969/01 ${avis ? `présent, ${String(avis.nombre_parties)} parties, ${String(avis.nombre_attributions_servies)} attribution(s) servie(s)` : "ABSENT"})`),
    ok(corps.aucune_attribution === true && entree(corps, "avis_emis")?.etat === "servi" && entree(corps, "attributions")?.etat === "absence_non_conclusive", `aucune attribution ; provenance[avis_emis] = ${String(entree(corps, "avis_emis")?.etat)}, provenance[attributions] = ${String(entree(corps, "attributions")?.etat)}`),
  ];
});
await achat("PL_0000000000_inconnu", "https://api.sirenic.eu/v1/eu/entreprise/PL/0000000000/marches-publics", 0.02, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_inconnue" && !regle, `NIP sans ligne : HTTP ${statut}, ${String(corps.error)}, paiement annulé`),
]);
await achat("PL_mal_forme", "https://api.sirenic.eu/v1/eu/entreprise/PL/12345/marches-publics", 0.02, (corps, statut, regle) => [
  ok(statut === 400 && corps.error === "parametre_invalide" && !regle, `NIP mal formé : HTTP ${statut}, ${String(corps.error)}, aucun règlement`),
]);
await achat("EE_pays_non_couvert", "https://api.sirenic.eu/v1/eu/entreprise/EE/16752073/marches-publics", 0.02, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "pays_non_couvert" && !regle && String(corps.message).includes("Pologne"), `autre pays : HTTP ${statut}, ${String(corps.error)}, gratuit`),
]);

L(`**Dépense** : ${depense.toFixed(2)} $ (${compte.address})`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
