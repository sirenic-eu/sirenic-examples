/**
 * Achats de RECAPTURE des contrats d'exemple (ticket #115 de kopko13/sirenic, 25/09/2026).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/recapture-contrats-2026-09-25.ts
 *
 * COÛT ANNONCÉ : 1,973 $ en SEPT achats, listés au ticket avant l'achat (règle #166) :
 *   1. GET /v1/intelligence/552032534 (1,00 $)          recapture sur la version servie
 *   2. GET /v1/entreprise/552032534/sante (0,15 $)       recapture de /sante
 *   3. GET /v1/comparer?sirens=552032534,542065479 (0,24 $)  contrat et comparer.json de la vitrine
 *   4. GET /v1/facture/verifier?siren=…&tva=…&iban=… (0,02 $) l'exemple « au premier achat réel »
 *   5. GET /v1/kyb/batch?sirens=552032534,542065479 (0,21 $) recapture du lot
 *   6. GET /v1/entreprise/552032534/capital (0,35 $)     exemple photographié en capital-v2, servi en v5
 *      (ajouté au ticket avant l'achat ; RECAPTURE_SEULEMENT=6 ne rejoue que lui)
 *   7. GET /v1/eu/recherche?q=equinor&pays=NO (0,003 $) nombre_resultats compté avant la coupe depuis #186
 * Les URL sont celles des contrats publiés (mêmes paramètres que l'exemple) : le corps acheté est
 * celui de la société que l'exemple montre.
 *
 * Mode HORS LIGNE (aucun appel, aucun achat) pour valider le harnais AVANT d'acheter :
 *   RECAPTURE_CORPS=<dossier avec 1-intelligence.json … 5-kyb-batch.json> RECAPTURE_SORTIE=<dossier> \
 *     node --import tsx examples/recapture-contrats-2026-09-25.ts
 *
 * Rien de nominatif n'est imprimé : codes, nombres et états. Les corps vont au dépôt privé de traces.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

type Obj = Record<string, any>;

const api = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const horsLigne = Boolean(process.env.RECAPTURE_CORPS);
const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = process.env.RECAPTURE_SORTIE ?? `/home/ubuntu/sirenic-examples/resultats/recapture-contrats-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const DANONE = "552032534";
const VERSION_RAPPORT = "1.12";
const VERSION_PROMPT_SANTE = "sante-v2";
const VERSION_PROMPT_CAPITAL = "capital-v5";

interface Achat {
  cas: string;
  fichier: string;
  chemin: string;
  devis: number; // unités atomiques USDC (6 décimales)
  controler: (c: Obj, verifier: (ok: boolean, quoi: string) => void) => void;
}

const ACHATS: Achat[] = [
  {
    cas: "intelligence DANONE sur la version servie",
    fichier: "1-intelligence.json",
    chemin: `/v1/intelligence/${DANONE}`,
    devis: 1_000_000,
    controler: (c, v) => {
      v(c.siren === DANONE, `intelligence : siren ${DANONE}`);
      v(c.version_rapport === VERSION_RAPPORT, `intelligence : version_rapport ${VERSION_RAPPORT} (lu ${c.version_rapport})`);
      v(c.identite?.denomination === "DANONE", "intelligence : identite.denomination DANONE");
      v(typeof c.synthese?.verdict_global === "string", `intelligence : synthese.verdict_global servi (${c.synthese?.verdict_global})`);
      v(Array.isArray(c.provenance) && c.provenance.length > 0, `intelligence : provenance[] servie (${(c.provenance ?? []).length})`);
    },
  },
  {
    cas: "sante DANONE",
    fichier: "2-sante.json",
    chemin: `/v1/entreprise/${DANONE}/sante`,
    devis: 150_000,
    controler: (c, v) => {
      v(c.siren === DANONE, `sante : siren ${DANONE}`);
      v(c.version_prompt === VERSION_PROMPT_SANTE, `sante : version_prompt ${VERSION_PROMPT_SANTE} (lu ${c.version_prompt})`);
      v(c.modele === "claude-sonnet-5", `sante : modele claude-sonnet-5 (lu ${c.modele})`);
      v(typeof c.grille?.verdict === "string", `sante : grille.verdict servi (${c.grille?.verdict})`);
      v(Array.isArray(c.provenance) && c.provenance.length > 0, `sante : provenance[] servie (${(c.provenance ?? []).length})`);
    },
  },
  {
    cas: "comparer DANONE et 542065479",
    fichier: "3-comparer.json",
    chemin: `/v1/comparer?sirens=${DANONE}%2C542065479`,
    devis: 240_000,
    controler: (c, v) => {
      v(c.nombre_demande === 2 && c.nombre_trouve === 2, `comparer : 2 demandées, 2 trouvées (lu ${c.nombre_demande}, ${c.nombre_trouve})`);
      v(Array.isArray(c.entreprises) && c.entreprises.some((e: Obj) => e.siren === DANONE), "comparer : DANONE dans le lot");
      v(Array.isArray(c.provenance) && c.provenance.length > 0, `comparer : provenance[] servie (${(c.provenance ?? []).length})`);
    },
  },
  {
    cas: "facture/verifier DANONE, TVA et IBAN d'exemple",
    fichier: "4-facture-verifier.json",
    chemin: `/v1/facture/verifier?siren=${DANONE}&tva=FR27552032534&iban=FR1420041010050500013M02606`,
    devis: 20_000,
    controler: (c, v) => {
      v(c.siren === DANONE, `facture : siren ${DANONE}`);
      v(["coherent", "incoherent", "inverifiable"].includes(c.verdict), `facture : verdict en liste fermée (lu ${c.verdict})`);
      v(Array.isArray(c.non_verifie), "facture : non_verifie servi");
      v(Array.isArray(c.provenance) && c.provenance.length > 0, `facture : provenance[] servie (${(c.provenance ?? []).length})`);
    },
  },
  {
    cas: "kyb/batch DANONE et 542065479",
    fichier: "5-kyb-batch.json",
    chemin: `/v1/kyb/batch?sirens=${DANONE}%2C542065479`,
    devis: 210_000,
    controler: (c, v) => {
      v(c.nombre_demande === 2 && c.nombre_trouve === 2, `kyb/batch : 2 demandées, 2 trouvées (lu ${c.nombre_demande}, ${c.nombre_trouve})`);
      const d = (c.entreprises ?? []).find((e: Obj) => e.siren === DANONE) ?? {};
      v(typeof d.criblage_sanctions?.statut === "string", `kyb/batch : statut de criblage de DANONE servi (${d.criblage_sanctions?.statut})`);
      v(typeof d.contentieux === "object" && d.contentieux !== null, "kyb/batch : bloc contentieux de DANONE servi");
    },
  },
  {
    cas: "capital DANONE sur la version de prompt servie",
    fichier: "6-capital.json",
    chemin: `/v1/entreprise/${DANONE}/capital`,
    devis: 350_000,
    controler: (c, v) => {
      v(c.siren === DANONE, `capital : siren ${DANONE}`);
      v(c.version_prompt === VERSION_PROMPT_CAPITAL, `capital : version_prompt ${VERSION_PROMPT_CAPITAL} (lu ${c.version_prompt})`);
      v(c.modele === "claude-sonnet-5", `capital : modele claude-sonnet-5 (lu ${c.modele})`);
      const associes: Obj[] = Array.isArray(c.capital?.associes) ? c.capital.associes : [];
      v(associes.every((a) => a.type !== "personne_physique" || !("nom" in a)), "capital : aucun associé personne physique nommé (Jautiva)");
      v(Array.isArray(c.provenance) && c.provenance.length > 0, `capital : provenance[] servie (${(c.provenance ?? []).length})`);
    },
  },
  {
    cas: "recherche EU equinor en Norvège (URL publiée)",
    fichier: "7-recherche-eu.json",
    chemin: "/v1/eu/recherche?q=equinor&pays=NO",
    devis: 3_000,
    controler: (c, v) => {
      v(typeof c.nombre_resultats === "number", `recherche EU : nombre_resultats servi (${c.nombre_resultats})`);
      v(typeof c.tronque === "boolean", `recherche EU : tronque servi (${c.tronque})`);
      v(Array.isArray(c.resultats) && c.resultats.length > 0 && c.resultats.every((r: Obj) => r.pays === "NO"), "recherche EU : résultats tous norvégiens (filtre pays)");
      v(Array.isArray(c.provenance) && c.provenance.length > 0, `recherche EU : provenance[] servie (${(c.provenance ?? []).length})`);
    },
  },
];

const seulement = (process.env.RECAPTURE_SEULEMENT ?? "").split(",").filter(Boolean);
const choisis = seulement.length ? ACHATS.filter((a) => seulement.some((n) => a.fichier.startsWith(`${n}-`))) : ACHATS;

const echecs: string[] = [];
const verifier = (ok: boolean, quoi: string): void => {
  console.log(`${ok ? "  ok  " : " ÉCHEC"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};

let payer: typeof fetch = fetch;
if (!horsLigne) {
  const cle = process.env.TEST_WALLET_KEY;
  if (!cle?.startsWith("0x")) {
    console.error("TEST_WALLET_KEY manquante (--env-file=.env.wallet-test)");
    process.exit(1);
  }
  const { privateKeyToAccount } = await import("viem/accounts");
  const { wrapFetchWithPayment } = await import("@x402/fetch");
  const { x402Client } = await import("@x402/core/client");
  const { registerExactEvmScheme } = await import("@x402/evm/exact/client");
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: privateKeyToAccount(cle as `0x${string}`) });
  payer = wrapFetchWithPayment(fetch, client) as typeof fetch;
}

async function devisAnnonce(url: string): Promise<number | null> {
  const r = await fetch(url);
  const entete = r.headers.get("payment-required");
  if (!entete) return null;
  const d = JSON.parse(Buffer.from(entete, "base64").toString()) as { accepts?: Array<{ amount?: string }> };
  return Number(d.accepts?.[0]?.amount ?? NaN);
}

let commit = "(hors ligne)";
if (!horsLigne) {
  commit = String(((await (await fetch(`${api}/healthz`)).json()) as Obj).commit);
  console.log(`prod sert ${commit}`);
}

const bilan: Obj[] = [];
for (const a of choisis) {
  console.log(`\n${a.cas} : ${a.chemin}`);
  let statut = 200;
  let regle = true;
  let devis: number | null = a.devis;
  let corps: Obj = {};
  if (horsLigne) {
    const brut = readFileSync(`${process.env.RECAPTURE_CORPS}/${a.fichier}`, "utf8");
    corps = JSON.parse(brut.slice(brut.indexOf("{"))) as Obj;
  } else {
    const url = `${api}${a.chemin}`;
    devis = await devisAnnonce(url);
    if (devis !== a.devis) {
      verifier(false, `${a.cas} : devis annoncé ${devis} au lieu de ${a.devis}, achat NON fait`);
      continue;
    }
    const r = await payer(url, { signal: AbortSignal.timeout(180_000) });
    const brut = await r.text();
    statut = r.status;
    const reglement = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
    regle = Boolean(reglement);
    writeFileSync(`${dossier}/${a.fichier}`, brut);
    writeFileSync(
      `${dossier}/${a.fichier.replace(/\.json$/, ".entetes.json")}`,
      JSON.stringify({ url: a.chemin, http: statut, devis, commit, reglement: reglement ?? null, date: r.headers.get("date") }, null, 1),
    );
    try {
      corps = JSON.parse(brut) as Obj;
    } catch {
      /* corps non JSON conservé sur disque */
    }
  }
  verifier(statut === 200, `${a.cas} : 200 (lu ${statut})`);
  verifier(devis === a.devis, `${a.cas} : devis ${a.devis} unités`);
  verifier(regle, `${a.cas} : règlement présent`);
  a.controler(corps, verifier);
  bilan.push({ cas: a.cas, chemin: a.chemin, http: statut, devis, regle, fichier: a.fichier });
}

writeFileSync(`${dossier}/bilan.json`, JSON.stringify({ commit, horodatage, achats: bilan, echecs }, null, 1));
console.log(`\n${echecs.length === 0 ? "✅ tout conforme" : `❌ ${echecs.length} échec(s)`} ; corps dans ${dossier}`);
process.exit(echecs.length === 0 ? 0 : 1);
