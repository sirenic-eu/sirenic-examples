/**
 * Smoke PAYANT — décisions des tribunaux de commerce rattachées à une entreprise
 * (`GET /v1/entreprise/{siren}/contentieux`, open data Judilibre).
 *
 *   npx tsx --env-file=.env.wallet-test examples/smoke-contentieux-2026-09-10.ts
 *
 * COÛT ANNONCÉ : **0,02 $** — deux appels payés à 0,01 $ : LOXAM (une société
 * avec plusieurs centaines de décisions, donc une liste TRONQUÉE à 100 et un
 * total annoncé) et DANONE (aucune décision rattachée : la liste vide doit être
 * servie comme une absence NON CONCLUSIVE, jamais comme « aucun contentieux »).
 * Les deux autres appels doivent rendre 404 (SIREN inconnu) et 400 (SIREN mal
 * formé) SANS règlement : le paywall passe avant la validation, le middleware
 * annule le paiement — personne ne paie une erreur.
 *
 * Ce que ce smoke prouve, et que 3 998 tests verts ne prouvent pas : que la
 * route est ACHETABLE sur le rail x402 de production, que le devis annoncé est
 * bien 0,01 $, que la réponse payée ne porte ni texte, ni nom de personne, ni
 * champ inattendu, et que l'enveloppe commune qualifie la couverture.
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

const LOXAM = "450776968";
const DANONE = "552032534";
const INCONNU = "732829320"; // Luhn valide, absent de Sirene → 404
const MAL_FORME = "000000000"; // Luhn « valide » mais sentinelle refusée → 400
const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-contentieux-${horodatage}`;
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

interface Decision {
  id_judilibre?: string;
  date?: string;
  juridiction?: string;
  code_juridiction?: string;
  numero_rg?: string | null;
  chambre?: string | null;
  nature?: string;
  nature_par?: string;
  role?: string;
  mode_rattachement?: string;
  confiance?: string;
  redondante_bodacc?: boolean;
  diffusion_partielle_source?: boolean;
  autres_parties?: Array<{ siren?: string; denomination?: string; role?: string }>;
  url_officielle?: string;
}
interface Corps {
  siren?: string;
  denomination?: string | null;
  exhaustivite?: string;
  couverture?: { taux_rattachement_mesure?: number; mesure_le?: string };
  avertissement?: string;
  derniere_decision_servie_par_la_source?: string | null;
  synthese?: {
    nombre_decisions?: number;
    nombre_decisions_servies?: number;
    nombre_hors_procedure_collective?: number;
    par_nature?: Record<string, number>;
    par_role?: Record<string, number>;
  };
  decisions?: Decision[];
  tronque?: boolean;
  note_troncature?: string;
  source?: string;
  source_mise_a_jour?: string;
  data_freshness?: string;
  provenance?: Array<{ bloc?: string; etat?: string; couverture?: { etat?: string } }>;
  error?: string;
}

async function acheter(nom: string, url: string): Promise<{ statut: number; corps: Corps; devis: number | null; regle: string | null; brut: string }> {
  const devis = await devisAnnonce(url);
  const r = await payer(url);
  const brut = await r.text();
  writeFileSync(`${dossier}/${nom}.json`, `HTTP ${r.status}\ndevis annoncé: ${devis}\n${brut}\n`);
  const regle = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  writeFileSync(`${dossier}/${nom}-reglement.txt`, String(regle ?? "(aucun en-tête de règlement)"));
  console.log(`\n${nom} → HTTP ${r.status} (devis annoncé ${devis} unités atomiques)`);
  let corps: Corps = {};
  try {
    corps = JSON.parse(brut) as Corps;
  } catch {
    /* corps non-JSON conservé sur disque */
  }
  return { statut: r.status, corps, devis, regle, brut };
}

