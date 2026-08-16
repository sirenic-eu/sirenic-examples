import { writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
const compte = privateKeyToAccount(process.env.TEST_WALLET_KEY as `0x${string}`);
const D = "resultats/audit-produit-2026-08-12T12-28-39-801Z";
const PANIER = [
  { nom: "comparer-danone-biogroup", chemin: "/v1/comparer?sirens=552032534,024080749", max: 0.30 },
  { nom: "bodacc-recherche-collective-7j", chemin: "/v1/bodacc/recherche?famille=collective&depuis=2026-08-05&jusqu_a=2026-08-12", max: 0.06 },
  { nom: "dossier-airvance", chemin: "/v1/entreprise/490586708/dossier?blocs=score,finances,alertes_bodacc", max: 0.30 },
];
for (const { nom, chemin, max } of PANIER) {
  const client = new x402Client((_v, reqs) => {
    const u = reqs.find((r) => r.asset.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    if (!u) throw new Error("pas d'USDC");
    const m = Number(u.amount) / 1e6;
    if (m > max) throw new Error(`devis ${m} > plafond ${max}`);
    console.log(`${nom} : devis ${m} $`);
    return u;
  });
  registerExactEvmScheme(client, { signer: compte });
  const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;
  try {
    const r = await payer(`https://api.sirenic.eu${chemin}`, { signal: AbortSignal.timeout(240_000) });
    const corps = await r.text();
    writeFileSync(`${D}/${nom}.json`, corps);
    console.log(`${nom} → HTTP ${r.status}, ${corps.length} o`);
  } catch (e) { console.log(`${nom} → EXCEPTION ${String(e).slice(0, 140)}`); }
  await new Promise((r) => setTimeout(r, 400));
}
