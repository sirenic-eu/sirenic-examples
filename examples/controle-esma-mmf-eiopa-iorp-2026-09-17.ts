/**
 * CONTRÔLE POST-DÉPLOIEMENT (tranche 3 Europe — fonds monétaires ESMA et registre
 * EIOPA des IORP derrière /v1/eu/agrements, livraison du 17/09/2026). BUT : prouver
 * EN PRODUCTION, par des achats réels, que (1) BNP Paribas Asset Management
 * Luxembourg par LEI reçoit ses fonds monétaires (fonds et gestionnaire, statuts dont
 * Withdrawn servis comme des faits), couverture complète par LEI ; (2) IBM
 * Pensionskasse par LEI reçoit son enregistrement EIOPA (autorité FMA, Autriche),
 * couverture PARTIELLE par LEI ; (3) « Alecta » par nom reçoit l'IORP suédoise,
 * couverture non mesurable par nom ; `blocs_absents` vide, cinq sources attribuées.
 * À lancer APRÈS la première ingestion EIOPA. COÛT estimé : 0,01 × 3 = 0,03 $.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-esma-mmf-eiopa-iorp-2026-09-17.ts <commit attendu>
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
const dossier = "resultats/2026-09-17-controle-esma-mmf-eiopa-iorp";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — tranche 3 Europe, fonds monétaires ESMA + registre EIOPA des IORP (17/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
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
const commun = (corps: Corps): string[] => [
  ok(liste(corps.blocs_absents).length === 0 && Object.keys(objet(corps.sources)).length === 5, `blocs_absents vide, cinq sources attribuées`),
  ok(String(objet(objet(corps.iorp).stock).version ?? "").length === 10, `stock EIOPA du ${String(objet(objet(corps.iorp).stock).version)}`),
  ok(!/@|telephone/i.test(JSON.stringify(objet(corps.fonds_monetaires)) + JSON.stringify(objet(corps.iorp))), `ni contact ni téléphone dans les blocs neufs`),
];

// (1) BNP Paribas Asset Management Luxembourg (B25DM5T7808MMC5QRG60) : gestionnaire de fonds monétaires INSTICASH.
await achat("LEI_B25DM5T7808MMC5QRG60_BNPP_AM_LU", "https://api.sirenic.eu/v1/eu/agrements?q=B25DM5T7808MMC5QRG60", 0.01, (corps) => {
  const mmf = objet(corps.fonds_monetaires); const f = liste(mmf.fonds);
  return [
    ok(Number(mmf.nombre_total) >= 1 && f.every((x) => objet(x.gestionnaire).lei === "B25DM5T7808MMC5QRG60" || x.lei === "B25DM5T7808MMC5QRG60"), `${String(mmf.nombre_total)} fonds monétaires (${f.length} servis, tronqué ${String(mmf.tronque)}) — ${f.slice(0, 3).map((x) => `${String(x.nom)} [${String(x.statut)}]`).join(" ; ")}`),
    ok(f.some((x) => x.statut === "Withdrawn") || f.some((x) => x.statut === "Authorised"), `statuts servis tels que publiés (Authorised / Withdrawn)`),
    // Une liste coupée à 10 est servie « partiel » (troncature dite) : lire `tronque` avant d'attendre un état.
    ok(objet(entree(corps, "fonds_monetaires")?.couverture).etat === "complete" && entree(corps, "fonds_monetaires")?.etat === (mmf.tronque === true ? "partiel" : "servi"), `provenance[fonds_monetaires] = ${String(entree(corps, "fonds_monetaires")?.etat)} (tronqué ${String(mmf.tronque)}), couverture complète (LEI)`),
    ...commun(corps),
  ];
});

// (2) IBM Pensionskasse Aktiengesellschaft (4NG9M4G5BQ2330R10W58) : IORP autrichienne, FMA.
await achat("LEI_4NG9M4G5BQ2330R10W58_IBM_Pensionskasse", "https://api.sirenic.eu/v1/eu/agrements?q=4NG9M4G5BQ2330R10W58", 0.01, (corps) => {
  const i = objet(liste(objet(corps.iorp).institutions)[0]);
  return [
    ok(Number(objet(corps.iorp).nombre_total) === 1 && String(i.nom).startsWith("IBM Pensionskasse") && i.pays_origine === "AUSTRIA" && String(i.autorite).includes("FMA") && i.enregistrement_clos === false, `IORP : ${String(i.nom)}, ${String(i.autorite)}, ${String(i.pays_origine)}, depuis ${String(i.date_debut)}, adresse « ${String(i.adresse)} »`),
    ok(objet(entree(corps, "iorp")?.couverture).etat === "partielle" && entree(corps, "iorp")?.etat === "servi", `provenance[iorp] = ${String(entree(corps, "iorp")?.etat)}, couverture PARTIELLE par LEI (30 % de LEI)`),
    ok(Number(objet(corps.fonds_monetaires).nombre_total) === 0 && entree(corps, "fonds_monetaires")?.etat === "absence_mesuree", `fonds monétaires : zéro mesuré par LEI`),
    ...commun(corps),
  ];
});

// (3) « Alecta » par nom : IORP suédoise (Finansinspektionen), couverture non mesurable par nom.
await achat("nom_Alecta", "https://api.sirenic.eu/v1/eu/agrements?q=Alecta", 0.01, (corps) => {
  const inst = liste(objet(corps.iorp).institutions);
  return [
    ok(inst.some((i) => String(i.nom).includes("Alecta") && i.pays_origine === "SWEDEN"), `IORP : ${inst.map((i) => `${String(i.nom)} (${String(i.pays_origine)})`).join(" ; ")}`),
    ok(objet(entree(corps, "iorp")?.couverture).etat === "non_mesurable", `provenance[iorp] couverture non mesurable (recherche par nom)`),
    ...commun(corps),
  ];
});

L(`**Dépense totale : ${depense.toFixed(2)} $** (attendu 0,03 $ : trois achats à 0,01 $).`);
writeFileSync(`${dossier}/RAPPORT.md`, lignes.join("\n") + "\n");
console.log(`\nrapport : ${dossier}/RAPPORT.md`);
