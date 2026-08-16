/**
 * Complément de la campagne de ré-indexation du 16/08 (second passage) :
 * les deux achats ratés du script précédent.
 *  - /v1/documents/{type}/{id} : la liste rend `actes[]`/`bilans[]`, pas
 *    `documents[]` — l'id est repris de la liste DÉJÀ payée (188 actes).
 *    C'est LA fiche manquante du catalogue depuis le 24/07.
 *  - transactions-dirigeants : 0403199702 n'est pas un émetteur coté (404
 *    correctement NON facturé) → NYXOAH 0817149675, émetteur BE avec des
 *    notifications MAR 19 réelles (smoke du 15/08).
 *
 *   cd /home/ubuntu/sirenic-examples
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-bazaar-reindex-2026-08-16-complement.ts
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

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const rpc = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const solde = async (): Promise<bigint | null> => {
  try {
    return await rpc.readContract({
      address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [compte.address],
    });
  } catch { return null; }
};

// Passages : (1) 11:22 UTC — le document 6a33ae8b… acheté/réglé (fiche
// manquante créée) ; NYXOAH 0817149675 → 404 emetteur_inconnu NON facturé
// (absent du registre FSMA résolu). (2) l'émetteur est repris du STOCK
// (fsma_emetteurs) et non deviné : UMICORE, bce 0401574852.
const CIBLES = [
  { url: "/v1/eu/entreprise/BE/0401574852/transactions-dirigeants", pourquoi: "description « director/insider transactions » (UMICORE, bce lu dans fsma_emetteurs)" },
];

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `resultats/${horodatage}-bazaar-reindex-complement`;
mkdirSync(dossier, { recursive: true });
const avant = await solde();
console.log(`solde USDC avant : ${avant === null ? "?" : (Number(avant) / 1e6).toFixed(6)} $`);

const resultats: Array<Record<string, unknown>> = [];
for (const [i, cible] of CIBLES.entries()) {
  const t0 = Date.now();
  try {
    const r = await payer(`${api}${cible.url}`, { headers: { Accept: "application/json, application/pdf" } });
    const brut = Buffer.from(await r.arrayBuffer());
    const estJson = (r.headers.get("content-type") ?? "").includes("json");
    writeFileSync(`${dossier}/${String(i + 1).padStart(2, "0")}${estJson ? ".json" : ".pdf"}`, brut);
    const paye = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
    console.log(`${r.ok ? "✔" : "✗"} ${r.status} ${cible.url}  (${Date.now() - t0} ms, ${brut.length} o)${paye ? " · réglé" : " · NON réglé"} — ${cible.pourquoi}`);
    resultats.push({ url: cible.url, http: r.status, regle: Boolean(paye), octets: brut.length });
  } catch (e) {
    console.log(`✗ ${cible.url} — ${String(e).slice(0, 140)}`);
    resultats.push({ url: cible.url, erreur: String(e).slice(0, 300) });
  }
}
const apres = await solde();
console.log(`solde USDC après : ${apres === null ? "?" : (Number(apres) / 1e6).toFixed(6)} $`);
writeFileSync(`${dossier}/bilan.json`, JSON.stringify({ horodatage, wallet: compte.address, resultats }, null, 1));
console.log(`réponses conservées : ${dossier}`);
