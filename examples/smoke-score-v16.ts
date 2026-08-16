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
 * ⚠️ POURQUOI CES ATTENDUS NE PEUVENT PAS ÊTRE UN FAUX ROUGE. La surcharge
 * BODACC prime sur tout : si l'un des deux nouveaux cas portait une procédure
 * collective active, la production répondrait `procedure_en_cours` ou
 * `defaut_avere` et ce script crierait à tort. Vérifié en direct sur l'amont
 * DILA le 11/08/2026 : les CINQ SIREN portent **zéro procédure collective**.
 * ZAKADO n'a aucune annonce du tout (0 sur 0) ; SCEB DUFOUR en a 21 — radiation
 * du 02/04/2026, dépôts de comptes, modifications — mais aucune procédure :
 * c'est bien une société CESSÉE et non une société DÉFAILLANTE, donc exactement
 * le cas que la v1.6 cible.
 *
 * Les réponses complètes sont conservées (règle CDU) puis commitées sur le
 * dépôt privé de traces.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-score-v16.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, erc20Abi } from "viem";
import { base } from "viem/chains";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const api = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const cle = process.env.TEST_WALLET_KEY;
if (!cle?.startsWith("0x")) {
  console.error("TEST_WALLET_KEY manquante (--env-file=.env.wallet-test)");
  process.exit(1);
}
const compte = privateKeyToAccount(cle as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: compte });
const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;

/** Solde USDC on-chain : la dépense RÉELLE se prouve là, pas dans le récit. */
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const rpc = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const solde = async (): Promise<bigint | null> => {
  try {
    return await rpc.readContract({
      address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [compte.address],
    });
  } catch {
    return null;
  }
};

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-score-v16-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const soldeAvant = await solde();
console.log(`wallet de test ${compte.address}`);
console.log(`solde USDC avant : ${soldeAvant === null ? "illisible" : `${Number(soldeAvant) / 1e6} $`}`);

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

// Filtre optionnel : `… smoke-score-v16.ts 100000025` n'achète QUE ce SIREN.
// Sert à re-prouver un correctif de TEXTE pour 0,10 $ au lieu de 0,50 $ — un
// achat reste nécessaire (la prose ne vit que dans le corps payant), mais rien
// n'oblige à racheter les cinq.
const filtre = process.argv[2];
const aAcheter = filtre ? CAS.filter((c) => c.siren === filtre) : CAS;
if (aAcheter.length === 0) {
  console.error(`SIREN ${String(filtre)} absent du lot de témoins`);
  process.exit(1);
}
console.log(`${aAcheter.length} achat(s) prévu(s) — ${(aAcheter.length * 0.1).toFixed(2)} $`);

for (const cas of aAcheter) {
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
  // La note ne doit nommer que des signaux ATTEIGNABLES : depuis que la
  // surcharge « cessee » prime, une cessée n'atteint jamais « indetermine »,
  // donc l'état administratif ne peut plus y peser.
  if (c.classe === "indetermine") {
    verifier(
      !/état administratif|administrative status/.test(String(c.note_classe)),
      "la note d'indéterminé ne nomme plus l'état administratif",
    );
    verifier(/au plus l'ancienneté/.test(String(c.note_classe)), "elle nomme « au plus l'ancienneté »");
  }
  // F-01 bis : la phrase « comptes non déposés » ne se sert QUE si c'est vrai.
  verifier(
    (c.exercice_reference === null) === (typeof c.note_donnees === "string"),
    "note_donnees servie si et seulement si aucun exercice lu",
  );
}

// Les règlements se minent en ~2 blocs Base : lire le solde trop tôt sous-estime
// la dépense et ferait conclure à tort « rien n'a été débité ».
console.log("\nattente de 35 s (minage des règlements sur Base)…");
await new Promise((r) => setTimeout(r, 35_000));
const soldeApres = await solde();
const depense =
  soldeAvant !== null && soldeApres !== null ? Number(soldeAvant - soldeApres) / 1e6 : null;
console.log(`solde USDC après : ${soldeApres === null ? "illisible" : `${Number(soldeApres) / 1e6} $`}`);
console.log(`dépense réelle   : ${depense === null ? "non mesurable" : `${depense.toFixed(6)} $`}`);

const recap = {
  campagne: "smoke-score-v16",
  but: "prouver par ACHAT que le barème v1.6 ne sert plus « sain » sur une absence de comptes ni sur une entreprise cessée",
  api,
  horodatage,
  wallet_test: compte.address,
  appels: aAcheter.length,
  cout_annonce_usd: aAcheter.length * 0.1,
  solde_avant_usdc: soldeAvant === null ? null : Number(soldeAvant) / 1e6,
  solde_apres_usdc: soldeApres === null ? null : Number(soldeApres) / 1e6,
  depense_reelle_usd: depense,
  controles_en_echec: echecs,
  verdict: echecs.length === 0 ? "vert" : "rouge",
};
writeFileSync(`${dossier}/recap.json`, JSON.stringify(recap, null, 2));
writeFileSync(
  `${dossier}/RECAP.md`,
  [
    `# Smoke payant — score \`defaillance-v1.6\` (${horodatage})`,
    "",
    `**But** : ${recap.but}.`,
    "",
    `- API : ${api}`,
    `- Appels payés : ${aAcheter.length} × \\$0.10 = \\$${recap.cout_annonce_usd.toFixed(2)} annoncés`,
    `- Dépense RÉELLE mesurée on-chain : ${depense === null ? "non mesurable" : `\\$${depense.toFixed(6)}`}`,
    `- Verdict : **${recap.verdict}**${echecs.length ? ` (${echecs.length} contrôle(s) en échec)` : ""}`,
    "",
    "| SIREN | société | attendu |",
    "|---|---|---|",
    ...aAcheter.map((c) => `| ${c.siren} | ${c.nom} | ${c.classe}${c.score !== undefined ? ` / ${c.score}` : ""} |`),
    "",
    ...(echecs.length ? ["## Contrôles en échec", "", ...echecs.map((e) => `- ${e}`)] : []),
  ].join("\n"),
);

console.log(`\nRéponses conservées dans ${dossier}`);
if (echecs.length > 0) {
  console.error(`\n${echecs.length} contrôle(s) en échec :`);
  for (const e of echecs) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("\nTous les contrôles sont verts.");