const NATURES = new Set(["procedure_collective", "condamnation_ou_injonction_a_payer", "refere", "expertise_ou_mesure_d_instruction", "litige_commercial_autre", "indeterminee"]);
const ROLES = new Set(["demandeur", "defendeur", "sujet_procedure", "indetermine"]);
const CHAMPS_DECISION = new Set([
  "id_judilibre", "date", "juridiction", "code_juridiction", "numero_rg", "chambre", "nature", "nature_par", "role",
  "mode_rattachement", "confiance", "redondante_bodacc", "diffusion_partielle_source", "autres_parties", "url_officielle",
]);
const chemin = (siren: string): string => `${api}/v1/entreprise/${siren}/contentieux`;

// 1. LOXAM — le cas riche : liste tronquée, total annoncé, autres parties
const loxam = await acheter("01-loxam", chemin(LOXAM));
verifier(loxam.statut === 200, "achat LOXAM → 200");
verifier(loxam.devis === 10000, `devis annoncé = 10000 unités (0,01 $) — lu ${loxam.devis}`);
verifier(Boolean(loxam.regle), "en-tête de règlement présent (le paiement a été réglé)");
verifier(loxam.corps.siren === LOXAM && /LOXAM/i.test(String(loxam.corps.denomination)), `dénomination Sirene servie (${loxam.corps.denomination ?? "—"})`);
verifier(loxam.corps.exhaustivite === "partielle", "exhaustivité annoncée partielle");
verifier(loxam.corps.couverture?.taux_rattachement_mesure === 0.618, `couverture mesurée servie (${loxam.corps.couverture?.taux_rattachement_mesure})`);
const s = loxam.corps.synthese ?? {};
const decisions = loxam.corps.decisions ?? [];
verifier(decisions.length === 100, `100 décisions servies (lu ${decisions.length})`);
verifier(loxam.corps.tronque === true && (s.nombre_decisions ?? 0) > 100, `troncature annoncée avec le total (${s.nombre_decisions})`);
verifier(Boolean(loxam.corps.note_troncature), "note de troncature servie");
verifier((s.nombre_decisions_servies ?? 0) === decisions.length, "nombre_decisions_servies = longueur de la liste");
verifier((s.nombre_hors_procedure_collective ?? -1) <= decisions.length, "compte hors procédure collective borné par la liste");
verifier(decisions.every((d) => NATURES.has(String(d.nature))), "nature toujours en liste fermée");
verifier(decisions.every((d) => ROLES.has(String(d.role))), "rôle toujours en liste fermée");
verifier(decisions.every((d) => /^https:\/\/www\.courdecassation\.fr\/decision\/[0-9a-f]{24}$/.test(String(d.url_officielle))), "lien officiel Judilibre sur chaque décision");
verifier(decisions.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d.date)) && d.juridiction && d.code_juridiction), "date, juridiction et code sur chaque décision (CGU §V)");
const champsInattendus = [...new Set(decisions.flatMap((d) => Object.keys(d)))].filter((c) => !CHAMPS_DECISION.has(c));
verifier(champsInattendus.length === 0, `aucun champ inattendu dans les décisions (${champsInattendus.join(", ") || "aucun"})`);
const autres = decisions.flatMap((d) => d.autres_parties ?? []);
verifier(autres.every((p) => /^\d{9}$/.test(String(p.siren)) && Boolean(p.denomination) && ROLES.has(String(p.role))), `autres parties : SIREN + dénomination Sirene + rôle fermé (${autres.length} parties)`);
verifier(decisions.every((d) => d.redondante_bodacc === (d.nature === "procedure_collective")), "redondante_bodacc ⇔ procédure collective");
verifier(!/"text"|PAR CES MOTIFS|\[[A-Z]{1,2}\]/.test(loxam.brut), "ni texte, ni jeton d'occultation dans la réponse");
verifier(/Judilibre/.test(String(loxam.corps.source)) && /Licence Ouverte 2\.0/.test(String(loxam.corps.source)), "attribution Judilibre + Licence Ouverte 2.0 dans `source`");
verifier(/dernière mise à jour de notre stock : \d{4}-\d{2}-\d{2}/.test(String(loxam.corps.source)), "date de mise à jour du stock dans `source` (CRPA L. 322-1)");
verifier(Boolean(loxam.corps.data_freshness) && Boolean(loxam.corps.source_mise_a_jour), "fraîcheur et date de mise à jour servies");
const blocLoxam = (loxam.corps.provenance ?? []).find((p) => p.bloc === "decisions");
// Une liste TRONQUÉE (283 → 100) est annoncée `partiel` par l'enveloppe — jamais une coupe
// muette ; `servi` n'est attendu que si rien n'a été coupé. Première passe du 10/09 (12:42) :
// l'attente « servi » était celle du harnais, pas du produit (lu `partiel`, motif de troncature).
const etatAttendu = loxam.corps.tronque === true ? "partiel" : "servi";
verifier(blocLoxam?.etat === etatAttendu && blocLoxam?.couverture?.etat === "partielle", `enveloppe : bloc decisions ${etatAttendu} (tronque=${loxam.corps.tronque}), couverture partielle (lu ${blocLoxam?.etat} / ${blocLoxam?.couverture?.etat} / motif ${blocLoxam?.motif ?? "—"})`);

