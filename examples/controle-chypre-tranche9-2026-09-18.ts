/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 9 Europe — Chypre, registre des sociétés du DRCOR, livraison du 18/09/2026).
 * À lancer APRÈS la première collecte mensuelle (timer `sirenic-chypre`, ≈ 5 min). BUT : prouver EN PRODUCTION, par des
 * achats réels, que (1) `/CY/{id}` sert la fiche de Bank of Cyprus (HE 165) depuis la photo DRCOR, avec le bloc
 * `registre_cy` et le siège ; (2) la forme collée depuis le site du DRCOR (« ΗΕ 165 », lettres grecques et espace) est
 * servie sous sa forme canonique et PAYÉE comme l'autre ; (3) `/dirigeants` sert les mandats de Bank of Cyprus, nom et
 * rôle seulement, triés, avec la provenance complète ; (4) une société étrangère radiée sans mandat (AE 1, Cyprus Mines
 * Corporation) rend `aucun_mandat_publie: true` (absence mesurée) ; (5) une liquidation judiciaire (HE 1, Cyprus Popular
 * Bank) sort en statut `autre` avec sa famille ; (6) une enseigne (ΕΕ 44168), un numéro mal formé et un numéro inconnu
 * ne règlent rien (400 / 400 / 404).
 * COÛT estimé : 0,01 × 5 = 0,05 $ (USDC, Base mainnet) ; les trois refus ne règlent rien.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-chypre-tranche9-2026-09-18.ts <commit attendu>
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
const dossier = "resultats/2026-09-18-controle-chypre-tranche9";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 9 Europe, Chypre (18/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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
const FAMILLES_ROLE = new Set(["dirigeant", "dirigeant_suppleant", "secretaire", "secretaire_adjoint", "secretaire_suppleant", "personne_autorisee", "autre", "non_publie"]);

// Bank of Cyprus Public Company Limited, HE 165 : société publique inscrite le 31/12/1943, siège à Strovolos, 12 mandats (photo du 08/09/2026).
await achat("CY_HE165_fiche", "https://api.sirenic.eu/v1/eu/entreprise/CY/HE165", 0.01, (corps) => {
  const r = corps.registre_cy as Corps | undefined;
  return [
    ok(corps.id_national === "HE165" && corps.denomination === "BANK OF CYPRUS PUBLIC COMPANY LIMITED" && corps.statut === "actif", `${String(corps.denomination)} — statut ${String(corps.statut)}, immatriculée le ${String(corps.date_creation)}`),
    ok((corps.forme_juridique as Corps | undefined)?.code === "HE" && String((corps.forme_juridique as Corps | undefined)?.libelle).startsWith("Εταιρεία"), `forme : ${JSON.stringify(corps.forme_juridique)}`),
    ok(typeof (corps.adresse_siege as Corps | undefined)?.code_postal === "string" && (corps.adresse_siege as Corps | undefined)?.pays === "CY", `siège : ${JSON.stringify(corps.adresse_siege)}`),
    ok(r?.statut === "servi" && (r?.etat as Corps | undefined)?.famille === "aucun" && r?.procedure_au_registre === false && Number(r?.mandats_publies) >= 10 && r?.nom_courant_seul === true, `registre_cy : photo ${String(r?.photo)}, sous-type ${String((r?.sous_type as Corps | undefined)?.code)}, ${String(r?.mandats_publies)} mandats publiés`),
    ok(entree(corps, "registre_cy")?.etat === "servi" && entree(corps, "registre_cy")?.source_code === "drcor_cy" && entree(corps, "fiche")?.source_code === "drcor_cy", `provenance[registre_cy] = ${String(entree(corps, "registre_cy")?.etat)} / ${String(entree(corps, "registre_cy")?.source_code)}`),
    ok(String(corps.data_freshness).includes("MENSUELLE") || String(corps.data_freshness).includes("stock"), `fraîcheur : ${String(corps.data_freshness).slice(0, 90)}`),
  ];
});

// La forme du site du DRCOR : « ΗΕ 165 » (Η et Ε grecques, espace) → même société, même prix.
await achat("CY_HE165_forme_grecque", `https://api.sirenic.eu/v1/eu/entreprise/CY/${encodeURIComponent("ΗΕ 165")}`, 0.01, (corps, statut, regle) => [
  ok(statut === 200 && regle && corps.id_national === "HE165", `forme grecque servie sous ${String(corps.id_national)}, réglée`),
]);

// Mandats de Bank of Cyprus : nom + rôle, triés par famille puis nom, provenance complète.
await achat("CY_HE165_dirigeants", "https://api.sirenic.eu/v1/eu/entreprise/CY/HE165/dirigeants", 0.01, (corps) => {
  const m = liste(corps.mandats);
  const familles = m.map((x) => String((x.role as Corps | undefined)?.famille));
  return [
    ok(Number(corps.nombre_mandats) === m.length && m.length >= 10 && corps.aucun_mandat_publie === false, `${m.length} mandats servis (compte ${String(corps.nombre_mandats)})`),
    ok(m.every((x) => typeof x.nom === "string" && FAMILLES_ROLE.has(String((x.role as Corps | undefined)?.famille)) && Object.keys(x).sort().join(",") === "nom,role"), `chaque mandat : nom + rôle en famille fermée, rien d'autre`),
    ok(familles.includes("dirigeant") && familles.includes("secretaire") && familles.indexOf("secretaire") > familles.lastIndexOf("dirigeant"), `administrateurs puis secrétaire : ${[...new Set(familles)].join(", ")}`),
    ok(String(corps.licence).includes("Creative Commons Attribution 4.0"), `licence : CC BY 4.0`),
    ok(entree(corps, "mandats")?.etat === "servi" && entree(corps, "mandats")?.source_code === "drcor_dirigeants_cy" && (entree(corps, "mandats")?.couverture as Corps | undefined)?.etat === "complete", `provenance[mandats] = ${String(entree(corps, "mandats")?.etat)}, couverture ${String((entree(corps, "mandats")?.couverture as Corps | undefined)?.etat)}`),
  ];
});

// Cyprus Mines Corporation, AE 1 : société étrangère radiée en 1974, aucun mandat publié → absence mesurée.
await achat("CY_AE1_dirigeants_aucun", "https://api.sirenic.eu/v1/eu/entreprise/CY/AE1/dirigeants", 0.01, (corps) => [
  ok(corps.aucun_mandat_publie === true && Number(corps.nombre_mandats) === 0 && (corps.type as Corps | undefined)?.code === "AE", `${String(corps.denomination)} : aucun mandat publié (type ${String((corps.type as Corps | undefined)?.code)})`),
  ok(entree(corps, "mandats")?.etat === "absence_mesuree", `provenance[mandats] = ${String(entree(corps, "mandats")?.etat)}`),
]);

// Cyprus Popular Bank Public Co Ltd, HE 1 : liquidation sur ordonnance du tribunal depuis le 31/05/2022.
await achat("CY_HE1_liquidation", "https://api.sirenic.eu/v1/eu/entreprise/CY/HE1", 0.01, (corps) => {
  const r = corps.registre_cy as Corps | undefined;
  return [
    ok(corps.statut === "autre" && String(corps.statut_detail).includes("ordonnance") && (r?.etat as Corps | undefined)?.famille === "liquidation_judiciaire" && r?.procedure_au_registre === true, `${String(corps.denomination)} : ${String(corps.statut_detail)} depuis ${String((r?.etat as Corps | undefined)?.depuis)}`),
  ];
});

// Refus AVANT paiement : enseigne (pas une personne morale), numéro mal formé ; numéro inconnu : 404, paiement annulé.
await achat("CY_EE44168_enseigne", "https://api.sirenic.eu/v1/eu/entreprise/CY/EE44168", 0.01, (corps, statut, regle) => [
  ok(statut === 400 && corps.error === "type_non_servi" && !regle, `enseigne ΕΕ 44168 : HTTP ${statut}, ${String(corps.error)}, aucun règlement`),
]);
await achat("CY_165_mal_forme", "https://api.sirenic.eu/v1/eu/entreprise/CY/165/dirigeants", 0.01, (corps, statut, regle) => [
  ok(statut === 400 && corps.error === "identifiant_invalide" && !regle, `numéro sans préfixe : HTTP ${statut}, ${String(corps.error)}, aucun règlement`),
]);
await achat("CY_HE9999999_inconnu", "https://api.sirenic.eu/v1/eu/entreprise/CY/HE9999999", 0.01, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_inconnue" && !regle, `numéro inconnu : HTTP ${statut}, ${String(corps.error)}, paiement annulé`),
]);

L(`**Dépense** : ${depense.toFixed(2)} $ (${compte.address})`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
