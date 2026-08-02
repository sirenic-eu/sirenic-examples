/**
 * Smoke PAYANT ciblé sur GET /v1/comparer (~0,24 $ pour 2 SIREN).
 *
 * Pourquoi un smoke dédié plutôt que le smoke complet : celui-ci coûte plus de
 * 3 $ et rejoue 44 routes. Ici on ne veut prouver que trois choses, et elles ne
 * se prouvent QUE par un achat réel (leçon du 24/07 : un devis qui s'affiche
 * n'est pas une route achetable, et du 01/08 : la vérification gratuite ne voit
 * pas un champ manquant dans un corps payant) :
 *   1. la route est réellement ACHETABLE (le facilitateur accepte le payload) ;
 *   2. le corps servi est celui qu'on annonce, signature Ed25519 comprise ;
 *   3. le paiement fait NAÎTRE la fiche Bazaar (une fiche naît au 1er règlement).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-comparer.ts
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
const compte = privateKeyToAccount(cle as `0x${string}`);
console.log(`Payeur : ${compte.address}`);

const client = new x402Client();
registerExactEvmScheme(client, { signer: compte });
const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;

const chemin = "/v1/comparer?sirens=552032534,542065479";
console.log(`\nAchat réel : ${chemin}`);
const debut = Date.now();
const r = await payer(`${api}${chemin}`);
const ms = Date.now() - debut;
console.log(`→ HTTP ${r.status} en ${ms} ms`);
const recu = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
console.log(`Reçu de règlement : ${recu ? "présent" : "ABSENT"}`);
console.log(`Signature Ed25519 : ${r.headers.get("x-sirenic-signature") ? "présente" : "absente"}`);

const corps = (await r.json()) as Record<string, unknown>;
if (r.status !== 200) {
  console.error("ÉCHEC :", JSON.stringify(corps).slice(0, 400));
  process.exit(1);
}

// Ce que le corps doit porter — les mêmes invariants que les tests, mais sur la
// PROD et sur des données réelles.
const controles: Array<[string, boolean]> = [
  ["nombre_trouve = 2", corps.nombre_trouve === 2],
  ["aucun classement général", corps.classement_general === undefined && corps.gagnant === undefined],
  ["classements par axe", typeof corps.classements === "object" && corps.classements !== null],
  ["bloc comparabilite", typeof corps.comparabilite === "object" && corps.comparabilite !== null],
  ["bloc provenance", Array.isArray(corps.provenance) && corps.provenance.length > 0],
  ["aucun dirigeant servi", !JSON.stringify(corps).includes("dirigeants")],
];
for (const [libelle, ok] of controles) console.log(`  ${ok ? "✓" : "✗"} ${libelle}`);

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `resultats/${horodatage}`;
mkdirSync(dossier, { recursive: true });
writeFileSync(`${dossier}/comparer.json`, `${JSON.stringify(corps, null, 2)}\n`);
console.log(`\nRéponse payée conservée : ${dossier}/comparer.json`);
if (controles.some(([, ok]) => !ok)) process.exit(1);
