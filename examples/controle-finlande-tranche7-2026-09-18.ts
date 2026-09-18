/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 7 Europe — Finlande, avis du registre du commerce PRH,
 * étape 0 et livraison du 18/09/2026). BUT : prouver EN PRODUCTION, par des achats réels, que
 * (1) `/FI/{id}/evenements` sert les avis du registre de Nokia Oyj en direct depuis la PRH —
 * datés, typés, codes d'inscription traduits en trois langues avec leur famille fermée, registres
 * (TVA active) — sans aucune personne ; (2) la fiche FI porte le bloc `registres_fi` déclaré par
 * l'enveloppe ; (3) un Y-tunnus mal formé (400) et un Y-tunnus inconnu (404) ne règlent rien.
 * Aucune ingestion à attendre : la route est en direct (cache 24 h).
 * COÛT estimé : 0,02 + 0,01 = 0,03 $ (USDC, Base mainnet) ; le 400 et le 404 ne règlent rien.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-finlande-tranche7-2026-09-18.ts <commit attendu>
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
const dossier = "resultats/2026-09-18-controle-finlande-tranche7";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 7 Europe, Finlande (18/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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
const FAMILLES = new Set(["creation", "denomination", "objet", "siege", "direction", "representation", "associes", "capital", "actions", "statuts", "auditeurs", "exercice", "comptes", "faillite", "restructuration", "liquidation", "radiation", "fusion", "scission", "transformation", "hypotheque", "rectification", "autorisation", "autre"]);

// Nokia Oyj : 162 avis depuis le 28/11/2014 (mesuré le 18/09/2026), TVA active, aucune procédure.
await achat("FI_0112038-9_evenements", "https://api.sirenic.eu/v1/eu/entreprise/FI/0112038-9/evenements", 0.02, (corps) => {
  const ev = liste(corps.evenements);
  const inscriptions = ev.flatMap((e) => liste(e.inscriptions));
  return [
    ok(corps.denomination === "Nokia Oyj" && Number(corps.nombre_evenements) >= 162 && ev.length === Number(corps.nombre_evenements), `${ev.length} avis servis (compte ${String(corps.nombre_evenements)}), du ${String(corps.premier_avis_le)} au ${String(corps.dernier_avis_le)}`),
    ok(corps.premier_avis_le === "2014-11-28", `premier avis 28/11/2014 (numérisation PRH)`),
    ok(ev.every((e) => typeof e.date === "string" && typeof e.type === "string" && typeof e.type_source === "string"), `chaque avis : date, type fermé, type_source PRH`),
    ok(inscriptions.length > 0 && inscriptions.every((i) => FAMILLES.has(String(i.famille)) && typeof i.code === "string"), `${inscriptions.length} inscriptions, toutes dans la liste fermée des familles`),
    ok(inscriptions.every((i) => i.libelle === null || (typeof (i.libelle as Corps).en === "string" && typeof (i.libelle as Corps).fi === "string" && typeof (i.libelle as Corps).sv === "string")), `libellés PRH en EN/FI/SV sur chaque code connu (${inscriptions.filter((i) => i.libelle === null).length} inconnu(s))`),
    ok(corps.aucun_avis === false && Array.isArray(corps.procedures_inscrites) && liste(corps.procedures_inscrites).length === 0, `aucune procédure inscrite (faillite, restructuration, liquidation, radiation)`),
    ok(corps.tva_active === true && liste(corps.registres).some((r) => r.registre === "tva"), `registres : ${liste(corps.registres).map((r) => String(r.registre)).join(", ")} ; TVA active ${String(corps.tva_active)}`),
    ok(!/@|hetu|birth|synty/i.test(JSON.stringify(corps.evenements)), `aucune personne, aucun contact dans les avis`),
    ok(String(corps.licence).includes("Creative Commons Attribution 4.0"), `licence CC BY 4.0 servie`),
    ok(entree(corps, "evenements")?.etat === "servi" && entree(corps, "evenements")?.source_code === "prh_ilmoitukset_fi", `provenance[evenements] = ${String(entree(corps, "evenements")?.etat)} / ${String(entree(corps, "evenements")?.source_code)}`),
  ];
});

// Fiche Nokia : bloc registres_fi additif, prix inchangé.
await achat("FI_0112038-9_fiche_registres", "https://api.sirenic.eu/v1/eu/entreprise/FI/0112038-9", 0.01, (corps) => {
  const r = corps.registres_fi as Corps | undefined;
  return [
    ok(r !== undefined && r.statut === "servi" && liste(r.registres).length >= 5, `registres_fi servi : ${liste(r?.registres).length} inscriptions (${liste(r?.registres).map((x) => String(x.registre)).join(", ")})`),
    ok(r?.tva_active === true, `tva_active ${String(r?.tva_active)}`),
    ok(entree(corps, "registres_fi")?.etat === "servi" && entree(corps, "registres_fi")?.source_code === "prh_ilmoitukset_fi", `provenance[registres_fi] = ${String(entree(corps, "registres_fi")?.etat)}`),
    ok(entree(corps, "fiche") !== undefined, `provenance[fiche] toujours présente`),
  ];
});

// Y-tunnus mal formé (400) et inconnu (404) : rien n'est réglé.
await achat("FI_123_mal_forme", "https://api.sirenic.eu/v1/eu/entreprise/FI/123/evenements", 0.02, (corps, statut, regle) => [
  ok(statut === 400 && corps.error === "identifiant_invalide", `Y-tunnus mal formé : HTTP ${statut}, ${String(corps.error)}`),
  ok(!regle, `aucun règlement`),
]);
await achat("FI_9999999-9_inconnu", "https://api.sirenic.eu/v1/eu/entreprise/FI/9999999-9/evenements", 0.02, (corps, statut, regle) => [
  ok(statut === 404 && corps.error === "entreprise_inconnue", `Y-tunnus inconnu : HTTP ${statut}, ${String(corps.error)}`),
  ok(!regle, `paiement annulé (aucun règlement)`),
]);

L(`**Dépense** : ${depense.toFixed(2)} $ (${compte.address})`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
