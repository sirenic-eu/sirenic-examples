/**
 * Runner d'achats SÉRIEL pour l'audit 2026-08-13 (Passe A, matrice fonctionnelle).
 * Wallet test uniquement (0x9218fd5A…), USDC only, plafond par job. Nonce séquentiel
 * (aucun parallélisme). Sauve le corps BRUT complet dans le dépôt privé de traces.
 *
 *   node --env-file=.env.wallet-test scripts/audit-runner-2026-08-13.mjs <jobs.json> <out_dir>
 *
 * jobs.json = [{ "path": "/v1/...", "max": 0.10, "label": "score-liq-ouverte" }, ...]
 */
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { readFile, writeFile } from "node:fs/promises";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const jobsPath = process.argv[2];
const outDir = process.argv[3];
const key = process.env.TEST_WALLET_KEY;
if (!jobsPath || !outDir || !key?.startsWith("0x")) {
  console.error("usage: --env-file=.env.wallet-test audit-runner.mjs <jobs.json> <out_dir>");
  process.exit(2);
}
const account = privateKeyToAccount(key);
console.log("wallet:", account.address);

const jobs = JSON.parse(await readFile(jobsPath, "utf8"));
let totalPaie = 0;
const recap = [];

for (const job of jobs) {
  // Client neuf par job : le plafond de prix est propre à chaque appel.
  const client = new x402Client((_v, reqs) => {
    const usdc = reqs.find((r) => r.asset.toLowerCase() === USDC);
    if (!usdc) throw new Error("pas d'option USDC");
    const montant = Number(usdc.amount) / 1e6;
    if (montant > job.max) throw new Error(`devis ${montant} > plafond ${job.max}`);
    return usdc;
  });
  registerExactEvmScheme(client, { signer: account });
  const paidFetch = wrapFetchWithPayment(fetch, client);

  const t0 = Date.now();
  let status = 0, ms = 0, ct = "", saved = "", note = "";
  try {
    const r = await paidFetch(`https://api.sirenic.eu${job.path}`, { signal: AbortSignal.timeout(240_000) });
    ms = Date.now() - t0;
    status = r.status;
    ct = r.headers.get("content-type") || "";
    const safe = job.label.replace(/[^a-z0-9_-]/gi, "_");
    if (ct.includes("pdf")) {
      const buf = Buffer.from(await r.arrayBuffer());
      saved = `${outDir}/${safe}.pdf`;
      await writeFile(saved, buf);
      note = `PDF ${(buf.length/1024).toFixed(0)}Ko`;
    } else {
      const body = await r.text();
      saved = `${outDir}/${safe}.json`;
      await writeFile(saved, body);
      note = `${body.length} o`;
    }
    // Un 2xx implique un paiement réglé (le montant coté a été accepté).
    if (status >= 200 && status < 300) totalPaie += Math.min(job.max, job.priceGuess ?? job.max);
  } catch (e) {
    ms = Date.now() - t0;
    note = `ERREUR ${String(e.message).slice(0, 120)}`;
  }
  console.log(`[${status}] ${job.path}  ${ms}ms  ${note}  -> ${saved}`);
  recap.push({ label: job.label, path: job.path, status, ms, ct, note, saved });
}

await writeFile(`${outDir}/_recap.json`, JSON.stringify(recap, null, 2));
console.log(`\n== ${jobs.length} jobs, dépense estimée ≤ ${totalPaie.toFixed(3)} USDC (bornée par les plafonds) ==`);
