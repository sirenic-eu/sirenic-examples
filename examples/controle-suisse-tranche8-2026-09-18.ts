/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 8 Europe — Suisse, publications FOSC/SHAB, décision CDU A et
 * livraison du 18/09/2026). BUT : prouver EN PRODUCTION, par des achats réels, que (1) `/CH/{id}/evenements`
 * sert les publications du registre du commerce d'A.S. Consulta AG lues en direct à la FOSC — structurées,
 * vérifiées sur l'UID, drapeaux de mutation en liste fermée, texte libre retenu, aucune personne ni ligne c/o ;
 * (2) `/CH/{id}/insolvabilite` sert l'avis préalable de faillite de Skytender Group Holding AG avec ses libellés
 * officiels ; (3) une société sans faillite rend `aucune_procedure: true` (absence mesurée) ; (4) un UID mal formé
 * (400) et un UID inconnu de Zefix (404) ne règlent rien. Direct : aucune ingestion à attendre.
 * COÛT estimé : 0,02 + 0,02 + 0,02 = 0,06 $ (USDC, Base mainnet) ; le 400 et le 404 ne règlent rien.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-suisse-tranche8-2026-09-18.ts <commit attendu>
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
const dossier = "resultats/2026-09-18-controle-suisse-tranche8";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 8 Europe, Suisse (18/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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
const CHANGEMENTS = new Set(["raison_sociale", "uid", "forme_juridique", "siege", "adresse", "but", "capital_nominal", "capital_libere", "capital_autre", "faillite_ouverture", "faillite_suspension", "faillite_revocation", "faillite_annulation", "faillite_sommaire", "liquidation_dissolution", "liquidation_dissolution_judiciaire_731b", "liquidation_dissolution_orc_153b", "liquidation_revocation", "suspension", "reinscription", "nouvelle_inscription", "autres_inscriptions"]);
/** Personnes nommées dans le texte libre de ces publications (relevé du 18/09/2026) : ne doivent jamais sortir. */
const PERSONNES = /Schryber|Pape, Sebastian|Staatsangeh|c\/o /i;

// A.S. Consulta AG : 7 mutations depuis 2021 (mesuré le 18/09/2026), dernière le 18/09/2026.
await achat("CH_CHE-102.732.681_evenements", "https://api.sirenic.eu/v1/eu/entreprise/CH/CHE-102.732.681/evenements", 0.02, (corps) => {
  const p = liste(corps.publications);
  return [
    ok(corps.denomination === "A.S. Consulta AG" && Number(corps.nombre_publications) >= 7 && p.length === Number(corps.nombre_publications), `${p.length} publications servies (compte ${String(corps.nombre_publications)}, listées ${String(corps.nombre_listees)}), du ${String(corps.premiere_publication_le)} au ${String(corps.derniere_publication_le)}`),
    ok(corps.troncature === false && corps.aucune_publication === false, `troncature ${String(corps.troncature)}, aucune_publication ${String(corps.aucune_publication)}`),
    ok(p.every((x) => ["inscription", "mutation", "radiation"].includes(String(x.type)) && x.texte_retenu === true), `chaque publication : type fermé, texte retenu`),
    ok(p.every((x) => liste(x.changements).every((ch) => CHANGEMENTS.has(String(ch)))), `drapeaux de mutation tous dans la liste fermée (${p.flatMap((x) => liste(x.changements)).length})`),
    ok(p.every((x) => (x.societe as Corps | null)?.uid === "CHE-102.732.681"), `chaque publication vérifiée sur l'UID structuré`),
    ok(!PERSONNES.test(JSON.stringify(corps)), `aucune personne, aucune ligne c/o dans la réponse`),
    ok(String(corps.licence).includes("art. 13"), `licence : art. 13 VSHAB servie`),
    ok(entree(corps, "publications")?.etat === "servi" && entree(corps, "publications")?.source_code === "fosc_shab_ch", `provenance[publications] = ${String(entree(corps, "publications")?.etat)} / ${String(entree(corps, "publications")?.source_code)}`),
  ];
});

// Skytender Group Holding AG : avis préalable d'ouverture de faillite du 17/09/2026 (KK01).
await achat("CH_CHE-138.657.350_insolvabilite", "https://api.sirenic.eu/v1/eu/entreprise/CH/CHE-138.657.350/insolvabilite", 0.02, (corps) => {
  const p = liste(corps.procedures);
  const avis = p.find((x) => x.type === "avis_prealable_faillite");
  return [
    ok(corps.aucune_procedure === false && p.length >= 1 && Number(corps.nombre_procedures) === p.length, `${p.length} publication(s) de faillite (compte ${String(corps.nombre_procedures)})`),
    ok(avis !== undefined && (avis.debiteur as Corps | undefined)?.uid === "CHE-138.657.350" && (avis.libelle as Corps | undefined)?.fr === "Avis préalable d'ouverture de faillite", `avis préalable du ${String(avis?.date)} (${String((avis?.libelle as Corps | undefined)?.de)}), débiteur ${String((avis?.debiteur as Corps | undefined)?.nom)}`),
    ok(p.every((x) => typeof (x.debiteur as Corps | null)?.uid === "string" && x.texte_retenu === true), `chaque publication : débiteur société identifié par UID, texte retenu`),
    ok(typeof (corps.statut_registre as Corps | undefined)?.statut === "string", `statut Zefix : ${JSON.stringify(corps.statut_registre)}`),
    ok(entree(corps, "procedures")?.etat === "servi" && entree(corps, "procedures")?.source_code === "fosc_shab_ch", `provenance[procedures] = ${String(entree(corps, "procedures")?.etat)}`),
  ];
});

// A.S. Consulta AG : aucune publication de faillite → absence mesurée (archive depuis 2021).
await achat("CH_CHE-102.732.681_insolvabilite_aucune", "https://api.sirenic.eu/v1/eu/entreprise/CH/CHE-102.732.681/insolvabilite", 0.02, (corps) => [
  ok(corps.aucune_procedure === true && Number(corps.nombre_procedures) === 0, `aucune_procedure ${String(corps.aucune_procedure)}`),
  ok(entree(corps, "procedures")?.etat === "absence_mesuree", `provenance[procedures] = ${String(entree(corps, "procedures")?.etat)}`),
]);

// UID mal formé (400) et UID inconnu de Zefix (404) : rien n'est réglé.
await achat("CH_CHE-1_mal_forme", "https://api.sirenic.eu/v1/eu/entreprise/CH/CHE-1/evenements", 0.02, (corps, statut, regle) => [
  ok(statut === 400 && corps.error === "identifiant_invalide", `UID mal formé : HTTP ${statut}, ${String(corps.error)}`),
  ok(!regle, `aucun règlement`),
]);
await achat("CH_CHE-999.999.999_inconnu", "https://api.sirenic.eu/v1/eu/entreprise/CH/CHE-999.999.999/insolvabilite", 0.02, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_inconnue", `UID inconnu : HTTP ${statut}, ${String(corps.error)}`),
  ok(!regle, `paiement annulé (aucun règlement)`),
]);

L(`**Dépense** : ${depense.toFixed(2)} $ (${compte.address})`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
