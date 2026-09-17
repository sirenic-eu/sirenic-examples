/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 1 Europe — Royaume-Uni G1, avis
 * d'insolvabilité de The Gazette, livraison du 16/09/2026). BUT : prouver EN
 * PRODUCTION, par des achats réels, que (1) les avis d'une société en liquidation
 * sont servis avec leur type fermé, leur code, leur date et leur lien, sans
 * aucune donnée personnelle ; (2) une société connue de Companies House sans avis
 * reçoit une réponse positive BORNÉE (couverture partielle, absence non
 * conclusive) ; (3) un numéro inconnu rend 404 SANS règlement. À lancer APRÈS la
 * première collecte (passage quotidien ou rattrapage) — avant, la route rend
 * 503 `collecte_en_cours` et rien n'est débité.
 * COÛT estimé : 0,02 + 0,02 = 0,04 $ (USDC, Base mainnet).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-royaume-uni-gazette-2026-09-16.ts <commit attendu>
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
const dossier = "resultats/2026-09-16-controle-royaume-uni-gazette";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 1 Europe, Royaume-Uni G1 (The Gazette, 16/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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
const CLES_AVIS = ["notice_id", "type", "regime", "code", "libelle_source", "date", "denomination_publiee", "lien", "rattachement"];

// PRIME PSYCHOLOGY LTD (SC540982) : résolution de liquidation (2441) et nomination
// de liquidateurs (2443) publiées le 16/09/2026 — dans le stock dès la première collecte.
await achat("GB_SC540982_annonces", "https://api.sirenic.eu/v1/eu/entreprise/GB/SC540982/annonces", 0.02, (corps) => {
  const a = liste(corps.annonces);
  const stock = corps.stock as Corps | undefined;
  const clesInattendues = a.flatMap((x) => Object.keys(x).filter((k) => !CLES_AVIS.includes(k)));
  return [
    ok(corps.company_number === "SC540982" && corps.aucune_annonce === false && a.length >= 2, `${a.length} avis servis (aucune_annonce = ${String(corps.aucune_annonce)})`),
    ok(a.some((x) => x.type === "nomination_liquidateur" && x.code === 2443) && a.some((x) => x.type === "resolution_liquidation" && x.code === 2441), `types fermés : ${a.map((x) => `${String(x.type)} (${String(x.code)})`).join(", ")}`),
    ok(a.every((x) => x.regime === "liquidation_volontaire_creanciers"), `régime : liquidation volontaire des créanciers`),
    ok(a.every((x) => /^https:\/\/www\.thegazette\.co\.uk\/notice\/\d+$/.test(String(x.lien)) && /^\d{4}-\d{2}-\d{2}$/.test(String(x.date))), `lien et date publiés sur chaque avis`),
    // Le libellé OFFICIEL du type (« Appointment of Liquidators ») et la mention
    // de licence (« no insolvency practitioners ») contiennent le mot : on cherche
    // les traces de praticiens dans les avis SANS leur libellé de type.
    ok(clesInattendues.length === 0 && !/liquidator|practitioner|IPnum|@/i.test(JSON.stringify(a.map(({ libelle_source: _l, ...reste }) => reste))), `aucune clé hors liste, aucune donnée de praticien dans les avis`),
    ok(typeof stock?.depuis === "string" && typeof stock?.avis_en_attente_de_rattachement === "number", `stock : depuis ${String(stock?.depuis)}, ${String(stock?.avis_en_attente_de_rattachement)} avis en attente de rattachement`),
    ok(corps.licence !== undefined && String(corps.licence).includes("Open Government Licence v3.0"), `licence OGL v3.0 servie`),
    ok(entree(corps, "annonces")?.etat === "servi" && (entree(corps, "annonces")?.couverture as Corps | undefined)?.etat === "partielle", `provenance[annonces] = ${String(entree(corps, "annonces")?.etat)}, couverture ${String((entree(corps, "annonces")?.couverture as Corps | undefined)?.etat)}`),
  ];
});

// Société connue de Companies House (MARINE AND GENERAL MUTUAL LIFE ASSURANCE
// SOCIETY, 00000006, dissoute depuis longtemps) : aucun avis depuis le début du
// stock → réponse positive BORNÉE, absence non conclusive.
await achat("GB_00000006_aucune_annonce", "https://api.sirenic.eu/v1/eu/entreprise/GB/00000006/annonces", 0.02, (corps) => [
  ok(corps.aucune_annonce === true && corps.existence_verifiee === true && corps.nombre_annonces === 0, `aucune_annonce = ${String(corps.aucune_annonce)}, existence vérifiée = ${String(corps.existence_verifiee)}`),
  ok(entree(corps, "annonces")?.etat === "absence_non_conclusive", `provenance[annonces].etat = ${String(entree(corps, "annonces")?.etat)} (jamais « absence mesurée » sur un stock borné)`),
]);

await achat("GB_ZZ999999_inconnue", "https://api.sirenic.eu/v1/eu/entreprise/GB/ZZ999999/annonces", 0.02, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_inconnue", `numéro inconnu : HTTP ${statut}, ${String(corps.error)}`),
  ok(!regle, `paiement annulé (aucun règlement)`),
]);

L(`**Dépense** : ${depense.toFixed(2)} $ (${compte.address})`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
