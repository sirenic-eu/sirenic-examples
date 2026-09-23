/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 14 Europe — Irlande, registre des sociétés du CRO en open data, livraison du 18/09/2026).
 * À lancer APRÈS la première collecte (`sirenic-irlande`, ≈ 5 min). BUT : prouver EN PRODUCTION, par des achats réels, que
 * (1) `/IE/{numero}` sert VOXCITIO LIMITED (600161) : identité commune + bloc `registre_ie` (statut normal, LTD, Eircode T12 F3FD, NACE 62.01,
 * déclarations annuelles, index des dépôts de comptes) avec la provenance ; (2) `/IE/{numero}/insolvabilite` sert CCT DUBLIN FUNDING
 * DESIGNATED ACTIVITY COMPANY (551667) en liquidation depuis le 08/12/2025 et TFI MARINE LIMITED (408448) sous examinership depuis le
 * 26/06/2026 ; (3) un numéro mal formé et un numéro absent de la photo complète ne règlent rien (400 / 404).
 * COÛT estimé : 0,01 × 3 = 0,03 $ (USDC, Base mainnet) ; les deux refus ne règlent rien.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-irlande-tranche14-2026-09-18.ts <commit attendu>
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
const dossier = "resultats/2026-09-18-controle-irlande-tranche14";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 14 Europe, Irlande, registre CRO (18/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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

// VOXCITIO LIMITED (600161) : LTD active, Cork — fiche commune + bloc registre_ie.
await achat("IE_600161_fiche", "https://api.sirenic.eu/v1/eu/entreprise/IE/600161", 0.01, (corps) => {
  const reg = corps.registre_ie as Corps | undefined;
  const etat = reg?.etat as Corps | undefined;
  const type = reg?.type as Corps | undefined;
  const siege = reg?.siege as Corps | undefined;
  const depots = reg?.depots_comptes as Corps | undefined;
  return [
    ok(corps.pays === "IE" && corps.id_national === "600161" && corps.denomination === "VOXCITIO LIMITED" && corps.statut === "actif", `${String(corps.denomination)} — statut ${String(corps.statut)}, immatriculée le ${String(corps.date_creation)}`),
    ok(reg?.statut === "servi" && etat?.famille === "normal" && type?.famille === "sarl" && reg?.nace_v2 === "62.01", `registre_ie : ${String(reg?.statut)}, statut ${String(etat?.famille)} (${String(etat?.libelle)}), type ${String(type?.famille)}, NACE ${String(reg?.nace_v2)}, photo ${String(reg?.photo)}`),
    ok(siege?.eircode === "T12 F3FD" && liste(siege?.lignes).length > 0, `siège : ${JSON.stringify(siege)}`),
    ok(typeof (reg?.declarations_annuelles as Corps | undefined)?.derniere_le === "string", `déclarations annuelles : ${JSON.stringify(reg?.declarations_annuelles)} ; derniers comptes ${String(reg?.derniers_comptes_le)}`),
    ok(depots?.statut === "servi" && liste(depots?.depots).length >= 1, `dépôts de comptes : ${String(depots?.statut)}, ${String(liste(depots?.depots).length)} dépôt(s) (${JSON.stringify(depots?.annees)})`),
    ok(entree(corps, "registre_ie")?.etat === "servi" && entree(corps, "registre_ie")?.source_code === "cro_ie", `provenance[registre_ie] = ${String(entree(corps, "registre_ie")?.etat)} (${String(entree(corps, "registre_ie")?.source_code)})`),
    ok(String(corps.registre).includes("Companies Registration Office"), `registre : ${String(corps.registre)}`),
  ];
});
// CCT DUBLIN FUNDING DAC (551667) : en liquidation depuis le 08/12/2025.
await achat("IE_551667_liquidation", "https://api.sirenic.eu/v1/eu/entreprise/IE/551667/insolvabilite", 0.01, (corps) => {
  const p = liste(corps.procedures)[0];
  return [
    ok(corps.procedure_au_registre === true && Number(corps.nombre_procedures) === 1 && p?.nature === "liquidation" && p?.depuis === "2025-12-08", `${String(corps.denomination)} : ${String(p?.nature)} depuis ${String(p?.depuis)} (${String(p?.libelle_registre)})`),
    ok(entree(corps, "procedures")?.etat === "servi" && entree(corps, "procedures")?.source_code === "cro_ie", `provenance[procedures] = ${String(entree(corps, "procedures")?.etat)}`),
    ok(String(corps.licence).includes("CC BY 4.0"), `licence : ${String(corps.licence).slice(0, 60)}…`),
  ];
});
// TFI MARINE LIMITED (408448) : sous examinership depuis le 26/06/2026 (trois sociétés dans ce statut le 18/09/2026).
await achat("IE_408448_examinership", "https://api.sirenic.eu/v1/eu/entreprise/IE/408448/insolvabilite", 0.01, (corps) => {
  const p = liste(corps.procedures)[0];
  return [ok(p?.nature === "examinership" && p?.depuis === "2026-06-26" && (corps.radiation as Corps | undefined)?.en_cours === false, `${String(corps.denomination)} : ${String(p?.nature)} depuis ${String(p?.depuis)}`)];
});
await achat("IE_mal_forme", "https://api.sirenic.eu/v1/eu/entreprise/IE/abc", 0.01, (corps, statut, regle) => [
  ok(statut === 400 && corps.error === "identifiant_invalide" && !regle, `numéro mal formé : HTTP ${statut}, ${String(corps.error)}, aucun règlement`),
]);
await achat("IE_9999999_inconnu", "https://api.sirenic.eu/v1/eu/entreprise/IE/9999999/insolvabilite", 0.01, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_inconnue" && !regle, `numéro absent de la photo complète : HTTP ${statut}, ${String(corps.error)}, paiement annulé`),
]);

L(`**Dépense** : ${depense.toFixed(2)} $ (${compte.address})`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
