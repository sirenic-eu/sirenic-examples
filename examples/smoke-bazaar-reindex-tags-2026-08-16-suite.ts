/**
 * Suite de la campagne ciblée du 16/08 — les 3 fiches que le premier passage
 * n'a PAS ré-indexées, faute d'appels corrects de ma part (aucune n'était un
 * défaut produit, et aucune n'a été facturée : 400/404 annulent le paiement) :
 *
 *  - `/dossier` exige un paramètre `blocs` — on prend le MOINS cher
 *    (`etablissements`, 0,003 $), la fiche se rafraîchit quel que soit le bloc ;
 *  - GB `/comptes/{date_cloture}` exige une date réelle — lue EN BASE, gratuit,
 *    plutôt qu'en payant la route « liste » ;
 *  - BE `/comptes/{reference}` : la liste avait bien répondu (175 dépôts), mon
 *    parsing cherchait `exercices` là où le corps sert `depots`.
 *
 *   cd /home/ubuntu/sirenic-examples
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-bazaar-reindex-tags-2026-08-16-suite.ts
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
if (!cle?.startsWith("0x")) { console.error("TEST_WALLET_KEY manquante"); process.exit(1); }
const compte = privateKeyToAccount(cle as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: compte });
const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const rpc = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const solde = async () => {
  try { return await rpc.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [compte.address] }); }
  catch { return null; }
};

const CIBLES = [
  { route: "/v1/entreprise/{siren}/dossier", url: "/v1/entreprise/552032534/dossier?blocs=etablissements" },
  { route: "/v1/eu/entreprise/GB/{company_number}/comptes/{date_cloture}", url: "/v1/eu/entreprise/GB/00088679/comptes/2026-03-31" },
  { route: "/v1/eu/entreprise/{pays}/{id}/comptes/{reference}", url: "/v1/eu/entreprise/BE/0403199702/comptes/2026-00112694" },
];

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `resultats/${horodatage}-bazaar-reindex-tags-suite`;
mkdirSync(dossier, { recursive: true });

const avant = await solde();
console.log(`solde USDC avant : ${avant === null ? "?" : (Number(avant) / 1e6).toFixed(6)} $\n`);

const resultats: Array<Record<string, unknown>> = [];
for (const [i, c] of CIBLES.entries()) {
  const t0 = Date.now();
  try {
    const r = await payer(`${api}${c.url}`, { headers: { Accept: "application/json" } });
    const texte = await r.text();
    writeFileSync(`${dossier}/${String(i + 1).padStart(2, "0")}-${c.route.replace(/[^a-z0-9]+/gi, "-")}.json`, texte);
    const paye = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
    console.log(`${r.ok ? "✔" : "✗"} ${r.status} ${c.url}  (${Date.now() - t0} ms)${paye ? " · réglé" : " · NON réglé"}`);
    if (!r.ok) console.log(`    ${texte.slice(0, 200)}`);
    resultats.push({ route: c.route, url: c.url, http: r.status, regle: Boolean(paye) });
  } catch (e) {
    console.log(`✗ ${c.url} — ${String(e).slice(0, 150)}`);
    resultats.push({ route: c.route, url: c.url, erreur: String(e).slice(0, 300) });
  }
}

const apres = await solde();
const depense = avant !== null && apres !== null ? Number(avant - apres) / 1e6 : null;
console.log(`\nsolde USDC après : ${apres === null ? "?" : (Number(apres) / 1e6).toFixed(6)} $`);
console.log(`dépense RÉELLE on-chain : ${depense === null ? "?" : depense.toFixed(6)} $`);
writeFileSync(`${dossier}/bilan.json`, JSON.stringify({ horodatage, depense_usdc: depense, resultats }, null, 1));
console.log(`\nréponses conservées : ${dossier}`);
