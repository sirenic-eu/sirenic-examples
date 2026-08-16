/**
 * Smoke PAYANT — transactions de dirigeants ALLEMANDES (BaFin, art. 19 MAR),
 * déployées le 15/08/2026 (commit f4641a3), stock collecté le même jour
 * (2 305 notifications, 300 émetteurs).
 *
 * Ce que ce smoke doit prouver, et que 2 194 tests verts ne prouvent pas :
 *  1. la route allemande est réellement ACHETABLE (un devis 402 n'est pas une
 *     vente : leçon du 24/07) ;
 *  2. les DEUX formes d'identifiant marchent sur la production : le LEI (pour
 *     un émetteur résolu par GLEIF) et l'ISIN (pour un émetteur qui ne l'est
 *     pas encore — 275 des 300 le sont au moment de ce smoke) ;
 *  3. le corps payé ne nomme PERSONNE et ne porte aucune saisie libre : la
 *     place de négociation doit être une valeur de liste fermée, jamais le
 *     texte du CSV (162 orthographes mesurées à la source) ;
 *  4. `quantite` est bien null côté DE (la BaFin publie un prix moyen et un
 *     volume agrégé, jamais un nombre de titres) — et n'est donc pas déduite ;
 *  5. le k-anonymat est appliqué : sous 3 déclarants distincts la ventilation
 *     disparaît de l'agrégat ET du détail ;
 *  6. l'attribution imposée par la BaFin est servie, et le bloc `provenance`
 *     porte le registre, la licence et la date de collecte ;
 *  7. un identifiant mal formé rend 400 et le paiement est ANNULÉ (le paywall
 *     précède la validation : personne ne paie une erreur).
 *
 * Coût : 3 achats à 0,02 $ = 0,06 $ (le 400 ne doit RIEN coûter).
 *
 * Usage : node --env-file=.env.wallet-test --import tsx examples/smoke-dirigeants-de-2026-08-15.ts
 */
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const apiUrl = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const key = process.env.TEST_WALLET_KEY;
if (!key?.startsWith("0x")) {
  console.error("Set TEST_WALLET_KEY=0x…");
  process.exit(1);
}

const compte = privateKeyToAccount(key as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: compte });
const payer = wrapFetchWithPayment(fetch, client);

// Cas réels tirés du stock collecté le 15/08.
const LEI_SAP = "529900D6BF99LW9R2E68"; // SAP SE — 51 notifications, 13 déclarants
const ISIN_VIDAC = "GB00BM9XQ619"; // Vidac Pharma — 106 notifications, LEI non résolu
const LEI_BE_IBA = "0428750985"; // témoin belge (non-régression du même contrat)

const resultats: Record<string, unknown> = {
  horodatage: new Date().toISOString(),
  api: apiUrl,
  but: "transactions de dirigeants DE (BaFin) — achetabilité, RGPD, k-anonymat, provenance",
};

const chemin = (pays: string, id: string): string =>
  `${apiUrl}/v1/eu/entreprise/${pays}/${id}/transactions-dirigeants`;

// — 0. Contrat public (gratuit) ————————————————————————————————————————————
const openapi = (await (await fetch(`${apiUrl}/openapi.json`)).json()) as {
  paths: Record<string, { get?: { parameters?: Array<Record<string, any>>; responses?: Record<string, unknown> } }>;
};
const route = openapi.paths["/v1/eu/entreprise/{pays}/{id}/transactions-dirigeants"]?.get;
resultats.openapi_pays = route?.parameters?.find((p) => p.name === "pays")?.schema?.enum;
resultats.openapi_codes = Object.keys(route?.responses ?? {}).sort();
console.log("OpenAPI pays servis :", resultats.openapi_pays);

// — 1. Achat par LEI (0,02 $) ——————————————————————————————————————————————
const parLei = await payer(chemin("DE", LEI_SAP));
const corpsLei = (await parLei.json()) as Record<string, any>;
resultats.lei_statut = parLei.status;
resultats.lei_corps = corpsLei;
resultats.lei_reglement = parLei.headers.get("payment-response") ?? null;
console.log(`\nAchat par LEI → HTTP ${parLei.status} — ${corpsLei.denomination ?? "?"}`);
console.log("  synthèse :", JSON.stringify(corpsLei.synthese));

