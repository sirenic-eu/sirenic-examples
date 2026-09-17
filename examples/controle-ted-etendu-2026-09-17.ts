/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 2 Europe — TED étendu aux neuf pays servis,
 * livraison du 17/09/2026). BUT : prouver EN PRODUCTION, par des achats réels, que
 * (1) une société lettone gagnante reçoit ses avis TED rapprochés par identifiant
 * national (acheteur, objet, montant, CPV, lien officiel) avec la couverture
 * PARTIELLE dite au taux du pays ; (2) une société norvégienne aussi, cherchée sous
 * ses deux formes (« 962392687 », « 962 392 687 ») ; (3) une société connue du
 * registre sans avis reçoit un zéro dit NON conclusif ; (4) un identifiant inconnu
 * du registre rend 404 SANS règlement ; (5) un pays non servi rend 404 SANS règlement.
 * COÛT estimé : 0,02 × 3 = 0,06 $ (USDC, Base mainnet).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-ted-etendu-2026-09-17.ts <commit attendu>
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
const dossier = "resultats/2026-09-17-controle-ted-etendu";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 2 Europe, TED étendu aux neuf pays servis (17/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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
const CLES = ["reference_ted", "date_publication", "type_avis", "objet", "acheteur", "montant_avis", "codes_cpv", "co_titulaires", "identifiants_gagnants", "lien_ted", "correspondance"];
const commun = (corps: Corps, pays: string, id: string, taux: string): string[] => {
  const a = liste(corps.avis);
  return [
    ok(corps.pays === pays && corps.id_national === id && liste(corps.variantes_identifiant).length >= 1, `pays ${String(corps.pays)}, identifiant ${String(corps.id_national)}, formes cherchées : ${JSON.stringify(corps.variantes_identifiant)}`),
    ok(a.every((x) => Object.keys(x).every((k) => CLES.includes(k)) && /^https:\/\/ted\.europa\.eu\//.test(String(x.lien_ted)) && objet(x.correspondance).methode === "identifiant"), `clés en liste fermée, lien TED officiel, correspondance par identifiant sur ${a.length} avis`),
    ok(String(corps.disclaimer).includes(`${taux} %`) && String(corps.disclaimer).includes("NON conclusive"), `disclaimer au taux mesuré du pays (${taux} %), zéro = absence non conclusive`),
    ok(!/@|telephone|"contact"|streetAddress/i.test(JSON.stringify(corps)), `ni contact, ni adresse, ni personne`),
    ok(typeof corps.consulte_le === "string" && String(corps.data_freshness).includes("24 h"), `consulté le ${String(corps.consulte_le)}, ${String(corps.data_freshness)}`),
  ];
};

// (1) SIA NORDE (LV 40003242722) : 16 avis d'attribution sur TED le 17/09/2026 (dernier : 642517-2026, Gatartas pakalpojumu aģentūra, 61 132,23 €).
await achat("LV_40003242722_NORDE", "https://api.sirenic.eu/v1/eu/entreprise/LV/40003242722/marches-publics-ue", 0.02, (corps) => {
  const a = liste(corps.avis);
  const dernier = objet(a[0]);
  return [
    ok(Number(corps.nombre_avis) >= 10 && Number(corps.nombre_retourne) === a.length, `${String(corps.nombre_avis)} avis, ${a.length} retournés, tronqué ${String(corps.tronque)}`),
    ok(String(objet(dernier.acheteur).pays) === "LVA" && typeof objet(dernier.montant_avis).valeur === "number" && liste(dernier.identifiants_gagnants).includes("40003242722" as unknown as Corps), `dernier : ${String(dernier.date_publication)}, ${String(objet(dernier.acheteur).nom)}, ${String(objet(dernier.montant_avis).valeur)} ${String(objet(dernier.montant_avis).devise)}, CPV ${JSON.stringify(dernier.codes_cpv)}`),
    ...commun(corps, "LV", "40003242722", "64"),
    ok(entree(corps, "avis")?.etat === "servi" && objet(entree(corps, "avis")?.couverture).etat === "partielle", `provenance[avis] = ${String(entree(corps, "avis")?.etat)}, couverture partielle`),
  ];
});

// (2) NORCONSULT NORGE AS (NO 962392687) : 147 avis sur TED le 17/09/2026, forme espacée cherchée aussi.
await achat("NO_962392687_NORCONSULT", "https://api.sirenic.eu/v1/eu/entreprise/NO/962392687/marches-publics-ue", 0.02, (corps) => [
  ok(Number(corps.nombre_avis) >= 50 && corps.tronque === true && liste(corps.avis).length === 50, `${String(corps.nombre_avis)} avis, ${liste(corps.avis).length} retournés, troncature dite : ${String(corps.tronque)}`),
  ok(JSON.stringify(corps.variantes_identifiant) === JSON.stringify(['"962392687"', '"962 392 687"']), `deux formes cherchées (compacte et espacée)`),
  ok(liste(corps.avis).every((x) => objet(x.acheteur).pays === "NOR" || objet(x.acheteur).pays === null), `acheteurs norvégiens`),
  ...commun(corps, "NO", "962392687", "72"),
]);

// (3) Alas Kuul AS filiāle Latvijā (LV 40003820862) : succursale connue du registre, aucun avis attendu → zéro NON conclusif.
await achat("LV_40003820862_sans_avis", "https://api.sirenic.eu/v1/eu/entreprise/LV/40003820862/marches-publics-ue", 0.02, (corps) => [
  ok(typeof corps.nombre_avis === "number", `${String(corps.nombre_avis)} avis`),
  ok(Number(corps.nombre_avis) === 0 ? entree(corps, "avis")?.etat === "absence_non_conclusive" : entree(corps, "avis")?.etat === "servi", `provenance[avis] = ${String(entree(corps, "avis")?.etat)} (jamais absence_mesuree)`),
  ...commun(corps, "LV", "40003820862", "64"),
]);

// (4) Identifiant inconnu du registre letton (40003000000) : 404 SANS règlement.
await achat("LV_40003000000_inconnue", "https://api.sirenic.eu/v1/eu/entreprise/LV/40003000000/marches-publics-ue", 0.02, (corps, statut, regle) => [
  ok(statut === 404 && !regle, `404 sans règlement : ${String(corps.error)}`),
]);

// (5) Pays non servi (PL) : le paywall précède la validation → 404 pays_non_couvert, paiement annulé, jamais réglé.
await achat("PL_pays_non_couvert", "https://api.sirenic.eu/v1/eu/entreprise/PL/0000123456/marches-publics-ue", 0.02, (corps, statut, regle) => [
  ok(statut === 404 && !regle && corps.error === "pays_non_couvert", `404 ${String(corps.error)} sans règlement`),
]);

L(`**Dépense totale : ${depense.toFixed(2)} $** (attendu 0,06 $ : trois achats réglés, deux 404 sans règlement).`);
writeFileSync(`${dossier}/RAPPORT.md`, lignes.join("\n") + "\n");
console.log(`\nrapport : ${dossier}/RAPPORT.md`);
