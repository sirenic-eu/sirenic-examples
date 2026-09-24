/**
 * CONTRÔLE POST-DÉPLOIEMENT (bascule du recalcul des benchmarks sectoriels, ticket #102, livraison du 23/09/2026).
 * À lancer APRÈS le premier passage vert du recalcul en prod (`sirenic-benchmarks-secteur.service`). BUT : prouver EN
 * PRODUCTION, par des achats réels, que les critères d'acceptation du ticket sont tenus — les quartiles sectoriels et
 * `lectureSecteur` sont DE NOUVEAU servis sur du stock recalculé :
 * (1) `/v1/secteur/64.20Z/benchmarks` (0,05 $) sert des quartiles de CA complets et ordonnés, et `data_freshness`
 *     porte le stock Sirene 2026-09-01 ET la date du recalcul du jour — la preuve que la table servie est celle de la
 *     bascule, pas la photo du 16/08 (stock 2026-08-01) ;
 * (2) `/v1/intelligence/490586708` (1 $, AIRVANCE GROUP — le cas CONNU de CDU, bilan social « C »,
 *     CA 4,48 M€ publié, secteur 64.20Z à médiane 130 k€ mesurés sur la copie restaurée) sert
 *     `financier.position_secteur` : `benchmarks` (quartiles) et `lecture` en GABARIT POSITIF
 *     (« chiffre d'affaires … médiane de son secteur »), jamais une abstention
 *     (« comparaison sectorielle indisponible / non applicable »).
 * NOTE périmètre : `/sante` et `/comparer`, cités dans la consigne, ne portent AUCUN bloc sectoriel (mesuré au grep
 * le 23/09) — les routes qui servent les critères sont celles-ci.
 * COÛT estimé : 0,05 + 1,00 = 1,05 $ (USDC, Base mainnet).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-benchmarks-bascule-2026-09-23.ts <commit attendu>
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
const dossier = "resultats/2026-09-23-controle-benchmarks-bascule";
mkdirSync(dossier, { recursive: true });
const lignes: string[] = [`# Contrôle post-déploiement — bascule des benchmarks sectoriels, ticket #102 (23/09/2026)`, ``, `Production : commit ${sante.commit}. Portefeuille de test : ${compte.address}.`, ``];
const L = (x: string) => { lignes.push(x); console.log(x); };
let depense = 0;
const aujourdhui = new Date().toISOString().slice(0, 10);

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
const ok = (b: boolean, texte: string) => `${b ? "✅" : "❌"} ${texte}`;
const nombre = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// (1) La route des benchmarks : quartiles complets et ordonnés, fraîcheur du recalcul du jour.
await achat("secteur_6420Z_benchmarks", "https://api.sirenic.eu/v1/secteur/64.20Z/benchmarks", 0.05, (corps, statut) => {
  const fin = corps.finances as Corps | null;
  const ca = (fin?.chiffre_affaires_eur ?? {}) as Corps;
  const mediane = nombre(ca.mediane); const q1 = nombre(ca.q1); const q3 = nombre(ca.q3);
  const freshness = String(corps.data_freshness ?? "");
  return [
    ok(statut === 200 && corps.code_naf === "64.20Z" && corps.niveau === "sous-classe", `code ${String(corps.code_naf)} (${String(corps.niveau)}), ${String((corps.effectif_entreprises as Corps | undefined)?.actives_diffusibles)} actives diffusibles`),
    ok(mediane !== null && q1 !== null && q3 !== null && q1 <= mediane && mediane <= q3 && mediane > 0, `quartiles de CA servis et ordonnés : q1 ${String(q1)} <= médiane ${String(mediane)} <= q3 ${String(q3)}`),
    ok(freshness.includes("2026-09-01"), `stock Sirene du recalcul : ${freshness} (attendu : 2026-09-01, plus jamais 2026-08-01)`),
    ok(freshness.includes(`recalculé le ${aujourdhui}`), `date du recalcul = premier passage vert de la bascule (${aujourdhui})`),
    ok(Array.isArray(corps.provenance) && (corps.provenance as unknown[]).length > 0, `enveloppe provenance[] présente (${String((corps.provenance as unknown[] | undefined)?.length)} entrée(s))`),
  ];
});

// (2) L'intelligence d'AIRVANCE GROUP : le bloc secteur au complet, lecture en gabarit positif.
// La route est /v1/intelligence/{siren} (grille) — le premier essai visait
// /v1/entreprise/{siren}/intelligence, une URL reconstruite : 404 non réglé.
await achat("intelligence_490586708_airvance", "https://api.sirenic.eu/v1/intelligence/490586708", 1.0, (corps, statut) => {
  // Le bloc sectoriel vit à financier.position_secteur (descripteur d'enveloppe
  // « benchmarks_secteur ») — pas à la racine : premier passage jugé à tort.
  const secteur = ((corps.financier as Corps | undefined)?.position_secteur ?? {}) as Corps;
  const bench = (secteur.benchmarks ?? {}) as Corps;
  const ca = ((bench.finances as Corps | undefined)?.chiffre_affaires_eur ?? {}) as Corps;
  const lecture = String(secteur.lecture ?? "");
  const freshness = String(bench.data_freshness ?? "");
  return [
    ok(statut === 200 && secteur.code_naf === "64.20Z", `secteur.code_naf = ${String(secteur.code_naf)}`),
    ok(nombre(ca.mediane) !== null && nombre(ca.q1) !== null && nombre(ca.q3) !== null, `secteur.benchmarks : quartiles de CA servis (médiane ${String(ca.mediane)})`),
    ok(/^chiffre d'affaires/.test(lecture) && lecture.includes("médiane de son secteur"), `lectureSecteur en gabarit POSITIF : « ${lecture.slice(0, 120)}… »`),
    ok(!lecture.includes("comparaison sectorielle"), `aucune abstention (« comparaison sectorielle indisponible / non applicable »)`),
    ok(freshness.includes(`recalculé le ${aujourdhui}`), `le bloc sectoriel lit la table basculée (${freshness})`),
  ];
});

L(`**Dépense** : ${depense.toFixed(2)} $ (${compte.address})`);
writeFileSync(`${dossier}/RECAP.md`, lignes.join("\n") + "\n");
writeFileSync(`${dossier}/recap.json`, JSON.stringify({ date: new Date().toISOString(), commit: sante.commit, portefeuille: compte.address, depense_usd: depense }, null, 2) + "\n");
