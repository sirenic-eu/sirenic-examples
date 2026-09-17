/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 2 Europe — marchés publics lettons de l'IUB,
 * livraison du 17/09/2026). BUT : prouver EN PRODUCTION, par des achats réels,
 * que (1) une société gagnante reçoit ses attributions (acheteur, contrat,
 * valeur, dates, statut) ; (2) une entreprise publique acheteuse reçoit ses avis
 * émis ; (3) une société sans marché reçoit une réponse positive BORNÉE ;
 * (4) un numéro inconnu rend 404 SANS règlement. À lancer APRÈS le rattrapage
 * (`npm run ingestion -- lettonie-marches --depuis=2023-10-25`).
 * COÛT estimé : 0,02 × 3 = 0,06 $ (USDC, Base mainnet).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-lettonie-marches-2026-09-17.ts <commit attendu>
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
const dossier = "resultats/2026-09-17-controle-lettonie-marches";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 2 Europe, marchés publics lettons IUB (17/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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
const FORMES = ["planification", "mise_en_concurrence", "resultat", "execution", "modification", "autre"];
const CLES = ["avis_id", "type_avis", "forme", "forme_source", "publie_le", "objet", "cpv", "nature", "acheteur", "contrat", "gagnant"];
const commun = (corps: Corps): string[] => {
  const a = liste(corps.attributions);
  return [
    ok(a.every((x) => FORMES.includes(String(x.forme)) && CLES.every((k) => k in x) && Object.keys(x).every((k) => CLES.includes(k))), `formes en liste fermée, clés en liste fermée sur ${a.length} attributions`),
    ok(!/@|\+371|isNaturalPerson|contactPoint|street/i.test(JSON.stringify(corps)), `ni contact, ni téléphone, ni adresse, ni marque de personne physique`),
    ok(String(corps.licence).includes("CC0") && typeof objet(corps.stock).depuis === "string", `licence CC0 servie, stock depuis ${String(objet(corps.stock).depuis)} (dernier jour ${String(objet(corps.stock).dernier_jour_collecte)})`),
  ];
};

// (1) Akciju sabiedrība "VIRŠI-A" (40003242737) : gagnante d'un marché de carburant (avis d'exécution du 16/09/2026).
await achat("LV_40003242737_VIRSI_A", "https://api.sirenic.eu/v1/eu/entreprise/LV/40003242737/marches-publics", 0.02, (corps) => {
  const a = liste(corps.attributions);
  const premiere = objet(a[0]);
  return [
    ok(Number(corps.nombre_attributions) > 0 && corps.aucune_attribution === false, `${String(corps.nombre_attributions)} attributions (${a.length} servies, tronqué ${String(corps.tronque_attributions)}), ${String(corps.valeur_totale_eur)} € au total`),
    ok(typeof objet(premiere.acheteur).regnr === "string" && typeof objet(premiere.contrat).valeur_eur !== "undefined" && /^\d{4}-\d{2}-\d{2}$/.test(String(premiere.publie_le)), `dernière attribution : ${String(premiere.publie_le)}, acheteur ${String(objet(premiere.acheteur).nom)}, contrat ${String(objet(premiere.contrat).reference)}, ${String(objet(premiere.contrat).valeur_eur)} €`),
    ...commun(corps),
    ok(entree(corps, "attributions")?.etat === "servi" && objet(entree(corps, "attributions")?.couverture).etat === "partielle", `provenance[attributions] = ${String(entree(corps, "attributions")?.etat)}, couverture partielle`),
  ];
});

// (2) "Rīgas satiksme" SIA (40003619950) : entreprise municipale, ACHETEUSE.
await achat("LV_40003619950_RIGAS_SATIKSME", "https://api.sirenic.eu/v1/eu/entreprise/LV/40003619950/marches-publics", 0.02, (corps) => [
  ok(Number(corps.nombre_avis_emis) > 0 && liste(corps.avis_emis).every((x) => FORMES.includes(String(x.forme))), `${String(corps.nombre_avis_emis)} avis émis comme acheteur (${liste(corps.avis_emis).length} servis)`),
  ...commun(corps),
  ok(entree(corps, "avis_emis")?.etat === "servi", `provenance[avis_emis] = ${String(entree(corps, "avis_emis")?.etat)}`),
]);

// (3) 50203219311 (exemple des événements lettons, société connue du registre) : vraisemblablement sans marché.
await achat("LV_50203219311_sans_marche", "https://api.sirenic.eu/v1/eu/entreprise/LV/50203219311/marches-publics", 0.02, (corps) => [
  ok(typeof corps.aucune_attribution === "boolean" && Number(corps.nombre_attributions) === liste(corps.attributions).length, `aucune_attribution = ${String(corps.aucune_attribution)} (${String(corps.nombre_attributions)} attributions, ${String(corps.nombre_avis_emis)} avis émis)`),
  ok(corps.aucune_attribution !== true || entree(corps, "attributions")?.etat === "absence_non_conclusive", `provenance[attributions] = ${String(entree(corps, "attributions")?.etat)} (jamais « absence mesurée » : couverture partielle)`),
  ...commun(corps),
]);

await achat("LV_40003000000_inconnue", "https://api.sirenic.eu/v1/eu/entreprise/LV/40003000000/marches-publics", 0.02, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_inconnue", `numéro inconnu : HTTP ${statut}, ${String(corps.error)}`),
  ok(!regle, `paiement annulé (aucun règlement)`),
]);

L(`**Dépense** : ${depense.toFixed(2)} $ (${compte.address})`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
