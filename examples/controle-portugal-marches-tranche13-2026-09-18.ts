/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 13 Europe — Portugal, contrats publics du Portal BASE par NIPC, livraison du 18/09/2026).
 * À lancer APRÈS le rattrapage 2012 → 2026 (ou au moins l'année 2026). BUT : prouver EN PRODUCTION, par des achats réels, que
 * (1) `/PT/{nipc}/marches-publics` sert RIS 2048 - Sistemas Informáticos e Comunicações, S.A. (NIPC 504904493) comme ADJUDICATÁRIA, avec au
 * moins le contrat 12491739 (Universidade do Porto, appel d'offres ouvert, 215 012 € HT, célébré le 07/01/2026, deux soumissionnaires) et
 * l'enveloppe en couverture partielle ; (2) l'Universidade do Porto (NIPC 501413197) est servie comme ADJUDICANTE (contrats émis, liste
 * coupée à 100 et dite) ; (3) un NIF de personne physique, une clé de contrôle fausse, un NIPC sans ligne et un autre pays ne règlent rien
 * (400 / 400 / 404 / 404). Aucun gagnant sans NIF n'est jamais nommé.
 * COÛT estimé : 0,02 × 2 = 0,04 $ (USDC, Base mainnet) ; les quatre refus ne règlent rien.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-portugal-marches-tranche13-2026-09-18.ts <commit attendu>
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
const dossier = "resultats/2026-09-18-controle-portugal-marches-tranche13";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 13 Europe, Portugal, contrats du Portal BASE (18/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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
// Un gagnant publié sans NIF ne s'écrit jamais : aucun « - - », aucun « [omis] », aucun courriel dans une réponse — cherchés partout SAUF dans
// l'objet et la description du contrat, textes publics de l'acheteur (« PRR IMPULSO MAIS DIGITAL AGRO@TECVERDE » : un nom de projet, pas un courriel).
const sansTracePersonnelle = (corps: Corps) => {
  const copie = JSON.parse(JSON.stringify(corps)) as Corps;
  for (const c of [...liste(copie.attributions), ...liste(copie.contrats_emis)]) { delete c.objeto; delete c.descricao; delete c.lotes; }
  for (const a of liste(copie.avis_emis)) delete a.descricao;
  return !/"- - |\[omis\]|@/.test(JSON.stringify(copie));
};

// RIS 2048 (504904493) : adjudicatária du contrat 12491739 (Universidade do Porto), célébré le 07/01/2026.
await achat("PT_504904493_marches", "https://api.sirenic.eu/v1/eu/entreprise/PT/504904493/marches-publics", 0.02, (corps) => {
  const attributions = liste(corps.attributions);
  const contrat = attributions.find((a) => a.id === "12491739");
  const prov = entree(corps, "attributions");
  return [
    ok(corps.pays === "PT" && corps.nipc === "504904493" && Number(corps.nombre_attributions) >= 1 && corps.aucune_attribution === false, `${String(corps.nombre_attributions)} attribution(s)${String(corps.tronque_attributions) === "true" ? " (liste coupée à 100, dite)" : ""}`),
    ok(!!contrat && (contrat.adjudicante as Corps | undefined)?.nif === "501413197" && contrat.procedimento === "appel d'offres ouvert" && contrat.preco_contratual_eur === 215012 && contrat.celebre_le === "2026-01-07" && contrat.concorrentes === 2, `contrat 12491739 : ${contrat ? `${String(contrat.procedimento)}, ${String(contrat.preco_contratual_eur)} €, célébré le ${String(contrat.celebre_le)}, ${String(contrat.concorrentes)} soumissionnaires, acheteur ${String((contrat.adjudicante as Corps).nom)}` : "ABSENT"}`),
    ok(liste(contrat?.adjudicatarios).some((a) => a.nif === "504904493" && String(a.nom).startsWith("RIS 2048")), `adjudicatários : ${JSON.stringify(contrat?.adjudicatarios)}`),
    ok(Array.isArray(contrat?.modificacoes) && Array.isArray(contrat?.lotes) && liste(contrat?.lotes).length === 2, `lots ${String(liste(contrat?.lotes).length)}, modifications ${String(liste(contrat?.modificacoes).length)}`),
    // Plus de 100 attributions : la liste est coupée et l'enveloppe le dit (état « partiel », troncature annoncée) ; « servi » sinon.
    ok(["servi", "partiel"].includes(String(prov?.etat)) && prov?.source_code === "base_pt" && (prov?.couverture as Corps | undefined)?.etat === "partielle", `provenance[attributions] = ${String(prov?.etat)} (${String(prov?.source_code)}, couverture ${String((prov?.couverture as Corps | undefined)?.etat)})`),
    ok(String(corps.licence).includes("Domínio Público") && String(corps.source).includes("IMPIC"), `licence : ${String(corps.licence).slice(0, 70)}…`),
    ok(Array.isArray((corps.stock as Corps | undefined)?.annees_chargees) && typeof (corps.stock as Corps | undefined)?.fichiers_du === "string", `stock : ${JSON.stringify(corps.stock)}`),
    ok(sansTracePersonnelle(corps), "aucun gagnant sans NIF nommé, aucun courriel"),
  ];
});
// Universidade do Porto (501413197) : ADJUDICANTE (des centaines de contrats par an : liste coupée à 100 et dite).
await achat("PT_501413197_adjudicante", "https://api.sirenic.eu/v1/eu/entreprise/PT/501413197/marches-publics", 0.02, (corps) => [
  ok(Number(corps.nombre_contrats_emis) >= 100 && liste(corps.contrats_emis).length === 100 && corps.tronque_contrats_emis === true, `${String(corps.nombre_contrats_emis)} contrats émis, ${String(liste(corps.contrats_emis).length)} servis, troncature dite ${String(corps.tronque_contrats_emis)}`),
  // 9 296 contrats émis : les 100 servis sont les plus récents (le contrat 12491739 de janvier n'y est plus — c'est attendu) ; l'enveloppe dit la coupe.
  ok(liste(corps.contrats_emis).every((c, i, l) => i === 0 || String(l[i - 1]!.publie_le) >= String(c.publie_le)), `les 100 servis vont du plus récent (${String(liste(corps.contrats_emis)[0]?.publie_le)}) au plus ancien (${String(liste(corps.contrats_emis).at(-1)?.publie_le)})`),
  ok(["servi", "partiel"].includes(String(entree(corps, "contrats_emis")?.etat)) && (corps.tronque_contrats_emis !== true || entree(corps, "contrats_emis")?.etat === "partiel"), `provenance[contrats_emis] = ${String(entree(corps, "contrats_emis")?.etat)} (troncature ${String(corps.tronque_contrats_emis)})`),
  ok(sansTracePersonnelle(corps), "aucun gagnant sans NIF nommé, aucun courriel"),
]);
await achat("PT_123456789_personne_physique", "https://api.sirenic.eu/v1/eu/entreprise/PT/123456789/marches-publics", 0.02, (corps, statut, regle) => [
  ok(statut === 400 && corps.error === "identifiant_personne_physique" && !regle, `NIF de personne physique : HTTP ${statut}, ${String(corps.error)}, aucun règlement`),
]);
await achat("PT_501413190_cle_fausse", "https://api.sirenic.eu/v1/eu/entreprise/PT/501413190/marches-publics", 0.02, (corps, statut, regle) => [
  ok(statut === 400 && corps.error === "parametre_invalide" && !regle, `clé de contrôle fausse : HTTP ${statut}, ${String(corps.error)}, aucun règlement`),
]);
await achat("PT_699999995_inconnu", "https://api.sirenic.eu/v1/eu/entreprise/PT/699999995/marches-publics", 0.02, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_inconnue" && !regle, `NIPC sans ligne : HTTP ${statut}, ${String(corps.error)}, paiement annulé`),
]);
await achat("EE_pays_non_couvert", "https://api.sirenic.eu/v1/eu/entreprise/EE/16752073/marches-publics", 0.02, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "pays_non_couvert" && !regle && String(corps.message).includes("Portugal"), `autre pays : HTTP ${statut}, ${String(corps.error)}, gratuit`),
]);

L(`**Dépense** : ${depense.toFixed(2)} $ (${compte.address})`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
