/**
 * Vérification PAYANTE du barème v1.6 en production (5 × 0,10 $ = 0,50 $).
 *
 * v1.6 : une classe de risque ne se fabrique plus ni sur une absence de comptes
 * (F-01), ni sur une entreprise qui n'exerce plus. Un devis 402 ne prouve rien
 * — le correctif vit dans le CORPS payant, et la seule preuve est l'achat
 * (leçon du 01/08).
 *
 * Les cinq SIREN — les témoins de CDU, plus les deux cas réels du chantier :
 *  - 100000025 ZAKADO — jeune, ZÉRO compte : doit BASCULER en « indetermine » ;
 *  - 301860763 SCEB DUFOUR — CESSÉE à comptes 2024 sains : doit BASCULER en
 *    « cessee » (elle était vendue « score 15, sain, risque faible ») ;
 *  - 490586708 AIRVANCE GROUP — doit rester 18 / sain ;
 *  - 552032534 DANONE — doit rester 22 / sain ;
 *  - 542065479 STELLANTIS AUTO — doit rester 42 / vigilance.
 *
 * Les réponses complètes sont conservées (règle CDU) puis commitées sur le
 * dépôt privé de traces.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-score-v16.ts
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

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-score-v16-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const echecs: string[] = [];
const verifier = (ok: boolean, quoi: string): void => {
  console.log(`  ${ok ? "ok   " : "ÉCHEC"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};

interface Corps {
  score_risque?: number;
  classe?: string;
  risque_12m?: string;
  confiance?: string;
  exercice_reference?: string | null;
  version_modele?: string;
  note_classe?: string;
  note_donnees?: string;
  note_confiance?: string;
  composantes?: Array<{ axe: string; indicateur: string; points: number }>;
}

/** Attendu par SIREN : ce que CDU a validé en étape 0, et rien d'autre. */
const CAS: Array<{ siren: string; nom: string; classe: string; score?: number; noteClasse: boolean }> = [
  { siren: "100000025", nom: "ZAKADO (0 compte)", classe: "indetermine", score: 8, noteClasse: true },
  { siren: "301860763", nom: "SCEB DUFOUR (cessée, comptes sains)", classe: "cessee", score: 15, noteClasse: true },
  { siren: "490586708", nom: "AIRVANCE GROUP", classe: "sain", score: 18, noteClasse: false },
  { siren: "552032534", nom: "DANONE", classe: "sain", score: 22, noteClasse: false },
  { siren: "542065479", nom: "STELLANTIS AUTO", classe: "vigilance", score: 42, noteClasse: false },
];

for (const cas of CAS) {
  console.log(`\n— ${cas.nom} (${cas.siren})`);
  const r = await payer(`${api}/v1/score/defaillance/${cas.siren}`);
  console.log(`  HTTP ${r.status}`);
  if (r.status !== 200) {
    echecs.push(`${cas.siren} : HTTP ${r.status}`);
    console.error(await r.text());
    continue;
  }
  const c = (await r.json()) as Corps;
  writeFileSync(`${dossier}/${cas.siren}.json`, JSON.stringify(c, null, 2));
  console.log(
    `  score ${String(c.score_risque)} | classe ${String(c.classe)} | ${String(c.risque_12m)} | ` +
      `confiance ${String(c.confiance)} | ${String(c.version_modele)}`,
  );
  verifier(c.version_modele === "defaillance-v1.6", "barème v1.6 servi");
  verifier(c.classe === cas.classe, `classe attendue « ${cas.classe} »`);
  if (cas.score !== undefined) verifier(c.score_risque === cas.score, `score attendu ${cas.score}`);
  // Le VERROU de F-01 : plus jamais « sain » sans le moindre exercice lu.
  if (c.exercice_reference === null) {
    verifier(c.classe !== "sain", "aucun exercice lu ⇒ jamais « sain »");
  }
  // Le VERROU des cessées : la composante « cessé » et la classe ne peuvent
  // plus se contredire dans la même réponse.
  if ((c.composantes ?? []).some((x) => x.indicateur === "etat_administratif")) {
    verifier(c.classe === "cessee", "composante « cessé » ⇒ classe « cessee »");
    verifier(c.risque_12m === "sans objet", "risque_12m « sans objet »");
  }
  verifier(
    cas.noteClasse ? typeof c.note_classe === "string" : c.note_classe === undefined,
    cas.noteClasse ? "note_classe servie (dit POURQUOI c'est indéterminé)" : "pas de note_classe",
  );
  // F-01 bis : la phrase « comptes non déposés » ne se sert QUE si c'est vrai.
  verifier(
    (c.exercice_reference === null) === (typeof c.note_donnees === "string"),
    "note_donnees servie si et seulement si aucun exercice lu",
  );
}

console.log(`\nRéponses conservées dans ${dossier}`);
if (echecs.length > 0) {
  console.error(`\n${echecs.length} contrôle(s) en échec :`);
  for (const e of echecs) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("\nTous les contrôles sont verts.");
