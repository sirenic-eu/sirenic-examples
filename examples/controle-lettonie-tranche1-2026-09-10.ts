/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 1 Europe — Lettonie, décisions CDU 3A/4A du
 * 09/09/2026). BUT : prouver EN PRODUCTION, par des achats réels, que (1) les
 * événements de vie lettons sont servis avec leur type en liste fermée et
 * l'institution (le VID nommé, un huissier assermenté servi par son rôle SANS
 * nom), (2) les associés lettons nomment les personnes morales et COMPTENT les
 * personnes physiques, (3) la fiche LV porte le bloc `succursale_etrangere`
 * déclaré par l'enveloppe. À lancer APRÈS la première ingestion complète des 3
 * jeux (cron du 10/09 20:50 UTC ou passage manuel) — avant, les routes rendent
 * 503 `collecte_en_cours` et rien n'est débité.
 * COÛT estimé : 0,02 + 0,02 + 0,02 + 0,01 = 0,07 $ (USDC, Base mainnet).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-lettonie-tranche1-2026-09-10.ts <commit attendu>
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
const dossier = "resultats/2026-09-10-controle-lettonie-tranche1";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 1 Europe, Lettonie (10/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
const L = (x: string) => { lignes.push(x); console.log(x); };
let depense = 0;

type Corps = Record<string, unknown>;
async function achat(nom: string, url: string, prix: number, verifier: (corps: Corps) => string[]) {
  const r = await payer(url);
  const texte = await r.text();
  writeFileSync(`${dossier}/${nom}.json`, texte);
  const regle = !!r.headers.get("payment-response");
  if (regle) depense += prix;
  let constats: string[] = [];
  try { constats = verifier(JSON.parse(texte) as Corps); } catch (e) { constats = [`corps illisible : ${String(e)}`]; }
  L(`## ${nom} — HTTP ${r.status}, réglé ${regle ? "oui" : "NON"}, ${texte.length} o`);
  for (const x of constats) L(`- ${x}`);
  L(``);
}
const entree = (corps: Corps, nom: string) => (corps.provenance as Array<Corps> | undefined)?.find((e) => e.bloc === nom);
const ok = (b: boolean, texte: string) => `${b ? "✅" : "❌"} ${texte}`;
const liste = (v: unknown): Corps[] => (Array.isArray(v) ? (v as Corps[]) : []);

await achat("LV_50203219311_evenements", "https://api.sirenic.eu/v1/eu/entreprise/LV/50203219311/evenements", 0.02, (corps) => {
  const ev = liste(corps.evenements);
  const cessation = ev.find((e) => e.famille === "liquidation");
  const surete = ev.find((e) => e.famille === "surete" && (e.institution as Corps | null)?.type === "administration_fiscale");
  return [
    ok(corps.aucun_evenement === false && ev.length >= 3, `${ev.length} événements, aucun_evenement = ${String(corps.aucun_evenement)}`),
    ok(cessation?.type === "cessation_activite" && cessation?.type_source === "ACTIVITY_TERMINATED", `liquidation : type ${String(cessation?.type)} / ${String(cessation?.type_source)}`),
    ok(typeof cessation?.fondement === "string" && (cessation.fondement as string).includes("valsts notāra"), `fondement du registre servi tel que publié`),
    ok((surete?.institution as Corps | undefined)?.nom === "Valsts ieņēmumu dienests", `sûreté : institution VID nommée (${String((surete?.institution as Corps | undefined)?.nom)})`),
    ok(corps.licence === "Uzņēmumu reģistrs / VID, data.gov.lv, CC0 1.0", `licence CC0 servie`),
    ok(entree(corps, "evenements")?.etat === "servi", `provenance[evenements].etat = ${String(entree(corps, "evenements")?.etat)}`),
  ];
});

await achat("LV_40203472914_evenements_huissier", "https://api.sirenic.eu/v1/eu/entreprise/LV/40203472914/evenements", 0.02, (corps) => {
  const huissiers = liste(corps.evenements).filter((e) => (e.institution as Corps | null)?.type === "huissier_assermente");
  return [
    ok(huissiers.length >= 1, `${huissiers.length} sûreté(s) inscrite(s) par un huissier assermenté`),
    ok(huissiers.every((e) => (e.institution as Corps).nom === null && (e.institution as Corps).regnr === null), `huissier servi par son rôle, jamais par son nom`),
    ok(!/izpildītāj/i.test(JSON.stringify(corps)), `aucun libellé d'huissier dans la réponse`),
  ];
});

await achat("LV_40103774127_associes", "https://api.sirenic.eu/v1/eu/entreprise/LV/40103774127/associes", 0.02, (corps) => {
  const a = liste(corps.associes);
  const pm = a.find((x) => x.type === "personne_morale");
  const pp = a.find((x) => x.type === "personne_physique");
  const capital = corps.capital as Corps | null;
  return [
    ok(corps.nombre_associes === 2, `nombre_associes = ${String(corps.nombre_associes)}`),
    ok(pm?.nom === "JC, Sabiedrība ar ierobežotu atbildību" && pm?.regnr_entite === "40003666739" && pm?.part_capital_pct === 51, `personne morale nommée avec son numéro, 51 % du nominal`),
    ok(pp !== undefined && pp.nom === null && pp.regnr_entite === null && pp.part_capital_pct === 49, `personne physique comptée (49 %), sans nom ni numéro`),
    ok(!("naissance" in (pp ?? {})) && !JSON.stringify(corps).includes("-*****"), `aucune naissance ni kods dans la réponse`),
    ok(capital?.valeur_nominale_totale === 3000 && capital?.devise === "EUR", `capital nominal 3 000 EUR`),
    ok(entree(corps, "associes")?.etat === "servi", `provenance[associes].etat = ${String(entree(corps, "associes")?.etat)}`),
  ];
});

await achat("LV_40003820862_fiche_succursale", "https://api.sirenic.eu/v1/eu/entreprise/LV/40003820862", 0.01, (corps) => {
  const s = corps.succursale_etrangere as Corps | null | undefined;
  const mere = s?.societe_mere as Corps | undefined;
  return [
    ok(s !== undefined && s !== null && s.statut === undefined, `bloc succursale_etrangere servi (pas de marqueur indisponible)`),
    ok(mere?.denomination === "Alas-Kuul AS" && mere?.pays === "EE" && mere?.numero === "10405353", `société mère Alas-Kuul AS (EE, Äriregister 10405353)`),
    ok((s?.capital as Corps | undefined)?.devise === "EUR", `capital dans la devise publiée`),
    ok(entree(corps, "succursale_etrangere")?.etat === "servi", `provenance[succursale_etrangere].etat = ${String(entree(corps, "succursale_etrangere")?.etat)}`),
    ok(entree(corps, "fiche") !== undefined, `provenance[fiche] toujours présente`),
  ];
});

L(`**Dépense** : ${depense.toFixed(2)} $ (${compte.address})`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