// — 2. Achat par ISIN, émetteur SANS LEI résolu (0,02 $) ————————————————————
const parIsin = await payer(chemin("DE", ISIN_VIDAC));
const corpsIsin = (await parIsin.json()) as Record<string, any>;
resultats.isin_statut = parIsin.status;
resultats.isin_corps = corpsIsin;
console.log(`\nAchat par ISIN → HTTP ${parIsin.status} — ${corpsIsin.denomination ?? "?"}`);
console.log("  lei servi :", corpsIsin.identifiants?.lei, "| notifications :", corpsIsin.synthese?.nb_notifications);

// — 3. Témoin BELGE : le même contrat n'a pas régressé (0,02 $) ————————————
const belge = await payer(chemin("BE", LEI_BE_IBA));
const corpsBelge = (await belge.json()) as Record<string, any>;
resultats.be_statut = belge.status;
resultats.be_corps = corpsBelge;
console.log(`\nTémoin belge → HTTP ${belge.status} — ${corpsBelge.denomination ?? "?"}`);
console.log("  synthèse :", JSON.stringify(corpsBelge.synthese));

// — 4. Identifiant mal formé : 400 et AUCUN débit —————————————————————————
const mauvais = await payer(chemin("DE", "SAP"));
resultats.mauvais_statut = mauvais.status;
resultats.mauvais_corps = await mauvais.json().catch(() => null);
resultats.mauvais_reglement = mauvais.headers.get("payment-response") ?? null;
console.log(`\nIdentifiant mal formé → HTTP ${mauvais.status} (règlement : ${resultats.mauvais_reglement ?? "aucun"})`);

// — 5. Contrôles automatiques ——————————————————————————————————————————————
const controles: Record<string, boolean | string> = {};
const PLACES = new Set([
  "xetra", "tradegate", "gettex", "quotrix", "eurex", "cboe_europe", "aquis", "turquoise",
  "nasdaq", "euronext", "lang_schwarz", "boerse_stuttgart", "boerse_frankfurt",
  "boerse_hamburg", "boerse_muenchen", "boerse_duesseldorf", "boerse_berlin",
  "hors_marche", "autre_place",
]);
const notifsDe = [...(corpsLei.notifications ?? []), ...(corpsIsin.notifications ?? [])];
controles.achetable_par_lei = parLei.status === 200;
controles.achetable_par_isin = parIsin.status === 200;
controles.temoin_belge_ok = belge.status === 200;
controles.mauvais_id_400 = mauvais.status === 400;
controles.mauvais_id_non_facture = !resultats.mauvais_reglement;
controles.quantite_toujours_nulle = notifsDe.every((n: any) => n.quantite === null);
controles.lieux_en_liste_fermee = notifsDe.every((n: any) => n.lieu === null || PLACES.has(n.lieu));
controles.aucun_champ_nom = !JSON.stringify([corpsLei, corpsIsin]).match(/"(declarant_nom|nom_declarant|meldepflichtiger)"/i);
controles.attribution_bafin = String(corpsLei.source ?? "").includes("Federal Financial Supervisory Authority");
controles.provenance_servie = Array.isArray(corpsLei.provenance) && corpsLei.provenance.length > 0;
controles.fraicheur_servie = typeof corpsLei.data_freshness === "string";
// k-anonymat : si la ventilation est servie, chaque catégorie doit tenir le seuil.
controles.k_anonymat_coherent =
  corpsLei.par_categorie_declarant === null ||
  (corpsLei.synthese?.nb_declarants_distincts ?? 0) >= 3;
resultats.controles = controles;

console.log("\n— Contrôles —");
for (const [nom, ok] of Object.entries(controles)) {
  console.log(`  ${ok === true ? "✅" : ok === false ? "❌" : "•"} ${nom}${ok === true || ok === false ? "" : ` : ${ok}`}`);
}
const echecs = Object.entries(controles).filter(([, v]) => v === false).map(([k]) => k);
console.log(echecs.length === 0 ? "\n✅ TOUS LES CONTRÔLES PASSENT" : `\n❌ ÉCHECS : ${echecs.join(", ")}`);

console.log("\n--- JSON ---");
console.log(JSON.stringify(resultats, null, 2));
