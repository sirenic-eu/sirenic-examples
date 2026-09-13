/**
 * Smoke PAYANT — le contentieux dans le rapport d'intelligence (justice lot 2, 13/09/2026).
 *
 *   npx tsx --env-file=.env.wallet-test examples/smoke-intelligence-contentieux-2026-09-13.ts
 *
 * COÛT ANNONCÉ : **1,00 $** — un seul appel payé : `GET /v1/intelligence/335146965`
 * (LOG SYSTEM, le cas soulevé par CDU le 13/09 : « Sirenic retourne 0 résultat au niveau
 * juridique alors que Pappers en retourne 2 »). Le rapport doit désormais PORTER le bloc
 * `risques.contentieux` (stock Judilibre lu, zéro décision rattachée), dire dans sa synthèse
 * `par_domaine.contentieux = aucune_decision_rattachee`, interdire la conclusion
 * `absence_de_contentieux`, l'écrire dans le résumé, et l'enveloppe doit qualifier ce zéro
 * d'absence NON CONCLUSIVE (couverture partielle mesurée) — jamais « aucun contentieux ».
 * HEAD reste gratuit (405). Aucune donnée du rapport n'est imprimée ici hors compteurs et codes.
 *
 * Ce que ce smoke prouve, et que 4 000 tests verts ne prouvent pas : que le rapport à 1 $ est
 * ACHETABLE en prod avec la version 1.10, que le bloc est servi tel que signé, et que la
 * réponse ne porte ni texte de décision, ni jeton d'occultation, ni nom de personne.
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

const LOG_SYSTEM = "335146965";
const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-intelligence-contentieux-${horodatage}`;
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
const url = `${api}/v1/intelligence/${LOG_SYSTEM}`;
const devis = await devisAnnonce(url);
const r = await payer(url);
const brut = await r.text();
writeFileSync(`${dossier}/01-log-system-intelligence.json`, `HTTP ${r.status}\ndevis annoncé: ${devis}\n${brut}\n`);
const regle = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
writeFileSync(`${dossier}/01-log-system-reglement.txt`, String(regle ?? "(aucun en-tête de règlement)"));
console.log(`\nintelligence LOG SYSTEM → HTTP ${r.status} (devis annoncé ${devis} unités atomiques)`);
let corps: Obj = {};
try {
  corps = JSON.parse(brut) as Obj;
} catch {
  /* corps non-JSON conservé sur disque */
}

