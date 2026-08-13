/**
 * Calibration Pappers — côté SIRENIC : achat RÉEL du score des 27 SIREN de
 * l'échantillon (~27 × 0,10 $ = 2,70 $). GO CDU du 11/08/2026 (« go a »).
 *
 * Chaque réponse complète est conservée dans resultats/<horodatage>/ (règle
 * CDU du 24/07, étendue le 11/08 : le dossier part ensuite sur le dépôt privé
 * le dépôt privé de traces).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-calibration-pappers.ts
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, http, erc20Abi } from "viem";
import { base } from "viem/chains";
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
const client = new x402Client();
registerExactEvmScheme(client, { signer: compte });
const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const chaine = createPublicClient({ chain: base, transport: http() });
async function soldeUsdc(): Promise<string> {
  const brut = await chaine.readContract({
    address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [compte.address],
  });
  return (Number(brut) / 1e6).toFixed(6);
}

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `resultats/calibration-pappers-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const lignes = readFileSync("/home/ubuntu/calibration-pappers/echantillon.tsv", "utf8")
  .trim().split("\n").slice(1)
  .map((l) => l.split("\t"))
  .map(([siren, categorie]) => ({ siren, categorie }));

const soldeAvant = await soldeUsdc();
console.log(`Wallet ${compte.address} — solde avant : ${soldeAvant} USDC`);
console.log(`${lignes.length} SIREN, coût attendu ≈ ${(lignes.length * 0.1).toFixed(2)} $\n`);

const recap: Array<Record<string, unknown>> = [];
for (const { siren, categorie } of lignes) {
  let statut = 0; let resume = "";
  try {
    const r = await payer(`${api}/v1/score/defaillance/${siren}`);
    statut = r.status;
    const texte = await r.text();
    writeFileSync(`${dossier}/${siren}.json`, texte);
    if (statut === 200) {
      const c = JSON.parse(texte) as Record<string, unknown>;
      resume = `${c.score_risque} ${c.classe} (confiance ${c.confiance}, âge ${c.age_exercice_mois} mois)`;
    } else resume = texte.slice(0, 90);
  } catch (e) {
    resume = `EXCEPTION ${String(e).slice(0, 90)}`;
  }
  console.log(`${siren} [${categorie}] → HTTP ${statut} ${resume}`);
  recap.push({ siren, categorie, statut, resume });
  await new Promise((r) => setTimeout(r, 400));
}

const soldeApres = await soldeUsdc();
writeFileSync(`${dossier}/recap.json`, JSON.stringify({
  date: horodatage, wallet: compte.address,
  solde_avant: soldeAvant, solde_apres: soldeApres,
  depense_usdc: (Number(soldeAvant) - Number(soldeApres)).toFixed(6),
  appels: recap,
}, null, 2));
console.log(`\nSolde après : ${soldeApres} USDC (dépense ${(Number(soldeAvant) - Number(soldeApres)).toFixed(2)} $)`);
console.log(`Résultats : ${dossier}/`);
