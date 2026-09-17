/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 1 Europe — GLEIF niveau 2, bloc `groupe_lei`
 * des fiches, livraison du 17/09/2026). BUT : prouver EN PRODUCTION, par des
 * achats réels, que (1) une fiche française d'un SIREN à LEI porte sa mère de
 * consolidation NOMMÉE (BNP PARIBAS PARTNERS FOR INNOVATION → BNP PARIBAS) ;
 * (2) une fiche européenne d'une entité qui a déclaré une EXCEPTION porte le
 * motif, jamais « société indépendante » (EQUINOR ASA) ; (3) une filiale
 * norvégienne porte ce qu'elle a déclaré (EQUINOR ENERGY AS) ; (4) une fiche
 * à LEI et exception NON_PUBLIC dit le motif (AIRVANCE GROUP) ; (5) une fiche sans
 * LEI dit `sans_objet` et garde son objet (LOG SYSTEM). À lancer APRÈS
 * la première golden copy (`npm run ingestion -- gleif-niveau-2`) — avant, le
 * bloc est un marqueur `collecte_en_cours` et la fiche est servie quand même.
 * COÛT estimé : 0,005 × 3 + 0,01 × 2 = 0,035 $ (USDC, Base mainnet).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-gleif-niveau-2-2026-09-17.ts <commit attendu>
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
const dossier = "resultats/2026-09-17-controle-gleif-niveau-2";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 1 Europe, GLEIF niveau 2 (bloc groupe_lei, 17/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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
const CLES_GROUPE = ["lei", "mere_directe", "mere_ultime", "absence_mere", "declaration", "filiales_consolidees", "fonds", "succursales_internationales", "relations_inactives", "publication"];
const TYPES = ["consolidation_directe", "consolidation_ultime", "fonds_gere_par", "compartiment_de", "succursale_internationale_de", "nourricier_de"];
const resume = (g: Corps) => {
  const md = objet(g.mere_directe); const mu = objet(g.mere_ultime); const ab = objet(g.absence_mere);
  return `declaration=${String(g.declaration)} ; directe=${md.lei ? `${String(md.lei)} ${String(md.denomination)} (${String(md.pays)}, ${String(objet(md.relation).type)})` : `— motif ${String(objet(ab.directe).motif ?? "aucun")}`} ; ultime=${mu.lei ? `${String(mu.lei)} ${String(mu.denomination)}` : `— motif ${String(objet(ab.ultime).motif ?? "aucun")}`} ; filiales ${JSON.stringify(g.filiales_consolidees)} ; publication ${String(g.publication)}`;
};
const verifierServi = (corps: Corps, lei: string): string[] => {
  const g = objet(corps.groupe_lei);
  const cles = Object.keys(g).filter((k) => !CLES_GROUPE.includes(k));
  const types = [objet(g.mere_directe).relation, objet(g.mere_ultime).relation].map((r) => objet(r).type).filter((t) => t !== undefined);
  return [
    ok(g.lei === lei && (corps.lei === undefined || corps.lei === lei), `LEI du bloc = ${String(g.lei)} (fiche : ${String(corps.lei)})`),
    ok(cles.length === 0 && types.every((t) => TYPES.includes(String(t))), `clés du bloc en liste fermée (${cles.length} hors liste), types ${types.join(", ") || "—"}`),
    ok(!/beneficial|beneficiaire|detention|independ/i.test(JSON.stringify(g)), `jamais « détention », « bénéficiaire » ni « indépendante » dans le bloc`),
    `${resume(g)}`,
  ];
};

// (1) BNP PARIBAS PARTNERS FOR INNOVATION (SIREN 433910247, LEI 969500187XEJDC9AXU56) :
// enfant direct de BNP PARIBAS (R0MUWSFPU8MPRO8K5P83) au registre GLEIF, relevé le 17/09/2026.
await achat("FR_433910247_fiche_mere_nommee", "https://api.sirenic.eu/v1/entreprise/433910247", 0.005, (corps) => {
  const g = objet(corps.groupe_lei);
  const md = objet(g.mere_directe);
  return [
    ...verifierServi(corps, "969500187XEJDC9AXU56"),
    ok(md.lei === "R0MUWSFPU8MPRO8K5P83" && /BNP PARIBAS/i.test(String(md.denomination)) && md.pays === "FR", `mère directe nommée : ${String(md.denomination)} (${String(md.lei)})`),
    ok(g.declaration === "relation" && entree(corps, "groupe_lei")?.etat === "servi" && objet(entree(corps, "groupe_lei")?.couverture).etat === "complete", `provenance[groupe_lei] = ${String(entree(corps, "groupe_lei")?.etat)}, couverture ${String(objet(entree(corps, "groupe_lei")?.couverture).etat)}`),
    ok(typeof corps.denomination === "string" && corps.siren === "433910247", `la fiche garde son objet : ${String(corps.denomination)}`),
  ];
});

// (2) EQUINOR ASA (NO 923609016, LEI OW6OFBNCKXC4US5C7523) : exceptions déclarées
// pour les deux parents (liens *-reporting-exception au registre le 17/09/2026).
await achat("NO_923609016_fiche_exception", "https://api.sirenic.eu/v1/eu/entreprise/NO/923609016", 0.01, (corps) => {
  const g = objet(corps.groupe_lei);
  const ab = objet(g.absence_mere);
  return [
    ...verifierServi(corps, "OW6OFBNCKXC4US5C7523"),
    ok(g.mere_directe === null && g.mere_ultime === null && typeof objet(ab.directe).motif === "string" && typeof objet(ab.ultime).motif === "string", `absence de mère MOTIVÉE : directe ${String(objet(ab.directe).motif)} (${String(objet(ab.directe).motif_source)}), ultime ${String(objet(ab.ultime).motif)}`),
    ok(g.declaration === "exception" && objet(entree(corps, "groupe_lei")?.couverture).etat === "complete", `declaration = ${String(g.declaration)}, couverture ${String(objet(entree(corps, "groupe_lei")?.couverture).etat)} (absence mesurée, pas « indépendante »)`),
    ok(Number(objet(g.filiales_consolidees).en_dernier_ressort) > 0, `mère ultime de ${String(objet(g.filiales_consolidees).en_dernier_ressort)} entités (filiales consolidées en dernier ressort)`),
  ];
});

// (3) EQUINOR ENERGY AS (NO 990888213, LEI 98450073EGD581D89F03) : ce que la filiale a déclaré.
await achat("NO_990888213_fiche_filiale", "https://api.sirenic.eu/v1/eu/entreprise/NO/990888213", 0.01, (corps) => [
  ...verifierServi(corps, "98450073EGD581D89F03"),
  ok(["relation", "exception", "aucune"].includes(String(objet(corps.groupe_lei).declaration)) && entree(corps, "groupe_lei")?.etat !== undefined, `provenance[groupe_lei] = ${String(entree(corps, "groupe_lei")?.etat)}`),
]);

// (4) AIRVANCE GROUP (SIREN 490586708, cas connu de CDU) : un LEI (969500Q21MSE49FR6877)
// et deux exceptions NON_PUBLIC (mesuré par le premier achat du 17/09/2026) → absence de mère
// MOTIVÉE « mère non publique », absence MESURÉE (couverture complète), fiche intacte.
await achat("FR_490586708_fiche_exception_non_publique", "https://api.sirenic.eu/v1/entreprise/490586708", 0.005, (corps) => {
  const g = objet(corps.groupe_lei);
  const ab = objet(g.absence_mere);
  return [
    ...verifierServi(corps, "969500Q21MSE49FR6877"),
    ok(g.mere_directe === null && objet(ab.directe).motif === "mere_non_publique" && objet(ab.directe).motif_source === "NON_PUBLIC", `absence de mère motivée : ${String(objet(ab.directe).motif)} (${String(objet(ab.directe).motif_source)})`),
    ok(g.declaration === "exception" && entree(corps, "groupe_lei")?.etat === "absence_mesuree", `declaration = ${String(g.declaration)}, provenance[groupe_lei].etat = ${String(entree(corps, "groupe_lei")?.etat)}`),
    ok(typeof corps.denomination === "string" && corps.siren === "490586708", `la fiche garde son objet : ${String(corps.denomination)}`),
  ];
});

// (5) LOG SYSTEM (SIREN 335146965, cas connu de CDU) : aucun LEI au registre GLEIF
// (vérifié par l'API le 17/09/2026) → sans_objet, fiche intacte.
await achat("FR_335146965_fiche_sans_lei", "https://api.sirenic.eu/v1/entreprise/335146965", 0.005, (corps) => {
  const g = objet(corps.groupe_lei);
  return [
    ok(g.statut === "sans_objet" && g.motif === "aucun_lei", `groupe_lei = ${JSON.stringify(corps.groupe_lei)}`),
    ok(entree(corps, "groupe_lei")?.etat === "sans_objet", `provenance[groupe_lei].etat = ${String(entree(corps, "groupe_lei")?.etat)}`),
    ok(typeof corps.denomination === "string" && corps.siren === "335146965", `la fiche garde son objet : ${String(corps.denomination)}`),
  ];
});

L(`**Dépense** : ${depense.toFixed(3)} $ (${compte.address})`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
