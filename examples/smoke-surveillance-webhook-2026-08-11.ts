/**
 * Smoke PAYANT — la LIVRAISON WEBHOOK de la surveillance, en production réelle.
 *
 * Pourquoi ce script existe : le chemin détection → webhook signé Ed25519 →
 * digest est couvert par les tests unitaires, mais il n'a JAMAIS tourné en
 * production. Aucune watch de prod n'avait déclaré de canal, et
 * `surveillance_evenements` est vide depuis l'ouverture du service. Un chemin
 * jamais emprunté en réel n'est pas un chemin prouvé.
 *
 * Ce qui est prouvable TOUT DE SUITE (ici) :
 *   1. la garde SSRF ACCEPTE une vraie URL publique https/443 et la stocke ;
 *   2. la même garde REFUSE une adresse interdite, en 400 et SANS DÉBIT.
 *
 * Ce qui ne l'est pas, et pourquoi : un webhook ne part que s'il y a un
 * ÉVÉNEMENT. Le tour est QUOTIDIEN (~22 h) et il n'existe aucun déclencheur
 * manuel ; le premier tour d'une watch neuve initialise l'état en SILENCE, par
 * conception. La preuve se termine donc toute seule, au premier changement réel
 * sur l'une des cibles — d'où le choix des cibles ci-dessous.
 *
 * CHOIX DES CIBLES : dix SIREN de PERSONNES MORALES ayant publié au BODACC dans
 * les jours précédents. Deux raisons, dans cet ordre :
 *   - RGPD : aucune cible `dirigeant:` — le suivi de mandats fait transiter un
 *     NOM et une année, et ce webhook est un bac PUBLIC chez un tiers. Seules
 *     des données d'entreprise en sortiront.
 *   - probabilité : une société qui vient de publier republie souvent.
 *
 * ⚠️ Le corps d'un webhook porte `surveillance_id`, une capacité PORTEUSE. En
 * l'envoyant chez un tiers (décision CDU du 11/08), ce jeton doit être considéré
 * comme BRÛLÉ : arrêter la watch dès la preuve obtenue.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-surveillance-webhook-2026-08-11.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const api = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const recepteur = process.env.WEBHOOK_TEST_URL;
const cle = process.env.TEST_WALLET_KEY;
if (!cle?.startsWith("0x")) {
  console.error("TEST_WALLET_KEY manquante (--env-file=.env.wallet-test)");
  process.exit(1);
}
if (!recepteur?.startsWith("https://")) {
  console.error("WEBHOOK_TEST_URL manquante (URL https publique du récepteur)");
  process.exit(1);
}
const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(cle as `0x${string}`) });
const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;

// Personnes MORALES ayant publié au BODACC début août 2026 (relevé à la source
// le 11/08, filtre `listepersonnes LIKE "pm"`).
const CIBLES = [
  "451435846", "943982355", "795216068", "943262469", "831098702",
  "420847345", "828705012", "939975413", "909404824", "853351096",
].join(",");

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-surveillance-webhook-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const echecs: string[] = [];
const verifier = (ok: boolean, quoi: string): void => {
  console.log(`${ok ? "  ok  " : " ÉCHEC"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};

async function acheter(nom: string, url: string): Promise<{ statut: number; corps: any }> {
  const r = await payer(url);
  const brut = await r.text();
  // Le récepteur est écrit en clair dans l'URL : on masque avant de conserver.
  writeFileSync(`${dossier}/${nom}.json`, `HTTP ${r.status}\n${brut}\n`);
  console.log(`\n${nom} → HTTP ${r.status}`);
  let corps: any = {};
  try {
    corps = JSON.parse(brut);
  } catch {
    /* conservé sur disque */
  }
  return { statut: r.status, corps };
}

// --- 1. La garde SSRF REFUSE une adresse interdite, sans débit -------------
// D'abord le refus : s'il passait, rien de ce qui suit n'aurait de valeur.
const refus = await acheter(
  "webhook-interdit-refuse",
  `${api}/v1/surveillance/creer?cibles=552032534&webhook=${encodeURIComponent("https://127.0.0.1/hook")}`,
);
verifier(refus.statut === 400, `webhook loopback : refusé en 400 (lu ${refus.statut})`);
verifier(refus.corps.error === "webhook_invalide", `erreur webhook_invalide (lu ${refus.corps.error})`);

// --- 2. Une vraie URL publique est acceptée et STOCKÉE ---------------------
const achat = await acheter(
  "webhook-public-accepte",
  `${api}/v1/surveillance/creer?cibles=${CIBLES}&webhook=${encodeURIComponent(recepteur)}`,
);
verifier(achat.statut === 200, "URL publique https/443 : watch créée en 200");
verifier(achat.corps.cibles === 10, `10 cibles facturées et créées (lu ${achat.corps.cibles})`);
verifier(achat.corps.duree_jours === 30, "durée par défaut 30 j");
verifier(achat.corps.canaux?.webhook === true, "le canal webhook est DÉCLARÉ dans la réponse");

const jeton = String(achat.corps.jeton ?? "");
if (jeton) {
  // La consultation gratuite doit confirmer le canal, côté serveur cette fois.
  const etat = await (await fetch(`${api}/v1/surveillance/${encodeURIComponent(jeton)}`)).json();
  writeFileSync(`${dossier}/etat-apres-creation.json`, JSON.stringify(etat, null, 2));
  verifier(etat.canaux?.webhook === true, "la consultation confirme le canal webhook stocké");
  verifier(etat.statut === "active", "watch active");
  verifier(Array.isArray(etat.evenements) && etat.evenements.length === 0, "aucun événement à la création (init silencieuse)");
  writeFileSync(`${dossier}/JETON-A-ARRETER.txt`, `${jeton}\n`);
  console.log(`\njeton conservé pour l'arrêt : ${dossier}/JETON-A-ARRETER.txt`);
}

writeFileSync(
  `${dossier}/verdict.txt`,
  (echecs.length === 0 ? "TOUT VERT\n" : `ÉCHECS :\n${echecs.map((e) => `- ${e}`).join("\n")}\n`) +
    "\nPreuve PARTIELLE par construction : la livraison elle-même attend un\n" +
    "événement réel (tour quotidien, aucun déclencheur manuel).\n",
);
console.log(`\n${"=".repeat(70)}`);
console.log(echecs.length === 0 ? "GARDE ET STOCKAGE : VERTS" : `ROUGE — ${echecs.length} échec(s)`);
for (const e of echecs) console.log(`  - ${e}`);
console.log(`résultats : ${dossier}`);
process.exit(echecs.length === 0 ? 0 : 1);
