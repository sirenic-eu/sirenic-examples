/**
 * CONTRÔLE POST-DÉPLOIEMENT (09/09/2026) — brique de scoring commune, T0 + T-FR.
 * BUT : prouver EN PRODUCTION, par des achats réels, que (1) une fiche et une
 * liste de comptes européennes portent le bloc `score_defaillance` non évaluable
 * en liste fermée, déclaré par l'enveloppe, et (2) qu'un score français connu de
 * CDU (AIRVANCE GROUP) n'a PAS bougé après le passage à l'assembleur unique.
 * COÛT estimé : 0,01 + 0,02 + 0,10 = 0,13 $ (USDC, Base mainnet).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-evaluabilite-2026-09-09.ts <commit attendu>
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
const dossier = "resultats/2026-09-09-controle-evaluabilite";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — évaluabilité hors de France + assembleur unique (09/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
const L = (x: string) => { lignes.push(x); console.log(x); };
let depense = 0;

async function achat(nom: string, url: string, prix: number, verifier: (corps: Record<string, unknown>) => string[]) {
  const r = await payer(url);
  const texte = await r.text();
  writeFileSync(`${dossier}/${nom}.json`, texte);
  const regle = !!r.headers.get("payment-response");
  if (regle) depense += prix;
  let constats: string[] = [];
  try { constats = verifier(JSON.parse(texte) as Record<string, unknown>); } catch (e) { constats = [`corps illisible : ${String(e)}`]; }
  L(`## ${nom} — HTTP ${r.status}, réglé ${regle ? "oui" : "NON"}, ${texte.length} o`);
  for (const x of constats) L(`- ${x}`);
  L(``);
}

const bloc = (corps: Record<string, unknown>) => corps.score_defaillance as Record<string, unknown> | undefined;
const entree = (corps: Record<string, unknown>, nom: string) => (corps.provenance as Array<Record<string, unknown>> | undefined)?.find((e) => e.bloc === nom);
const ok = (b: boolean, texte: string) => `${b ? "✅" : "❌"} ${texte}`;

await achat("SE_5560401977_fiche", "https://api.sirenic.eu/v1/eu/entreprise/SE/5560401977", 0.01, (corps) => {
  const b = bloc(corps);
  return [
    ok(b?.statut === "non_evaluable", `score_defaillance.statut = ${String(b?.statut)}`),
    ok(JSON.stringify(b?.raisons) === JSON.stringify(["axes_hors_d_atteinte", "zero_indistinguable_de_l_absence", "bareme_non_calibre_pour_le_pays"]), `raisons = ${JSON.stringify(b?.raisons)}`),
    ok(b?.version === "evaluabilite-v1", `version = ${String(b?.version)}`),
    ok(!("score_risque" in corps) && !("classe" in corps), `aucun score_risque ni classe sur la fiche`),
    ok(entree(corps, "score_defaillance")?.etat === "servi", `provenance[score_defaillance].etat = ${String(entree(corps, "score_defaillance")?.etat)}`),
    ok(entree(corps, "fiche") !== undefined, `provenance[fiche] toujours présente`),
  ];
});

await achat("EE_10065093_comptes", "https://api.sirenic.eu/v1/eu/entreprise/EE/10065093/comptes", 0.02, (corps) => {
  const b = bloc(corps);
  const exercices = (corps.exercices as unknown[] | undefined) ?? [];
  return [
    ok(exercices.length === 7, `${exercices.length} exercices (le cas du testeur : sept, 2019 → 2025)`),
    ok(b?.statut === "non_evaluable", `score_defaillance.statut = ${String(b?.statut)}`),
    ok(JSON.stringify(b?.raisons) === JSON.stringify(["axes_hors_d_atteinte", "zero_indistinguable_de_l_absence", "flux_insolvabilite_absent", "bareme_non_calibre_pour_le_pays"]), `raisons = ${JSON.stringify(b?.raisons)}`),
    ok(b?.flux_insolvabilite === "ordonnances_registre", `flux_insolvabilite = ${String(b?.flux_insolvabilite)}`),
    ok(entree(corps, "score_defaillance")?.etat === "servi", `provenance[score_defaillance].etat = ${String(entree(corps, "score_defaillance")?.etat)}`),
    ok(typeof b?.lecture === "string" && !/\d/.test(String(b?.lecture)), `lecture sans chiffre`),
  ];
});

await achat("FR_490586708_score", "https://api.sirenic.eu/v1/score/defaillance/490586708", 0.10, (corps) => [
  ok(typeof corps.score_risque === "number", `AIRVANCE GROUP : score_risque = ${String(corps.score_risque)}, classe = ${String(corps.classe)}, confiance = ${String(corps.confiance)}, version = ${String(corps.version_modele)} (à comparer au jeu de référence : 18 / sain avant le 09/09)`),
  ok(!("score_defaillance" in corps), `aucun bloc d'évaluabilité sur une route française`),
  ok(Array.isArray(corps.composantes), `${(corps.composantes as unknown[] | undefined)?.length ?? 0} composantes, axes calculés : ${JSON.stringify((corps.couverture_axes as Record<string, unknown> | undefined)?.calcules)}`),
]);

L(`Dépense réglée : ${depense.toFixed(2)} $ (estimation 0,13 $).`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
