/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 11 Europe — Espagne, marchés publics de la PLACSP par NIF, livraison du 18/09/2026).
 * À lancer APRÈS le rattrapage des archives et au moins un passage quotidien (timer `sirenic-espagne-marches`). BUT : prouver EN
 * PRODUCTION, par des achats réels, que (1) `/ES/{nif}/marches-publics` sert CHM OBRAS E INFRAESTRUCTURAS SA (NIF A28582013) comme
 * gagnante, avec au moins le dossier 19724487 (Ferrocarrils de la Generalitat Valenciana, attribué le 16/09/2026, 2 576 254,67 € HT),
 * l'enveloppe en couverture partielle et la citation « Origen de los datos: Ministerio de Hacienda » ; (2) la Gerencia de Ferrocarrils
 * de la Generalitat Valenciana (NIF Q9650001B) est servie comme ACHETEUSE (avis émis) ; (3) un DNI (personne physique), un NIF
 * inconnu et un autre pays ne règlent rien (400 / 404 / 404).
 * COÛT estimé : 0,02 + 0,02 = 0,04 $ (USDC, Base mainnet) ; les trois refus ne règlent rien.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-espagne-marches-tranche11-2026-09-18.ts <commit attendu>
 *
 * REJOUE le 24/09/2026 (ticket #99) apres le premier passage reel : trois attentes du 18/09, ecrites avant toute execution,
 * etaient fausses et la production avait raison : (1) une liste coupee a 100 et ANNONCEE (tronque_attributions) rend l etat
 * d enveloppe « partiel », pas « servi » (src/domain/enveloppe.ts, o.tronque) ; (2) le motif DNI \d{8}[A-Z] matche les numeros
 * d expediente de la source (« 19114353Z ») : ils s excluent avant le test, comme l objet ; (3) B00000000 n est PAS un NIF
 * inconnu : la source le publie comme bouche-trou (147 attributions en stock, ticket #164) ; le NIF absent prouve sur la copie
 * restauree du 24/09 est B99999999 (0 ligne gagnant et acheteur).
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
const dossier = "resultats/2026-09-18-controle-espagne-marches-tranche11";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 11 Europe, Espagne, marchés PLACSP (18/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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
// Motif DNI cherche partout SAUF dans les champs de la source qui portent legitimement des references de dossier a cette forme
// (expediente « 19114353Z », liens profonds, objets) : seuls les champs d identite doivent en etre exempts.
const sansDni = (corps: Corps) => {
  const copie = JSON.parse(JSON.stringify(corps)) as Corps;
  for (const a of [...liste(copie.attributions), ...liste(copie.avis_emis)]) { delete a.expediente; delete a.lien; delete a.objet; delete a.lot_objet; }
  return !/\b\d{8}[A-Z]\b/.test(JSON.stringify(copie));
};

// CHM OBRAS E INFRAESTRUCTURAS SA (A28582013) : attributaire du dossier 19724487 (Ferrocarrils de la Generalitat Valenciana, 16/09/2026).
await achat("ES_A28582013_marches", "https://api.sirenic.eu/v1/eu/entreprise/ES/A28582013/marches-publics", 0.02, (corps) => {
  const attributions = liste(corps.attributions);
  const fgv = attributions.find((a) => a.id === "19724487");
  const prov = entree(corps, "attributions");
  return [
    ok(corps.pays === "ES" && corps.nif === "A28582013" && Number(corps.nombre_attributions) >= 1 && corps.aucune_attribution === false, `${String(corps.nombre_attributions)} attributions (${String(corps.tronque_attributions) === "true" ? "liste coupée à 100" : "liste complète"}), valeur totale HT ${String(corps.valeur_totale_ht_eur)} €`),
    ok(!!fgv && (fgv.gagnant as Corps | undefined)?.nif === "A28582013" && (fgv.acheteur as Corps | undefined)?.nif === "Q9650001B" && fgv.montant_ht_eur === 2576254.67 && fgv.date_attribution === "2026-09-16", `dossier 19724487 : ${fgv ? `${String(fgv.resultat)} le ${String(fgv.date_attribution)}, ${String(fgv.montant_ht_eur)} € HT, acheteur ${String((fgv.acheteur as Corps | undefined)?.nom)}` : "ABSENT"}`),
    ok(prov?.etat === "partiel" && prov?.source_code === "placsp_es" && (prov?.couverture as Corps | undefined)?.etat === "partielle", `provenance[attributions] = ${String(prov?.etat)} (${String(prov?.source_code)}, couverture ${String((prov?.couverture as Corps | undefined)?.etat)}) : liste coupee annoncee`),
    ok(String(corps.source).includes("Origen de los datos: Ministerio de Hacienda") && String(corps.licence).includes("Ley 37/2007"), `citation et licence : ${String(corps.licence).slice(0, 80)}…`),
    ok(typeof (corps.stock as Corps | undefined)?.depuis === "string" && typeof (corps.stock as Corps | undefined)?.dernier_mis_a_jour === "string", `stock : ${JSON.stringify(corps.stock)}`),
    ok(sansDni(corps), "aucun DNI dans la réponse (hors references de dossier de la source)"),
  ];
});
// Gerencia de Ferrocarrils de la Generalitat Valenciana (Q9650001B) : entité publique à NIF, ACHETEUSE.
await achat("ES_Q9650001B_acheteuse", "https://api.sirenic.eu/v1/eu/entreprise/ES/Q9650001B/marches-publics", 0.02, (corps) => [
  ok(Number(corps.nombre_avis_emis) >= 1 && liste(corps.avis_emis).some((a) => a.id === "19724487"), `${String(corps.nombre_avis_emis)} avis émis comme acheteuse (dossier 19724487 ${liste(corps.avis_emis).some((a) => a.id === "19724487") ? "présent" : "ABSENT"}), ${String(corps.nombre_attributions)} attributions`),
  ok(entree(corps, "avis_emis")?.etat === "partiel", `provenance[avis_emis] = ${String(entree(corps, "avis_emis")?.etat)} : liste coupee annoncee`),
]);
// 00000000T : le DNI d'exemple de l'administration espagnole (lettre de contrôle valide), jamais celui d'une personne réelle.
await achat("ES_DNI_personne_physique", "https://api.sirenic.eu/v1/eu/entreprise/ES/00000000T/marches-publics", 0.02, (corps, statut, regle) => [
  ok(statut === 400 && corps.error === "identifiant_personne_physique" && !regle, `DNI : HTTP ${statut}, ${String(corps.error)}, aucun règlement`),
]);
// B99999999 : NIF de forme valide, prouve ABSENT du stock (copie restauree du 24/09, 0 ligne gagnant et acheteur).
// B00000000, l ancienne sonde, est un bouche-trou REEL de la source (147 attributions en stock) : ticket #164.
await achat("ES_B99999999_inconnu", "https://api.sirenic.eu/v1/eu/entreprise/ES/B99999999/marches-publics", 0.02, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_inconnue" && !regle, `NIF sans ligne : HTTP ${statut}, ${String(corps.error)}, paiement annulé`),
]);
await achat("EE_pays_non_couvert", "https://api.sirenic.eu/v1/eu/entreprise/EE/16752073/marches-publics", 0.02, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "pays_non_couvert" && !regle && String(corps.message).includes("Espagne"), `autre pays : HTTP ${statut}, ${String(corps.error)}, gratuit`),
]);

L(`**Dépense** : ${depense.toFixed(2)} $ (${compte.address})`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
