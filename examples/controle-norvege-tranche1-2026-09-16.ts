/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 1 Europe — Norvège, décision CDU 3A du
 * 09/09/2026, livraison du 16/09/2026). BUT : prouver EN PRODUCTION, par des
 * achats réels, que (1) les rôles norvégiens sont servis depuis le bulk
 * national (direction, conseil, réviseur entité avec son orgnr), sans AUCUNE
 * date de naissance, en cours par défaut et anciens sur demande ; (2) les unités
 * locales d'Equinor sont servies avec leur effectif publié et le cumul ; (3) la
 * fiche NO porte le bloc `unites_locales` déclaré par l'enveloppe ; (4) un
 * organisasjonsnummer inconnu rend 404 SANS règlement. À lancer APRÈS la première
 * ingestion complète des deux bulks (timer 03:30 UTC ou passage manuel) — avant,
 * les routes rendent 503 `collecte_en_cours` et rien n'est débité.
 * COÛT estimé : 0,01 + 0,01 + 0,01 + 0,01 = 0,04 $ (USDC, Base mainnet) — prix 0,01 $ depuis la
 * décision CDU B du 16/09/2026 (alignement sur GB, LV et DK dirigeants).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-norvege-tranche1-2026-09-16.ts <commit attendu>
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
const dossier = "resultats/2026-09-16-controle-norvege-tranche1";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 1 Europe, Norvège (16/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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
const CLES_PERSONNE = ["type", "prenom", "nom", "decede"];
const CLES_ENTITE = ["type", "orgnr", "nom", "forme_juridique", "radiee", "agrement_source"];

await achat("NO_923609016_dirigeants", "https://api.sirenic.eu/v1/eu/entreprise/NO/923609016/dirigeants", 0.01, (corps) => {
  const m = liste(corps.mandats);
  const organes = new Set(m.map((x) => String(x.organe)));
  const titulaires = m.map((x) => x.titulaire as Corps);
  const revi = m.find((x) => x.role === "reviseur");
  const clesInattendues = titulaires.flatMap((t) => Object.keys(t).filter((k) => !(t.type === "personne" ? CLES_PERSONNE : CLES_ENTITE).includes(k)));
  return [
    ok(corps.denomination === "EQUINOR ASA" && corps.forme_juridique === "ASA", `sujet ${String(corps.denomination)} (${String(corps.forme_juridique)})`),
    ok(Number(corps.nombre_mandats_en_cours) >= 10 && m.length === Number(corps.nombre_mandats_en_cours), `${m.length} mandats en cours servis (compte ${String(corps.nombre_mandats_en_cours)}, anciens ${String(corps.nombre_anciens_mandats)})`),
    ok(organes.has("direction") && organes.has("conseil_administration") && organes.has("reviseur"), `organes : ${[...organes].join(", ")}`),
    ok((revi?.titulaire as Corps | undefined)?.type === "entite" && (revi?.titulaire as Corps | undefined)?.orgnr === "976389387", `réviseur = entité ${String((revi?.titulaire as Corps | undefined)?.nom)} (${String((revi?.titulaire as Corps | undefined)?.orgnr)})`),
    ok(clesInattendues.length === 0 && !/fodsel|naissance|birth/i.test(JSON.stringify(m)), `titulaires : aucune clé hors liste, aucune date de naissance`),
    ok(m.every((x) => x.en_cours === true && x.desinscrit === false), `tous les mandats servis sont en cours (défaut)`),
    ok(corps.licence === "Data from Brønnøysundregistrene, NLOD 2.0", `licence NLOD 2.0 servie`),
    ok(entree(corps, "mandats")?.etat === "servi" && entree(corps, "mandats")?.source_code === "brreg_roller_no", `provenance[mandats] = ${String(entree(corps, "mandats")?.etat)} / ${String(entree(corps, "mandats")?.source_code)}`),
  ];
});

await achat("NO_923609016_dirigeants_anciens", "https://api.sirenic.eu/v1/eu/entreprise/NO/923609016/dirigeants?inclure_anciens=true", 0.01, (corps) => {
  const m = liste(corps.mandats);
  const anciens = m.filter((x) => x.desinscrit === true);
  return [
    ok(corps.inclure_anciens === true, `inclure_anciens = ${String(corps.inclure_anciens)}`),
    ok(m.length === Number(corps.nombre_mandats_en_cours) + Number(corps.nombre_anciens_mandats), `${m.length} mandats = ${String(corps.nombre_mandats_en_cours)} en cours + ${String(corps.nombre_anciens_mandats)} anciens`),
    ok(anciens.length === Number(corps.nombre_anciens_mandats) && anciens.every((x) => x.en_cours === false), `${anciens.length} ancien(s) servi(s) avec en_cours = false`),
  ];
});

await achat("NO_923609016_etablissements", "https://api.sirenic.eu/v1/eu/entreprise/NO/923609016/etablissements", 0.01, (corps) => {
  const u = liste(corps.unites_locales);
  const effectifs = u.map((x) => (typeof x.effectif === "number" ? (x.effectif as number) : null));
  const trie = effectifs.every((e, i) => i === 0 || e === null || (effectifs[i - 1] !== null && (effectifs[i - 1] as number) >= e));
  const cumul = effectifs.filter((e): e is number => e !== null).reduce((s, e) => s + e, 0);
  return [
    ok(Number(corps.nombre_unites_locales) >= 30 && u.length === Number(corps.nombre_unites_locales), `${u.length} unités locales (compte ${String(corps.nombre_unites_locales)})`),
    ok(corps.effectif_cumule === cumul && cumul > 15000, `effectif cumulé ${String(corps.effectif_cumule)} = somme des effectifs publiés (${String(corps.unites_effectif_publie)} unités)`),
    ok(trie, `tri par effectif publié décroissant, non publiés en fin`),
    ok(u.every((x) => /^\d{9}$/.test(String(x.orgnr)) && typeof x.denomination === "string" && (x.activite as Corps | null) !== undefined), `chaque unité porte son orgnr, sa dénomination et son activité`),
    ok(u[0]?.adresse !== undefined && (u[0]?.adresse === null || typeof (u[0]?.adresse as Corps).ville === "string"), `adresse de situation servie (ou null quand non publiée)`),
    ok(!/telefon|epost|hjemmeside|@/.test(JSON.stringify(u)), `aucune coordonnée de contact dans la réponse`),
    ok(entree(corps, "unites_locales")?.etat === "servi" && entree(corps, "unites_locales")?.source_code === "brreg_underenheter_no", `provenance[unites_locales] = ${String(entree(corps, "unites_locales")?.etat)}`),
  ];
});

await achat("NO_923609016_fiche_unites", "https://api.sirenic.eu/v1/eu/entreprise/NO/923609016", 0.01, (corps) => {
  const b = corps.unites_locales as Corps | undefined;
  return [
    ok(b !== undefined && b.statut === undefined && Number(b.nombre) >= 30, `bloc unites_locales servi : nombre ${String(b?.nombre)}, effectif cumulé ${String(b?.effectif_cumule)}`),
    ok(entree(corps, "unites_locales")?.etat === "servi", `provenance[unites_locales].etat = ${String(entree(corps, "unites_locales")?.etat)}`),
    ok(entree(corps, "fiche") !== undefined, `provenance[fiche] toujours présente`),
  ];
});

await achat("NO_999999999_inconnue", "https://api.sirenic.eu/v1/eu/entreprise/NO/999999999/etablissements", 0.01, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_inconnue", `orgnr inconnu : HTTP ${statut}, ${String(corps.error)}`),
  ok(!regle, `paiement annulé (aucun règlement)`),
]);

L(`**Dépense** : ${depense.toFixed(2)} $ (${compte.address})`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
