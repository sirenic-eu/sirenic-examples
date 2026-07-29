/**
 * Paye UN endpoint Sirenic précis avec le wallet de test — vérification
 * ciblée post-correctif (ex. /comptes-pdf après le fix grands déposants).
 *
 *   node --env-file=.env.wallet-test --import tsx scripts/payer-un-endpoint.ts /v1/entreprise/552032534/comptes-pdf 2.00
 *
 * Argument 1 : chemin ; argument 2 : prix MAXIMAL accepté en USD (garde-fou).
 * Un statut non-200 est rapporté tel quel (402/503/500) — jamais facturé.
 */
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const chemin = process.argv[2];
const maxUsd = Number(process.argv[3] ?? "0");
const key = process.env.TEST_WALLET_KEY;
if (!chemin || !maxUsd || !key?.startsWith("0x")) {
  console.error("usage: TEST_WALLET_KEY=… payer-un-endpoint.ts <chemin> <prix max USD>");
  process.exit(2);
}

const account = privateKeyToAccount(key as `0x${string}`);
const client = new x402Client((_v, reqs) => {
  const usdc = reqs.find((r) => r.asset.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  if (!usdc) throw new Error("pas d'option USDC dans le devis");
  const montant = Number(usdc.amount) / 1e6;
  if (montant > maxUsd) throw new Error(`devis ${montant} $ > plafond ${maxUsd} $ — refus`);
  return usdc;
});
registerExactEvmScheme(client, { signer: account });
const paidFetch = wrapFetchWithPayment(fetch, client);

const debut = Date.now();
const r = await paidFetch(`https://api.sirenic.eu${chemin}`, { signal: AbortSignal.timeout(240_000) });
const ms = Date.now() - debut;
// Un PDF se sauvegarde (3e argument = chemin de sortie), le JSON s'affiche.
const sortie = process.argv[4];
if (sortie && (r.headers.get("content-type") ?? "").includes("pdf")) {
  const octets = Buffer.from(await r.arrayBuffer());
  await import("node:fs/promises").then((fs) => fs.writeFile(sortie, octets));
  console.log(`HTTP ${r.status} en ${ms} ms — PDF ${(octets.length / 1024).toFixed(0)} Ko écrit dans ${sortie}`);
  process.exit(0);
}
const corps = await r.text();
console.log(`HTTP ${r.status} en ${ms} ms`);
try {
  const j = JSON.parse(corps) as Record<string, unknown>;
  const resume = {
    depuis_cache: j.depuis_cache,
    couverture: (j.annexe as Record<string, unknown> | undefined)?.couverture,
    error: j.error,
    message: typeof j.message === "string" ? (j.message as string).slice(0, 160) : undefined,
    cles: Object.keys(j).slice(0, 10),
  };
  console.log(JSON.stringify(resume, null, 1));
} catch {
  console.log(corps.slice(0, 300));
}
