/**
 * Audit produit 12/08/2026 — panier d'achats réels complémentaire à la
 * calibration Pappers : produits phares (/sante, /intelligence, /comparer,
 * /kyb, /bodacc/recherche, fiches). Réponses COMPLÈTES conservées
 * (règle CDU 24/07 + 11/08).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-audit-produit-2026-08-12.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const api = "https://api.sirenic.eu";
const cle = process.env.TEST_WALLET_KEY;
if (!cle?.startsWith("0x")) { console.error("TEST_WALLET_KEY manquante"); process.exit(1); }
const compte = privateKeyToAccount(cle as `0x${string}`);

const PANIER: Array<{ nom: string; chemin: string; max: number }> = [
  { nom: "sante-biogroup",        chemin: "/v1/entreprise/024080749/sante", max: 0.20 },
  { nom: "sante-cycles-lapierre", chemin: "/v1/entreprise/016650996/sante", max: 0.20 },
  { nom: "intelligence-airvance", chemin: "/v1/intelligence/490586708", max: 1.10 },
  { nom: "comparer-danone-biogroup", chemin: "/v1/comparer?sirens=552032534,024080749", max: 0.20 },
  { nom: "kyb-airvance",          chemin: "/v1/kyb/490586708", max: 0.20 },
  { nom: "bodacc-recherche-pc-7j", chemin: "/v1/bodacc/recherche?famille=procedures-collectives&jours=7", max: 0.05 },
  { nom: "fiche-stellantis-auto", chemin: "/v1/entreprise/542065479", max: 0.01 },
  { nom: "fiche-tpe-907756969",   chemin: "/v1/entreprise/907756969", max: 0.01 },
  { nom: "dossier-airvance",      chemin: "/v1/entreprise/490586708/dossier", max: 0.01 },
];

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `resultats/audit-produit-${horodatage}`;
mkdirSync(dossier, { recursive: true });

let depense = 0;
for (const { nom, chemin, max } of PANIER) {
  const client = new x402Client((_v, reqs) => {
    const usdc = reqs.find((r) => r.asset.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    if (!usdc) throw new Error("pas d'option USDC");
    const montant = Number(usdc.amount) / 1e6;
    if (montant > max) throw new Error(`devis ${montant} $ > plafond ${max} $`);
    depense += montant;
    return usdc;
  });
  registerExactEvmScheme(client, { signer: compte });
  const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;
  const debut = Date.now();
  try {
    const r = await payer(`${api}${chemin}`, { signal: AbortSignal.timeout(240_000) });
    const corps = await r.text();
    writeFileSync(`${dossier}/${nom}.json`, corps);
    console.log(`${nom} → HTTP ${r.status} en ${Date.now() - debut} ms, ${corps.length} o`);
  } catch (e) {
    console.log(`${nom} → EXCEPTION ${String(e).slice(0, 140)}`);
  }
  await new Promise((r) => setTimeout(r, 400));
}
console.log(`\nDépense totale engagée ≈ ${depense.toFixed(3)} $ — dossier ${dossier}`);
