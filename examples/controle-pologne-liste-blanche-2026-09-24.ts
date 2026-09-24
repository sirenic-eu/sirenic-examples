/**
 * CONTROLE COMPLEMENTAIRE (ticket #99, 24/09/2026 : marches publics PL, gagnant prouve personne morale PAR LA LISTE BLANCHE TVA).
 * Le controle du 18/09 prouvait M&M JOB CONNECT Sp. z o.o. (6040248554), mais ce NIP est prouve par sa FORME JURIDIQUE (« Sp. z o.o. »
 * dans le nom publie), pas par la liste blanche. BUT : prouver EN PRODUCTION, par un achat reel, le chemin de classification RESTANT,
 * celui de la liste blanche TVA (wl-api.mf.gov.pl) : Powiatowy Bank Spoldzielczy w Gostyniu (NIP 6961002954), nom SANS forme juridique
 * reconnue, classe personne morale le 22/09/2026 a 03:40 UTC par la liste blanche (KRS present, mesure sur la copie restauree du dump
 * du 23/09), est servi comme GAGNANT avec ses deux parties : 2021/BZP 00306682/01 (620 443,62 PLN, stock du rattrapage 2021) et
 * 2026/BZP 00448804/01 (552 906,38 PLN, stock du timer quotidien).
 * COUT estime : 0,02 $ (USDC, Base mainnet).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-pologne-liste-blanche-2026-09-24.ts <commit attendu>
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
const dossier = "resultats/2026-09-24-controle-pologne-liste-blanche";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Controle complementaire ticket #99 : gagnant PL prouve par la liste blanche TVA (24/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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
  L(`## ${nom} : HTTP ${r.status}, regle ${regle ? "oui" : "NON"}, ${texte.length} o`);
  for (const x of constats) L(`- ${x}`);
  L(``);
}
const entree = (corps: Corps, nom: string) => (corps.provenance as Array<Corps> | undefined)?.find((e) => e.bloc === nom);
const ok = (b: boolean, texte: string) => `${b ? "✅" : "❌"} ${texte}`;
const liste = (v: unknown): Corps[] => (Array.isArray(v) ? (v as Corps[]) : []);
// Courriel, rue, code postal polonais : cherches partout SAUF dans l objet du marche (adresse d un lieu de travaux public, legitime).
const sansTracePersonnelle = (corps: Corps) => {
  const copie = JSON.parse(JSON.stringify(corps)) as Corps;
  for (const a of [...liste(copie.attributions), ...liste(copie.avis_emis)]) { delete a.objet; delete a.objet_partie; }
  return !/@|\bul\.\s|\b\d{2}-\d{3}\b/.test(JSON.stringify(copie));
};

// Powiatowy Bank Spoldzielczy w Gostyniu (6961002954) : nom sans forme juridique reconnue, classe par la LISTE BLANCHE (KRS present).
await achat("PL_6961002954_liste_blanche", "https://api.sirenic.eu/v1/eu/entreprise/PL/6961002954/marches-publics", 0.02, (corps) => {
  const attributions = liste(corps.attributions);
  const a2021 = attributions.find((x) => x.avis_id === "2021/BZP 00306682/01");
  const a2026 = attributions.find((x) => x.avis_id === "2026/BZP 00448804/01");
  const prov = entree(corps, "attributions");
  return [
    ok(corps.pays === "PL" && corps.nip === "6961002954" && corps.nature_nip === "personne_morale" && corps.aucune_attribution === false && Number(corps.nombre_attributions) >= 2, `nature ${String(corps.nature_nip)}, ${String(corps.nombre_attributions)} attribution(s)`),
    ok(!!a2021 && a2021.valeur_contrat_pln === 620443.62, `avis 2021/BZP 00306682/01 (rattrapage 2021) : ${a2021 ? `${String(a2021.valeur_contrat_pln)} PLN, ${String(a2021.issue)}` : "ABSENT"}`),
    ok(!!a2026 && a2026.valeur_contrat_pln === 552906.38, `avis 2026/BZP 00448804/01 (timer quotidien) : ${a2026 ? `${String(a2026.valeur_contrat_pln)} PLN, ${String(a2026.issue)}` : "ABSENT"}`),
    ok([a2021, a2026].every((x) => (x?.gagnant as Corps | undefined)?.nom_publie !== undefined && String((x?.gagnant as Corps | undefined)?.nom_publie).includes("Bank")), `gagnant nomme (personne morale prouvee) : ${String((a2021?.gagnant as Corps | undefined)?.nom_publie)}`),
    ok(prov?.etat === "servi" && prov?.source_code === "bzp_pl", `provenance[attributions] = ${String(prov?.etat)} (${String(prov?.source_code)})`),
    ok(String(corps.licence).includes("CC0") && String(corps.source).includes("Urząd Zamówień Publicznych"), `licence : ${String(corps.licence).slice(0, 70)}…`),
    ok(typeof (corps.stock as Corps | undefined)?.depuis === "string" && typeof (corps.stock as Corps | undefined)?.gagnants_a_classer === "number", `stock : ${JSON.stringify(corps.stock)}`),
    ok(sansTracePersonnelle(corps), "aucun courriel, aucune rue, aucun code postal dans la reponse"),
  ];
});

L(`**Depense** : ${depense.toFixed(2)} $ (${compte.address})`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