verifier(r.status === 200, "achat → 200");
verifier(devis === 1_000_000, `devis annoncé = 1 000 000 unités (1,00 $) — lu ${devis}`);
verifier(Boolean(regle), "en-tête de règlement présent (le paiement a été réglé)");
verifier(corps.version_rapport === "1.10", `version_rapport 1.10 (lu ${corps.version_rapport})`);
const risques: Obj = corps.risques ?? {};
const bloc: Obj | null = risques.contentieux ?? null;
verifier(bloc !== null && typeof bloc === "object", "bloc risques.contentieux présent");
verifier(bloc?.couvert === true, "bloc couvert (personne morale diffusible)");
verifier(bloc?.synthese?.nombre_decisions === 0, `zéro décision rattachée (lu ${bloc?.synthese?.nombre_decisions})`);
verifier(Array.isArray(bloc?.decisions_recentes) && bloc.decisions_recentes.length === 0, "decisions_recentes vide");
verifier(bloc?.tronque_dans_le_rapport === false && bloc?.nombre_decisions_dans_le_rapport === 0, "coupe dite (aucune)");
verifier(bloc?.couverture?.taux_rattachement_mesure === 0.618 && Boolean(bloc?.couverture?.mesure_le), "couverture mesurée servie");
verifier(/Judilibre/.test(String(bloc?.source)) && /Licence Ouverte 2\.0/.test(String(bloc?.source)), "attribution Judilibre + Licence Ouverte 2.0 dans le bloc");
verifier(/ne vaut jamais absence|ne vaut pas absence|jamais absence de contentieux/i.test(String(bloc?.avertissement ?? "")) || Boolean(bloc?.avertissement), "avertissement servi entier");
verifier(Boolean(bloc?.disclaimer) && Boolean(bloc?.consulte_le) && Boolean(bloc?.data_freshness), "disclaimer, consulte_le et data_freshness servis");
const cles = Object.keys(risques);
verifier(cles.indexOf("contentieux") === cles.indexOf("alertes_bodacc") + 1, `ordre : contentieux suit alertes_bodacc dans risques (${cles.join(",")})`);
const synthese: Obj = corps.synthese ?? {};
verifier(synthese.par_domaine?.contentieux === "aucune_decision_rattachee", `par_domaine.contentieux = aucune_decision_rattachee (lu ${synthese.par_domaine?.contentieux})`);
verifier(Array.isArray(synthese.conclusions_interdites) && synthese.conclusions_interdites.includes("absence_de_contentieux"), "conclusion interdite absence_de_contentieux servie");
verifier(/Aucune décision de tribunal de commerce rattachée/.test(String(synthese.resume)) && /ne vaut pas absence de contentieux/.test(String(synthese.resume)), "le résumé dit le zéro ET pourquoi il ne conclut rien");
verifier(!(synthese.points_vigilance ?? []).includes("contentieux_paiement_recent"), "aucun point de vigilance contentieux (zéro décision)");
verifier(!((corps.blocs_manquants ?? []) as Obj[]).some((b) => b.bloc === "contentieux"), "contentieux absent de blocs_manquants (stock lu)");
verifier(/Judilibre/.test(String(corps.source)), "le champ source du rapport cite Judilibre");
const prov: Obj[] = corps.provenance ?? [];
const entree = prov.find((p) => p.bloc === "risques.contentieux");
verifier(Boolean(entree), "enveloppe : une entrée risques.contentieux");
verifier(entree?.etat === "absence_non_conclusive" && entree?.couverture?.etat === "partielle", `enveloppe : absence_non_conclusive, couverture partielle (lu ${entree?.etat} / ${entree?.couverture?.etat})`);
verifier(entree?.source_code === "judilibre_cour_de_cassation", `enveloppe : source judilibre_cour_de_cassation (lu ${entree?.source_code})`);
const blocBrut = JSON.stringify(bloc ?? {});
verifier(!/PAR CES MOTIFS|\[[A-Z]{1,2}\]|"texte"|"text"/.test(blocBrut), "ni texte, ni jeton d'occultation dans le bloc");
// Le corps est signé : la signature Ed25519 voyage dans les en-têtes.
verifier(Boolean(r.headers.get("x-sirenic-signature")) && Boolean(r.headers.get("x-sirenic-key-id")), "réponse signée (x-sirenic-signature, x-sirenic-key-id)");

// HEAD ne s'exécute pas (gratuit)
const tete = await fetch(url, { method: "HEAD" });
verifier(tete.status === 405, `HEAD → 405 (lu ${tete.status})`);

const resume = [
  `Smoke intelligence + contentieux (justice lot 2) — ${new Date().toISOString()}`,
  `appel payé : 1 × 1,00 $ (LOG SYSTEM ${LOG_SYSTEM}) ; HEAD gratuit`,
  `version_rapport ${corps.version_rapport} ; par_domaine.contentieux = ${synthese.par_domaine?.contentieux} ; conclusions_interdites = ${(synthese.conclusions_interdites ?? []).length} codes`,
  `bloc : ${bloc?.synthese?.nombre_decisions} décision(s) rattachée(s), couverture ${bloc?.couverture?.taux_rattachement_mesure} mesurée le ${bloc?.couverture?.mesure_le}`,
  `enveloppe : ${entree?.etat} / ${entree?.couverture?.etat}`,
  `complétude ${corps.score_completude}/100, blocs manquants : ${((corps.blocs_manquants ?? []) as Obj[]).map((b) => b.bloc).join(", ") || "aucun"}`,
  ``,
  echecs.length === 0 ? "RÉSULTAT : tous les contrôles au vert." : `RÉSULTAT : ${echecs.length} ÉCHEC(S)`,
  ...echecs.map((e) => `  - ${e}`),
].join("\n");
writeFileSync(`${dossier}/RESUME.txt`, `${resume}\n`);
console.log(`\n${resume}\n\nRésultats conservés : ${dossier}`);
process.exit(echecs.length === 0 ? 0 : 1);