// 2. DANONE — liste vide : une absence NON CONCLUSIVE
const danone = await acheter("02-danone-liste-vide", chemin(DANONE));
verifier(danone.statut === 200, "achat DANONE → 200");
verifier((danone.corps.decisions ?? []).length === 0 && danone.corps.synthese?.nombre_decisions === 0, "liste vide et compteur à 0");
verifier(/ne vaut pas absence de contentieux/.test(String(danone.corps.avertissement)), "l'avertissement dit qu'une absence ne prouve rien");
const blocDanone = (danone.corps.provenance ?? []).find((p) => p.bloc === "decisions");
verifier(blocDanone?.etat === "absence_non_conclusive", `enveloppe : absence NON CONCLUSIVE (lu ${blocDanone?.etat})`);

// 3. SIREN inconnu — 404, aucun règlement
const inconnu = await acheter("03-siren-inconnu", chemin(INCONNU));
verifier(inconnu.statut === 404, `SIREN inconnu → 404 (lu ${inconnu.statut})`);
verifier(!inconnu.regle, "AUCUN règlement sur le 404");

// 4. SIREN mal formé — 400, aucun règlement
const malForme = await acheter("04-siren-mal-forme", chemin(MAL_FORME));
verifier(malForme.statut === 400, `SIREN mal formé → 400 (lu ${malForme.statut})`);
verifier(!malForme.regle, "AUCUN règlement sur le 400");

// 5. HEAD ne s'exécute pas
const tete = await fetch(chemin(LOXAM), { method: "HEAD" });
verifier(tete.status === 405, `HEAD → 405 (lu ${tete.status})`);

const resume = [
  `Smoke contentieux (Judilibre tcom) — ${new Date().toISOString()}`,
  `appels payés : 2 × 0,01 $ = 0,02 $ ; 404 et 400 non débités`,
  `LOXAM : ${s.nombre_decisions} décisions rattachées, ${decisions.length} servies, ${s.nombre_hors_procedure_collective} hors procédure collective, ${autres.length} autres parties`,
  `natures LOXAM : ${JSON.stringify(s.par_nature)}`,
  `DANONE : liste vide, enveloppe ${blocDanone?.etat}`,
  `fraîcheur : ${loxam.corps.data_freshness}`,
  ``,
  echecs.length === 0 ? "RÉSULTAT : tous les contrôles au vert." : `RÉSULTAT : ${echecs.length} ÉCHEC(S)`,
  ...echecs.map((e) => `  - ${e}`),
].join("\n");
writeFileSync(`${dossier}/RESUME.txt`, `${resume}\n`);
console.log(`\n${resume}\n\nRésultats conservés : ${dossier}`);
process.exit(echecs.length === 0 ? 0 : 1);
