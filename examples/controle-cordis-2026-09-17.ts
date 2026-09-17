/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 2 Europe — CORDIS, financements H2020 et
 * Horizon Europe, livraison du 17/09/2026). BUT : prouver EN PRODUCTION, par des
 * achats réels, que (1) une entreprise française très financée (CEA) reçoit ses
 * projets avec rôle, montants, dates, statut, lien, totaux et troncature dite ;
 * (2) une entreprise privée (ARKEMA) est retrouvée par sa TVA ; (3) une PME sans
 * projet reçoit une réponse positive BORNÉE (absence non conclusive) ; (4) une
 * fiche européenne (SINTEF AS, Norvège ; KU Leuven, Belgique) porte le bloc
 * `financements_ue`. À lancer APRÈS la première ingestion (`npm run ingestion --
 * cordis`) — avant, la route rend 503 `collecte_en_cours` et rien n'est débité.
 * COÛT estimé : 0,02 × 3 + 0,01 × 2 = 0,08 $ (USDC, Base mainnet).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-cordis-2026-09-17.ts <commit attendu>
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
const dossier = "resultats/2026-09-17-controle-cordis";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 2 Europe, CORDIS (financements-ue, 17/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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
const ROLES = ["coordinateur", "participant", "partenaire_associe", "tiers", "partenaire", "partenaire_international", "autre"];
const STATUTS = ["signe", "clos", "termine", "autre"];
const CLES_PROJET = ["id", "programme", "programme_libelle", "acronyme", "titre", "statut", "statut_source", "debut", "fin", "cout_total_eur", "contribution_ue_max_eur", "regime_financement", "appel", "lien", "participation"];
const verifierListe = (corps: Corps): string[] => {
  const p = liste(corps.projets);
  const cles = p.flatMap((x) => Object.keys(x).filter((k) => !CLES_PROJET.includes(k)));
  return [
    ok(p.every((x) => ROLES.includes(String(objet(x.participation).role)) && STATUTS.includes(String(x.statut))), `rôles et statuts en listes fermées sur ${p.length} projets`),
    ok(cles.length === 0 && p.every((x) => /^https:\/\/cordis\.europa\.eu\/project\/id\/\d+$/.test(String(x.lien))), `clés en liste fermée, lien CORDIS sur chaque projet`),
    ok(!/example\.invalid|contactForm|organizationURL|objective/i.test(JSON.stringify(corps)), `ni contact, ni URL d'organisation, ni objectif de projet`),
    ok(String(corps.licence).includes("CC BY 4.0"), `licence CC BY 4.0 servie`),
  ];
};

// (1) CEA (775685019) : plusieurs centaines de participations — la troncature à 100 doit être DITE.
await achat("FR_775685019_CEA", "https://api.sirenic.eu/v1/entreprise/775685019/financements-ue", 0.02, (corps) => {
  const p = liste(corps.projets);
  return [
    ok(Number(corps.nombre_projets) > 100 && p.length === 100 && corps.tronque === true, `${String(corps.nombre_projets)} projets, ${p.length} servis, tronque = ${String(corps.tronque)}`),
    ok(Number(corps.contribution_ue_totale_eur) > 1e8, `contribution de l'UE totale : ${String(corps.contribution_ue_totale_eur)} €`),
    ok(Number(corps.en_cours) > 0 && p[0]?.statut === "signe", `${String(corps.en_cours)} projets en cours, le plus récent d'abord (${String(p[0]?.debut)}, ${String(p[0]?.statut)})`),
    ...verifierListe(corps),
    // Une liste tronquée se déclare « partiel » dans l'enveloppe (pas « servi ») : mesuré au premier achat du 17/09.
    ok(entree(corps, "financements")?.etat === "partiel" && objet(entree(corps, "financements")?.couverture).etat === "partielle" && entree(corps, "financements")?.tronque === true, `provenance[financements] = ${String(entree(corps, "financements")?.etat)} (liste tronquée), couverture partielle`),
  ];
});

// (2) ARKEMA FRANCE SA (319632790) : entreprise privée retrouvée par FR32319632790.
await achat("FR_319632790_ARKEMA", "https://api.sirenic.eu/v1/entreprise/319632790/financements-ue", 0.02, (corps) => {
  const p = liste(corps.projets);
  return [
    ok(Number(corps.nombre_projets) > 0 && corps.aucun_financement === false, `${String(corps.nombre_projets)} projets (${p.filter((x) => x.programme === "HORIZON").length} Horizon Europe, ${p.filter((x) => x.programme === "H2020").length} H2020)`),
    ok(p.every((x) => objet(x.participation).nom_publie !== undefined && objet(x.participation).type_activite === "entreprise_privee"), `type d'activité : entreprise privée sur chaque participation`),
    ...verifierListe(corps),
  ];
});

// (3) LOG SYSTEM (335146965, cas connu de CDU) : aucune participation → réponse positive BORNÉE.
await achat("FR_335146965_aucun_financement", "https://api.sirenic.eu/v1/entreprise/335146965/financements-ue", 0.02, (corps) => [
  ok(corps.aucun_financement === true && corps.nombre_projets === 0 && liste(corps.projets).length === 0, `aucun_financement = ${String(corps.aucun_financement)}`),
  ok(entree(corps, "financements")?.etat === "absence_non_conclusive", `provenance[financements].etat = ${String(entree(corps, "financements")?.etat)} (jamais « absence mesurée » : couverture partielle)`),
  ok(typeof objet(corps.couverture).publication === "string", `couverture : publication ${String(objet(corps.couverture).publication)}`),
]);

// (4) Fiches européennes : SINTEF AS (NO 919303808) et KU LEUVEN (BE 0419052272), présents dans les deux jeux.
for (const [nom, url] of [["NO_919303808_SINTEF", "https://api.sirenic.eu/v1/eu/entreprise/NO/919303808"], ["BE_0419052272_KU_LEUVEN", "https://api.sirenic.eu/v1/eu/entreprise/BE/0419052272"]] as const) {
  await achat(nom, url, 0.01, (corps) => {
    const f = objet(corps.financements_ue);
    return [
      ok(Number(f.nombre_projets) > 0 && liste(f.projets_recents).length === 5 && f.aucun_financement === false, `financements_ue : ${String(f.nombre_projets)} projets, ${liste(f.projets_recents).length} récents servis, ${String(f.contribution_ue_totale_eur)} € de contribution`),
      ok(entree(corps, "financements_ue")?.etat === "servi" && objet(entree(corps, "financements_ue")?.couverture).etat === "partielle", `provenance[financements_ue] = ${String(entree(corps, "financements_ue")?.etat)}, couverture partielle`),
      ok(typeof corps.denomination === "string", `la fiche garde son objet : ${String(corps.denomination)}`),
    ];
  });
}

L(`**Dépense** : ${depense.toFixed(2)} $ (${compte.address})`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
