/**
 * Vérification PAYANTE de `/sante` v2 en production (~0,65 $).
 *
 * BUT : prouver que la bascule « le modèle coche, le code rédige » est achetable
 * et servie correctement. Deux achats, parce qu'ils éprouvent deux choses
 * différentes qu'aucune vérification gratuite ne voit (leçon du 01/08 : un champ
 * manquant ne se voit que dans le corps PAYANT) :
 *
 *   1. `/v1/entreprise/{siren}/sante` (0,15 $) sur DANONE — cache FROID, donc un
 *      vrai appel de modèle : forme servie (`synthese` + `grille` +
 *      `divergences_modele`), prose FR ET EN, aucun texte inventé, attribution
 *      honnête (le modèle ne rédige pas).
 *   2. `/v1/rapport/{siren}` (0,50 $) sur le MÊME SIREN — le PDF relit la
 *      synthèse en cache : c'est le seul moyen de vérifier que la bascule de
 *      version ne casse pas le rapport, et que sa mention ne dit plus
 *      « Synthèse générée par IA ».
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-sante-v2-2026-08-10.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const api = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const cle = process.env.TEST_WALLET_KEY;
if (!cle?.startsWith("0x")) {
  console.error("TEST_WALLET_KEY manquante (--env-file=.env.wallet-test)");
  process.exit(1);
}
const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(cle as `0x${string}`) });
const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;

const siren = process.argv[2] ?? "552032534";
const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-sante-v2-${horodatage}`;
mkdirSync(dossier, { recursive: true });

// --- 1. /sante ------------------------------------------------------------
const r = await payer(`${api}/v1/entreprise/${siren}/sante`);
console.log(`GET /v1/entreprise/${siren}/sante → HTTP ${r.status}`);
if (r.status !== 200) {
  writeFileSync(`${dossier}/sante-erreur.txt`, await r.text());
  console.error("échec : voir", dossier);
  process.exit(1);
}
const c = (await r.json()) as Record<string, unknown>;
writeFileSync(`${dossier}/sante.json`, JSON.stringify(c, null, 2));
const s = (c.synthese ?? {}) as Record<string, unknown>;
const g = (c.grille ?? {}) as Record<string, unknown>;
const resume = String(s.resume ?? "");
const resumeEn = String(s.resume_en ?? "");

console.log(JSON.stringify({
  version_prompt: c.version_prompt,
  depuis_cache: c.depuis_cache,
  verdict: s.verdict,
  tendance_activite: s.tendance_activite,
  niveau_confiance: s.niveau_confiance,
  divergences: c.divergences_modele,
  longueur_fr: resume.length,
  longueur_en: resumeEn.length,
}, null, 2));
console.log(`\n--- résumé FR ---\n${resume}\n`);

const controles: Array<[string, boolean]> = [
  ["version v2 servie", c.version_prompt === "sante-v2"],
  ["prose FR non vide", resume.length > 300],
  ["prose EN non vide", resumeEn.length > 300],
  ["grille servie en codes", typeof g.verdict === "string" && typeof g.endettement_niveau === "string"],
  ["divergences servies", Array.isArray(c.divergences_modele)],
  ["aucun « undefined » dans la prose", !`${resume}${resumeEn}`.includes("undefined")],
  ["aucun « NaN »", !`${resume}${resumeEn}`.includes("NaN")],
  ["pas de code de tranche pris pour un effectif", !/\b12 salariés\b/.test(resume)],
  ["attribution honnête (assemblé par Sirenic)", String(c.source).includes("assemblés par Sirenic")],
  ["listes bilingues", Array.isArray(s.points_vigilance) && Array.isArray(s.points_vigilance_en)],
];

// --- 2. /rapport (relit la synthèse en cache) -----------------------------
const rp = await payer(`${api}/v1/rapport/${siren}`);
console.log(`\nGET /v1/rapport/${siren} → HTTP ${rp.status} (${rp.headers.get("content-type")})`);
let pdfOctets = 0;
if (rp.status === 200) {
  const buf = Buffer.from(await rp.arrayBuffer());
  pdfOctets = buf.length;
  writeFileSync(`${dossier}/rapport.pdf`, buf);
  const texte = buf.toString("latin1");
  controles.push(
    ["rapport PDF servi", buf.subarray(0, 4).toString() === "%PDF" && pdfOctets > 10_000],
    // Le PDF compresse ses flux : on ne peut pas y chercher une phrase. La
    // preuve utile est qu'il est servi et non vide ; la mention est vérifiée
    // À L'ŒIL sur le fichier conservé.
  );
} else {
  writeFileSync(`${dossier}/rapport-erreur.txt`, await rp.text());
  controles.push(["rapport PDF servi", false]);
}

let ko = 0;
for (const [libelle, ok] of controles) {
  console.log(`${ok ? "✅" : "❌"} ${libelle}`);
  if (!ok) ko++;
}
writeFileSync(`${dossier}/RECAP.md`, [
  `# Smoke payant /sante v2 — ${horodatage}`,
  "",
  `SIREN : ${siren} · version servie : ${String(c.version_prompt)} · cache : ${String(c.depuis_cache)}`,
  `Verdict : ${String(s.verdict)} · tendance : ${String(s.tendance_activite)} · confiance : ${String(s.niveau_confiance)}`,
  `Divergences du modèle : ${JSON.stringify(c.divergences_modele)}`,
  `Rapport PDF : ${pdfOctets} octets`,
  `Contrôles : ${controles.length - ko}/${controles.length}`,
  "",
  "## Résumé FR servi",
  "",
  resume,
  "",
  "## Résumé EN servi",
  "",
  resumeEn,
].join("\n"));

console.log(`\nRésultats conservés : ${dossier}`);
process.exit(ko === 0 ? 0 : 1);
