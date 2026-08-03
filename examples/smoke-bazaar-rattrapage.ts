/**
 * Rafraîchir les fiches du Bazaar CDP qui portent encore un ANCIEN texte.
 *
 * POURQUOI CE SCRIPT EXISTE. Une fiche du catalogue Bazaar ne se met à jour
 * qu'au PROCHAIN PAIEMENT de sa route (`lastUpdated == lastCalledAt`). Après une
 * refonte des descriptions, les routes non couvertes par le smoke général
 * continuent donc d'exposer l'ancien texte aux agents — parfois des semaines.
 * Ce script paie UNE FOIS chacune des routes en retard, au tarif le plus bas
 * possible, et rien d'autre.
 *
 *   TEST_WALLET_KEY=0x... npx tsx examples/smoke-bazaar-rattrapage.ts
 *   DRY_RUN=1 npx tsx examples/smoke-bazaar-rattrapage.ts   # liste sans payer
 *   ONLY=/DK/ TEST_WALLET_KEY=0x... npx tsx …                # ne (re)payer qu'un sous-ensemble
 *
 * ONLY est indispensable en pratique : une reprise après échec ne doit PAS
 * repayer les routes déjà réglées (chaque appel est de l'argent réel).
 *
 * Pour savoir QUI est en retard, comparer `lastUpdated` des fiches à la date du
 * déploiement :
 *   curl -s "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?limit=1000&offset=N"
 *   (clé JSON `items` ici ; `resources` sur /discovery/search — les deux existent)
 *
 * Les routes qui rendent un DÉTAIL de comptes ont besoin d'une référence réelle :
 * elles sont chaînées derrière leur route de liste, dont la réponse est payée de
 * toute façon. Une référence introuvable n'est pas facturée (le middleware annule
 * le paiement quand le handler répond en erreur).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const apiUrl = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const dryRun = process.env.DRY_RUN === "1";
/** Sous-ensemble à traiter : sous-chaîne présente dans le chemin. */
const only = process.env.ONLY ?? "";
const retenu = (path: string): boolean => path.includes(only);
const key = process.env.TEST_WALLET_KEY;
if (!dryRun && !key?.startsWith("0x")) {
  console.error("Set TEST_WALLET_KEY=0x<private key of a DEDICATED test wallet> (or DRY_RUN=1)");
  process.exit(2);
}

/** Routes simples : un appel, une fiche rafraîchie. Identifiants RÉELS et stables. */
const SIMPLES: Array<{ path: string; price: string }> = [
  // — fiches périmées (payées le 01/08, avant la refonte SEO du 02/08) —
  { path: "/v1/eu/entreprise/DK/10054834", price: "$0.01" }, // motif générique {pays}/{id}
  { path: "/v1/eu/entreprise/BE/0403199702", price: "$0.01" },
  { path: "/v1/eu/entreprise/SE/5560012402", price: "$0.01" },
  { path: "/v1/eu/entreprise/ES/VI-23141/actes", price: "$0.02" },
  { path: "/v1/eu/entreprise/GB/00102498/dirigeants", price: "$0.01" },
  { path: "/v1/eu/entreprise/GB/00102498/beneficiaires-effectifs", price: "$0.02" },
  { path: "/v1/eu/entreprise/GB/00102498/insolvabilite", price: "$0.02" },
  { path: "/v1/eu/entreprise/LV/40003245752/insolvabilite", price: "$0.02" },
  { path: "/v1/eu/entreprise/LV/40003245752/dirigeants", price: "$0.01" },
  { path: "/v1/eu/entreprise/LV/40003245752/beneficiaires-effectifs", price: "$0.02" },
  { path: "/v1/eu/entreprise/EE/12417834/evenements", price: "$0.02" },
  { path: "/v1/eu/entreprise/SE/5560012402/evenements", price: "$0.02" },
  { path: "/v1/eu/entreprise/PL/0000006865/evenements", price: "$0.02" },
  { path: "/v1/eu/entreprise/NO/923609016/comptes", price: "$0.02" },
  { path: "/v1/eu/entreprise/NO/923609016/evenements", price: "$0.02" },
  { path: "/v1/eu/entreprise/DK/10054834/dirigeants", price: "$0.01" },
  // — routes JAMAIS indexées au catalogue —
  { path: "/v1/eu/entreprise/LV/40003032065/comptes", price: "$0.03" },
  { path: "/v1/eu/entreprise/EE/10003666/comptes", price: "$0.02" },
  { path: "/v1/eu/entreprise/SE/5560401977/comptes", price: "$0.03" },
];

/** Paires liste → détail : la référence du détail vient de la liste payée juste avant. */
const CHAINES: Array<{ liste: string; prixListe: string; prixDetail: string; detail: (ref: string) => string }> = [
  {
    liste: "/v1/eu/entreprise/GB/00095407/comptes",
    prixListe: "$0.01",
    prixDetail: "$0.05",
    detail: (ref) => `/v1/eu/entreprise/GB/00095407/comptes/${ref}`,
  },
  {
    liste: "/v1/eu/entreprise/DK/10054834/comptes",
    prixListe: "$0.01",
    prixDetail: "$0.05",
    detail: (ref) => `/v1/eu/entreprise/DK/10054834/comptes/${ref}`,
  },
];

