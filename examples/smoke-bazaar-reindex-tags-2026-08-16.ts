/**
 * Campagne de ré-indexation Bazaar CIBLÉE — 2026-08-16.
 *
 * ─────────────────────────────── pourquoi ciblée ─────────────────────────────
 * Le correctif des tags (d17cf20) aligne la grille sur ce que le catalogue garde
 * vraiment : `sanitizeTags` de @x402/extensions ne retient que les CINQ premiers
 * tags et jette le reste sans un mot. Nous en déclarions 670, 370 arrivaient.
 *
 * MAIS : les 300 perdus ne partaient déjà pas. Comparer, route par route, les
 * tags PORTÉS par le catalogue à ceux que nous ÉMETTONS maintenant donne 7
 * fiches réellement divergentes sur 74 — pas 75. Une campagne complète
 * coûterait 3,87 $ pour ne changer que 7 fiches. Celle-ci coûte ~0,28 $.
 *
 * Quatre de ces sept portent encore des tags d'AVANT la purge du 14/08
 * (`addresses`, `companies`, `filings`, `company-data`) : cette purge, décidée
 * sur mesures, n'avait jamais atteint le catalogue faute d'achat depuis.
 * Une cinquième publie enfin `vop` (arbitrage D2 du 01/08, resté lettre morte
 * parce que le tag était au 6e rang — mesuré absent 11 fois sur 11).
 *
 * Une fiche ne se rafraîchit qu'au RÈGLEMENT d'un paiement sur son URL
 * (mécanisme prouvé le 01/08 : fiche rafraîchie 1 s après le settle).
 *
 * Un 503 amont N'EST PAS facturé (le paiement est annulé) : la fiche concernée
 * ne bougera pas, et on le dit.
 *
 *   cd /home/ubuntu/sirenic-examples
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-bazaar-reindex-tags-2026-08-16.ts
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
  } catch { return null; }
};

/** Les 7 fiches divergentes, avec une cible RÉELLE et servable aujourd'hui.
 *  Les pays au stock encore partiel (FI, SK, DK, CZ, SE comptes, ES) rendraient
 *  503 : on choisit donc BE pour la route EU générique, et GB qui est chargé. */
const CIBLES = [
  { route: "/v1/entreprise/{siren}/etablissements", url: "/v1/entreprise/552032534/etablissements" },
  { route: "/v1/entreprise/{siren}/documents", url: "/v1/entreprise/552032534/documents" },
  { route: "/v1/entreprise/{siren}/dossier", url: "/v1/entreprise/552032534/dossier" },
  { route: "/v1/iban/verifier/{iban}", url: "/v1/iban/verifier/FR1420041010050500013M02606" },
  { route: "/v1/eu/entreprise/GB/{company_number}/comptes/{date_cloture}", url: "/v1/eu/entreprise/GB/00445790/comptes/2024-12-31" },
  { route: "/v1/eu/entreprise/{pays}/{id}/comptes/{reference}", url: null }, // rempli au vol, voir ci-dessous
];

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `resultats/${horodatage}-bazaar-reindex-tags`;
mkdirSync(dossier, { recursive: true });

const avant = await solde();
console.log(`wallet ${compte.address}`);
console.log(`solde USDC avant : ${avant === null ? "?" : (Number(avant) / 1e6).toFixed(6)} $\n`);

/** La route « un exercice » exige une RÉFÉRENCE existante : on lit d'abord la
 *  liste (payante elle aussi, mais déjà conforme au catalogue — donc on prend
 *  la première référence servie sans la re-payer inutilement ailleurs). */
const listeBe = await payer(`${api}/v1/eu/entreprise/BE/0403199702/comptes`, { headers: { Accept: "application/json" } });
if (listeBe.ok) {
  const corps = (await listeBe.clone().json()) as { exercices?: Array<{ reference?: string }> };
  const ref = corps.exercices?.[0]?.reference;
  if (ref) CIBLES[5]!.url = `/v1/eu/entreprise/BE/0403199702/comptes/${encodeURIComponent(ref)}`;
  writeFileSync(`${dossier}/00-liste-be.json`, JSON.stringify(corps, null, 1));
}
console.log(`référence BE retenue : ${CIBLES[5]!.url ?? "AUCUNE — route non ré-indexable aujourd'hui"}\n`);

const resultats: Array<Record<string, unknown>> = [];
for (const [i, cible] of CIBLES.entries()) {
  if (!cible.url) {
    console.log(`✗ ${cible.route} — pas de cible servable, ignorée`);
    resultats.push({ route: cible.route, statut: "ignoree", motif: "aucune cible servable" });
    continue;
  }
  const t0 = Date.now();
  try {
    const r = await payer(`${api}${cible.url}`, { headers: { Accept: "application/json" } });
    const texte = await r.text();
    writeFileSync(`${dossier}/${String(i + 1).padStart(2, "0")}-${cible.route.replace(/[^a-z0-9]+/gi, "-")}.json`, texte);
    const paye = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
    console.log(`${r.ok ? "✔" : "✗"} ${r.status} ${cible.url}  (${Date.now() - t0} ms)${paye ? " · réglé" : " · NON réglé"}`);
    resultats.push({ route: cible.route, url: cible.url, http: r.status, regle: Boolean(paye) });
  } catch (e) {
    console.log(`✗ ${cible.url} — ${String(e).slice(0, 120)}`);
    resultats.push({ route: cible.route, url: cible.url, erreur: String(e).slice(0, 300) });
  }
}

const apres = await solde();
const depense = avant !== null && apres !== null ? Number(avant - apres) / 1e6 : null;
console.log(`\nsolde USDC après : ${apres === null ? "?" : (Number(apres) / 1e6).toFixed(6)} $`);
console.log(`dépense RÉELLE on-chain : ${depense === null ? "?" : depense.toFixed(6)} $`);
writeFileSync(`${dossier}/bilan.json`, JSON.stringify({ horodatage, wallet: compte.address, depense_usdc: depense, resultats }, null, 1));
console.log(`\nréponses conservées : ${dossier}`);
