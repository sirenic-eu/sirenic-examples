/**
 * Smoke PAYANT — accords collectifs d'entreprise (Légifrance, fonds ACCO), route neuve du 13/09/2026.
 *
 *   npx tsx --env-file=.env.wallet-test examples/smoke-accords-collectifs-2026-09-13.ts
 *
 * COÛT ANNONCÉ : **0,02 $** — un appel payé : `GET /v1/entreprise/335146965/accords-collectifs`
 * (LOG SYSTEM : cinq textes publiés sur Légifrance, tous sous la convention 1486). Ce que ce smoke
 * prouve, et que la suite ne prouve pas : que la route est ACHETABLE en prod, que l'API Légifrance
 * répond avec nos identifiants PISTE depuis le serveur, que les métadonnées servies sont celles du
 * registre (nature, thèmes, dates, IDCC cohérente avec Sirene), et que la réponse ne porte ni le
 * texte d'un accord ni un nom de personne. HEAD reste gratuit (405).
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

const SIREN = "335146965";
const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-accords-collectifs-${horodatage}`;
mkdirSync(dossier, { recursive: true });
const echecs: string[] = [];
const verifier = (ok: boolean, quoi: string): void => {
  console.log(`${ok ? "  ok  " : " ÉCHEC"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};
async function devisAnnonce(url: string): Promise<number | null> {
  const r = await fetch(url);
  const entete = r.headers.get("payment-required");
  if (!entete) return null;
  const d = JSON.parse(Buffer.from(entete, "base64").toString()) as { accepts?: Array<{ amount?: string }> };
  return Number(d.accepts?.[0]?.amount ?? NaN);
}
type Obj = Record<string, any>;
const url = `${api}/v1/entreprise/${SIREN}/accords-collectifs`;
const devis = await devisAnnonce(url);
const r = await payer(url);
const brut = await r.text();
writeFileSync(`${dossier}/01-log-system-accords.json`, `HTTP ${r.status}\ndevis annoncé: ${devis}\n${brut}\n`);
const regle = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
writeFileSync(`${dossier}/01-reglement.txt`, String(regle ?? "(aucun en-tête de règlement)"));
console.log(`\naccords LOG SYSTEM → HTTP ${r.status} (devis annoncé ${devis} unités atomiques)`);
let corps: Obj = {};
try { corps = JSON.parse(brut) as Obj; } catch { /* conservé brut */ }

verifier(r.status === 200, "achat → 200");
verifier(devis === 20_000, `devis annoncé = 20 000 unités (0,02 $) — lu ${devis}`);
verifier(Boolean(regle), "en-tête de règlement présent (le paiement a été réglé)");
verifier(corps.siren === SIREN && /LOG SYSTEM/i.test(String(corps.denomination)), `dénomination Sirene servie (${corps.denomination})`);
const s: Obj = corps.synthese ?? {};
const textes: Obj[] = corps.textes ?? [];
verifier((s.nombre_textes ?? 0) >= 5 && textes.length >= 5, `au moins 5 textes (lu ${s.nombre_textes})`);
verifier(textes.every((t) => typeof t.url_legifrance === "string" && t.url_legifrance.startsWith("https://www.legifrance.gouv.fr/acco/id/ACCOTEXT")), "lien Légifrance officiel sur chaque texte");
verifier(textes.every((t) => ["accord", "avenant", "autre", "non_consultee"].includes(String(t.nature))), "nature en liste fermée");
verifier(textes.some((t) => t.detail === "consulte" && t.nature !== "non_consultee"), "les plus récents sont consultés (nature lue)");
verifier(textes.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(String(t.date_signature))), "date de signature sur chaque texte");
verifier(textes.some((t) => Array.isArray(t.themes) && t.themes.includes("Télétravail")), "le thème Télétravail est servi (accord de 2021 et ses avenants)");
verifier(Array.isArray(s.idcc_observees) && s.idcc_observees.includes("1486"), `IDCC 1486 observée (lu ${JSON.stringify(s.idcc_observees)})`);
verifier(["identique", "non_comparable"].includes(String(s.coherence_idcc)), `cohérence IDCC avec Sirene : ${s.coherence_idcc} (jamais « differente » pour LOG SYSTEM)`);
verifier(typeof s.signes_24_mois === "number" && s.signes_24_mois >= 1, `au moins un texte signé sur 24 mois (lu ${s.signes_24_mois})`);
verifier(corps.couverture?.publicite_obligatoire_depuis === "2017-09-01" && typeof corps.couverture?.sirets_interroges === "number", "couverture servie (obligation depuis 2017, SIRET interrogés)");
verifier(/Légifrance/.test(String(corps.source)) && /Licence Ouverte 2\.0/.test(String(corps.source)), "attribution Légifrance + Licence Ouverte 2.0");
verifier(Boolean(corps.consulte_le) && Boolean(corps.disclaimer) && Boolean(corps.data_freshness), "consulte_le, disclaimer et fraîcheur servis");
const bloc = (corps.provenance ?? []).find((p: Obj) => p.bloc === "textes");
verifier(bloc?.source_code === "legifrance_acco" && bloc?.etat === "servi" && bloc?.couverture?.etat === "partielle", `enveloppe : textes servi, couverture partielle (lu ${bloc?.etat} / ${bloc?.couverture?.etat})`);
verifier(!/Monsieur|Madame|repr[ée]sent[ée]e? par|SOUSSIGN|\bM\. [A-Z]|\bMme [A-Z]/.test(brut), "ni texte d'accord ni civilité dans la réponse");
verifier(Boolean(r.headers.get("x-sirenic-signature")), "réponse signée");
const tete = await fetch(url, { method: "HEAD" });
verifier(tete.status === 405, `HEAD → 405 (lu ${tete.status})`);

const resume = [
  `Smoke accords collectifs (Légifrance ACCO) — ${new Date().toISOString()}`,
  `appel payé : 1 × 0,02 $ (LOG SYSTEM ${SIREN}) ; HEAD gratuit`,
  `textes : ${s.nombre_textes} (${textes.length} listés, ${s.nombre_consultes} consultés) ; par nature ${JSON.stringify(s.par_nature)} ; dernier ${s.dernier_texte} ; signés 24 mois ${s.signes_24_mois}`,
  `IDCC ${JSON.stringify(s.idcc_observees)} vs Sirene ${JSON.stringify(s.idcc_sirene)} → ${s.coherence_idcc}`,
  `couverture : ${corps.couverture?.sirets_interroges} SIRET interrogés, ${corps.couverture?.sirets_non_interroges} non interrogés ; enveloppe ${bloc?.etat}`,
  ``,
  echecs.length === 0 ? "RÉSULTAT : tous les contrôles au vert." : `RÉSULTAT : ${echecs.length} ÉCHEC(S)`,
  ...echecs.map((e) => `  - ${e}`),
].join("\n");
writeFileSync(`${dossier}/RESUME.txt`, `${resume}\n`);
console.log(`\n${resume}\n\nRésultats conservés : ${dossier}`);
process.exit(echecs.length === 0 ? 0 : 1);
