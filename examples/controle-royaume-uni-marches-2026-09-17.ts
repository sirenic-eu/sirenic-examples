/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 2 Europe — marchés publics britanniques,
 * Find a Tender + Contracts Finder, livraison du 17/09/2026). BUT : prouver EN
 * PRODUCTION, par des achats réels, que (1) une société fournisseuse reçoit ses
 * attributions FTS (acheteur, contrat, valeur GBP, dates, statut, lien) ; (2) une
 * société fournisseuse sur Contracts Finder aussi ; (3) une société connue de
 * Companies House sans marché reçoit un fait positif BORNÉ ; (4) un numéro
 * inconnu rend 404 SANS règlement. À lancer APRÈS le passage du jour.
 * COÛT estimé : 0,02 × 3 = 0,06 $ (USDC, Base mainnet).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-royaume-uni-marches-2026-09-17.ts <commit attendu>
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
const dossier = "resultats/2026-09-17-controle-royaume-uni-marches";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 2 Europe, marchés publics britanniques FTS + CF (17/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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
const CLES = ["ocid", "award_id", "source", "publie_le", "titre", "valeur", "devise", "date_attribution", "date_signature", "debut", "fin", "statut", "acheteur", "fournisseur", "lien"];
const commun = (corps: Corps): string[] => {
  const a = liste(corps.attributions);
  return [
    ok(a.every((x) => ["fts", "cf"].includes(String(x.source)) && Object.keys(x).every((k) => CLES.includes(k)) && /^https:\/\/www\.(find-tender|contractsfinder)\.service\.gov\.uk\//.test(String(x.lien))), `sources fts | cf, clés en liste fermée, lien officiel sur ${a.length} attributions`),
    ok(!/contactPoint|@|streetAddress|"documents"/i.test(JSON.stringify(corps)), `ni contact, ni adresse, ni document`),
    ok(String(corps.licence).includes("Open Government Licence") && typeof objet(objet(corps.stock).fts).dernier_jour_collecte === "string", `licence OGL v3 servie, stock FTS jusqu'au ${String(objet(objet(corps.stock).fts).dernier_jour_collecte)}, CF jusqu'au ${String(objet(objet(corps.stock).cf).dernier_jour_collecte)}`),
  ];
};

// (1) CHANGEMAKER ASSOCIATES LIMITED (10868035) : attribution FTS du 16/09/2026 (Dacorum Borough Council, 36 606,36 £).
await achat("GB_10868035_CHANGEMAKER", "https://api.sirenic.eu/v1/eu/entreprise/GB/10868035/marches-publics", 0.02, (corps) => {
  const a = liste(corps.attributions);
  const derniere = objet(a[0]);
  return [
    ok(Number(corps.nombre_attributions) >= 1 && corps.aucune_attribution === false, `${String(corps.nombre_attributions)} attributions, ${String(corps.valeur_totale_gbp)} £ au total`),
    ok(String(objet(derniere.acheteur).nom).length > 0 && typeof derniere.valeur === "number" && /^\d{4}-\d{2}-\d{2}$/.test(String(derniere.publie_le)), `dernière : ${String(derniere.publie_le)}, ${String(objet(derniere.acheteur).nom)}, ${String(derniere.valeur)} ${String(derniere.devise)}, statut ${String(derniere.statut)}`),
    ...commun(corps),
    ok(entree(corps, "attributions")?.etat === "servi" && objet(entree(corps, "attributions")?.couverture).etat === "partielle", `provenance[attributions] = ${String(entree(corps, "attributions")?.etat)}, couverture partielle`),
  ];
});

// (2) FIVE POINTS DIGITAL HEALTH LTD (11349181) : attribution Contracts Finder (Innovate UK, 2 320 £).
await achat("GB_11349181_FIVE_POINTS", "https://api.sirenic.eu/v1/eu/entreprise/GB/11349181/marches-publics", 0.02, (corps) => [
  ok(liste(corps.attributions).some((x) => x.source === "cf"), `${String(corps.nombre_attributions)} attributions dont Contracts Finder`),
  ...commun(corps),
]);

// (3) MARINE AND GENERAL MUTUAL LIFE ASSURANCE SOCIETY (00000006) : connue de Companies House, aucun marché → fait positif borné.
await achat("GB_00000006_aucun_marche", "https://api.sirenic.eu/v1/eu/entreprise/GB/00000006/marches-publics", 0.02, (corps) => [
  ok(corps.aucun_marche === true && corps.existence_verifiee === true && corps.nombre_attributions === 0, `aucun_marche = ${String(corps.aucun_marche)}, existence vérifiée = ${String(corps.existence_verifiee)}`),
  ok(entree(corps, "attributions")?.etat === "absence_non_conclusive", `provenance[attributions].etat = ${String(entree(corps, "attributions")?.etat)} (jamais « absence mesurée » : couverture partielle)`),
]);

await achat("GB_ZZ999999_inconnue", "https://api.sirenic.eu/v1/eu/entreprise/GB/ZZ999999/marches-publics", 0.02, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_inconnue", `numéro inconnu : HTTP ${statut}, ${String(corps.error)}`),
  ok(!regle, `paiement annulé (aucun règlement)`),
]);

L(`**Dépense** : ${depense.toFixed(2)} $ (${compte.address})`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
