/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 4 Europe — Croatie, Sudski registar, livraison
 * du 17/09/2026). BUT : prouver EN PRODUCTION, par des achats réels, que (1) la
 * fiche KOESTLIN par OIB porte le bloc registre_hr (tribunal, capital, e-mails,
 * procédure « aucune ») et (2) la même fiche par MBS résout l'OIB ; (3) TIM-PUTEVI
 * est servi en faillite avec sa décision de justice par ses faits (tribunal,
 * référence, date) et jamais son texte ; (4) Zagrebačka banka reçoit ses
 * inscriptions typées, texte servi seulement sur la liste fermée ; (5) KOESTLIN
 * reçoit ses dépôts de comptes (métadonnées) ; (6) un OIB inconnu rend 404 SANS
 * règlement. À lancer APRÈS la première photo. COÛT estimé : 0,07 $.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-croatie-2026-09-17.ts <commit attendu>
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
const dossier = "resultats/2026-09-17-controle-croatie";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 4 Europe, Croatie (Sudski registar), 17/09/2026`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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
const KOESTLIN = "92803032010"; const MBS_KOESTLIN = "10000162"; const TIM = "39620744214"; const ZABA = "92963223473";

await achat("HR_fiche_KOESTLIN_par_OIB", `https://api.sirenic.eu/v1/eu/entreprise/HR/${KOESTLIN}`, 0.01, (corps) => {
  const r = objet(corps.registre_hr);
  return [
    ok(String(corps.denomination).startsWith("KOESTLIN") && corps.statut === "actif" && objet(corps.identifiants).tva === `HR${KOESTLIN}`, `${String(corps.denomination)}, ${String(corps.statut)}, TVA ${String(objet(corps.identifiants).tva)}`),
    ok(r.mbs === MBS_KOESTLIN && objet(r.procedure).code === "aucune" && String(r.tribunal).includes("Trgovački sud") && Number(objet(r.capital).montant) > 0 && liste(r.emails_publies).length >= 1, `registre_hr : MBS ${String(r.mbs)}, ${String(r.tribunal)}, capital ${String(objet(r.capital).montant)} ${String(objet(r.capital).devise)}, photo ${String(r.photo)}`),
    ok(entree(corps, "registre_hr")?.etat === "servi" && objet(entree(corps, "registre_hr")?.couverture).etat === "complete", `provenance[registre_hr] = ${String(entree(corps, "registre_hr")?.etat)}, couverture complète`),
    ok(!/telefon|OIB:\s*\d{11}/i.test(JSON.stringify(r)), `aucune personne, aucun téléphone`),
  ];
});
await achat("HR_fiche_KOESTLIN_par_MBS", `https://api.sirenic.eu/v1/eu/entreprise/HR/${MBS_KOESTLIN}`, 0.01, (corps) => [
  ok(corps.id_national === KOESTLIN, `MBS ${MBS_KOESTLIN} résolu en OIB ${String(corps.id_national)} (décision 2A)`),
]);
await achat("HR_insolvabilite_TIM_PUTEVI", `https://api.sirenic.eu/v1/eu/entreprise/HR/${TIM}/insolvabilite`, 0.02, (corps) => {
  const d = liste(corps.decisions);
  return [
    ok(objet(corps.procedure).code === "faillite" && objet(corps.procedure).en_cours === true && corps.aucune_procedure === false, `procédure ${String(objet(corps.procedure).code)} (${String(objet(corps.procedure).libelle)})`),
    ok(d.length >= 1 && d.every((x) => x.texte_retenu === true && !("texte" in x)) && d.some((x) => x.reference === "St-372/2025" && x.date === "2026-08-21"), `${d.length} décision(s) par leurs faits : ${d.map((x) => `${String(x.tribunal)} ${String(x.reference)} ${String(x.date)}`).join(" ; ")}`),
    ok(String(corps.licence).includes("Otvorena dozvola") && entree(corps, "decisions")?.etat === "servi", `licence servie, provenance[decisions] = ${String(entree(corps, "decisions")?.etat)}`),
  ];
});
await achat("HR_inscriptions_ZAGREBACKA_BANKA", `https://api.sirenic.eu/v1/eu/entreprise/HR/${ZABA}/evenements`, 0.02, (corps) => {
  const ins = liste(corps.inscriptions);
  const servis = ins.filter((i) => i.texte !== null);
  return [
    ok(Number(corps.nombre_inscriptions) === ins.length && ins.length >= 5, `${ins.length} inscriptions, ${String(corps.textes_servis)} textes servis, ${String(corps.textes_retenus)} retenus`),
    ok(ins.filter((i) => i.type_id === 3).every((i) => i.texte === null && i.texte_retenu === true), `statuts (type 3) : texte retenu`),
    ok(servis.every((i) => i.categorie === "acte" && !/\b\d{11}\b|upravitelj|likvidator|direktor/i.test(String(i.texte))), `textes servis : catégorie acte, sans rôle personnel ni OIB`),
    ok(entree(corps, "inscriptions")?.etat === "servi", `provenance[inscriptions] = ${String(entree(corps, "inscriptions")?.etat)}`),
  ];
});
await achat("HR_comptes_KOESTLIN", `https://api.sirenic.eu/v1/eu/entreprise/HR/${KOESTLIN}/comptes`, 0.01, (corps) => {
  const d = liste(corps.depots);
  return [
    ok(Number(corps.nombre_depots) >= 10 && corps.aucun_depot === false && d[0]?.annee === corps.dernier_exercice, `${String(corps.nombre_depots)} dépôts, dernier exercice ${String(corps.dernier_exercice)} (${String(d[0]?.type)}, déposé le ${String(d[0]?.depose_le)})`),
    ok(entree(corps, "depots")?.etat === "servi", `provenance[depots] = ${String(entree(corps, "depots")?.etat)}`),
  ];
});
await achat("HR_inconnu_404", "https://api.sirenic.eu/v1/eu/entreprise/HR/12345678901", 0.01, (corps, statut, regle) => [
  ok(statut === 404 && !regle && corps.error === "entreprise_inconnue", `404 ${String(corps.error)} sans règlement`),
]);
L(`**Dépense totale : ${depense.toFixed(2)} $** (attendu 0,07 $ : cinq achats réglés, un 404 sans règlement).`);
writeFileSync(`${dossier}/RAPPORT.md`, lignes.join("\n") + "\n");
console.log(`\nrapport : ${dossier}/RAPPORT.md`);