/** Téléchargement d'un document : l'identifiant vient de la liste des documents. */
const DOCUMENTS = { liste: "/v1/entreprise/552032534/documents", prixListe: "$0.02", prixDetail: "$0.10" };

if (dryRun) {
  // Le dry-run doit refléter EXACTEMENT ce que l'exécution ferait, filtre ONLY
  // compris : un aperçu plus large que la réalité ferait dépenser à l'aveugle.
  let total = 0;
  let appels = 0;
  for (const c of SIMPLES) {
    if (!retenu(c.path)) continue;
    total += Number(c.price.slice(1)); appels += 1;
    console.log(`${c.price}\t${c.path}`);
  }
  for (const c of CHAINES) {
    if (!retenu(c.liste)) continue;
    total += Number(c.prixListe.slice(1)) + Number(c.prixDetail.slice(1)); appels += 2;
    console.log(`${c.prixListe}+${c.prixDetail}\t${c.liste} (+ détail)`);
  }
  if (retenu(DOCUMENTS.liste)) {
    total += Number(DOCUMENTS.prixListe.slice(1)) + Number(DOCUMENTS.prixDetail.slice(1)); appels += 2;
    console.log(`${DOCUMENTS.prixListe}+${DOCUMENTS.prixDetail}\t${DOCUMENTS.liste} (+ téléchargement)`);
  }
  console.log(`\nTotal si exécuté : ~$${total.toFixed(3)} sur ${appels} appels${only ? ` (filtre ONLY=${only})` : ""}`);
  process.exit(0);
}

const account = privateKeyToAccount(key as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const paidFetch = wrapFetchWithPayment(fetch, client);

const dossier = join("resultats", `rattrapage-bazaar-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(dossier, { recursive: true });
let ordre = 0;
let paye = 0;
let echecs = 0;

/** Première date ISO trouvée dans le premier tableau du corps — la référence de
 *  dépôt la plus récente, sans dépendre du nom de champ de chaque pays. */
function premiereReference(corps: unknown): string | null {
  const tableaux = Object.values(corps as Record<string, unknown>).filter(Array.isArray) as unknown[][];
  for (const t of tableaux) {
    for (const element of t) {
      if (typeof element !== "object" || element === null) continue;
      for (const valeur of Object.values(element as Record<string, unknown>)) {
        if (typeof valeur === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valeur)) return valeur;
      }
    }
  }
  return null;
}

async function appeler(path: string, price: string): Promise<Record<string, unknown> | null> {
  const debut = Date.now();
  try {
    const r = await paidFetch(`${apiUrl}${path}`, { signal: AbortSignal.timeout(210_000) });
    const ms = Date.now() - debut;
    if (r.status !== 200) {
      echecs++;
      console.log(`✗ ${path} → HTTP ${r.status} (${ms} ms) — non facturé`);
      return null;
    }
    ordre += 1;
    const nom = `${String(ordre).padStart(2, "0")}-${path.replace(/^\/v1\//, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 80)}`;
    paye += Number(price.slice(1));
    if ((r.headers.get("content-type") ?? "").includes("pdf")) {
      const octets = Buffer.from(await r.arrayBuffer());
      writeFileSync(join(dossier, `${nom}.pdf`), octets);
      console.log(`✓ ${path} → PDF ${(octets.byteLength / 1024).toFixed(0)} KB, ${price} (${ms} ms)`);
      return null;
    }
    const corps = (await r.json()) as Record<string, unknown>;
    writeFileSync(join(dossier, `${nom}.json`), JSON.stringify(corps, null, 1));
    console.log(`✓ ${path} → ${price} (${ms} ms)`);
    return corps;
  } catch (erreur) {
    echecs++;
    console.log(`✗ ${path} → ${String(erreur).slice(0, 120)}`);
    return null;
  }
}

console.log(`Wallet: ${account.address}\nAPI: ${apiUrl}\n`);

for (const c of SIMPLES) if (retenu(c.path)) await appeler(c.path, c.price);

for (const c of CHAINES) {
  if (!retenu(c.liste)) continue;
  const liste = await appeler(c.liste, c.prixListe);
  if (!liste) continue;
  const ref = premiereReference(liste);
  if (!ref) {
    console.log(`– ${c.liste} : aucune référence exploitable, détail sauté`);
    continue;
  }
  await appeler(c.detail(ref), c.prixDetail);
}

const docs = retenu(DOCUMENTS.liste) ? await appeler(DOCUMENTS.liste, DOCUMENTS.prixListe) : null;
const actes = (docs?.actes ?? []) as Array<{ id?: string }>;
if (actes[0]?.id) await appeler(`/v1/documents/actes/${actes[0].id}`, DOCUMENTS.prixDetail);
else console.log("– aucun acte listé, téléchargement sauté");

console.log(`\nTotal payé : ~$${paye.toFixed(3)} — échecs (non facturés) : ${echecs}`);
console.log(`Réponses conservées sous ${dossier}/`);
console.log("Les fiches Bazaar se rafraîchissent 20-60 min après le règlement.");
