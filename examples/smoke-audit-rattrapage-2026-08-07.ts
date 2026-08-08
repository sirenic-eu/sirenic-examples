/**
 * Rattrapage du smoke d'audit fonctionnel (2026-08-07, ~0,39 $) :
 * les 6 routes manquées par le passage générique (divergence de nom de
 * paramètre grille vs contrats — constat d'audit) + cycle de vie complet
 * de la surveillance créée au passage 1 (renouveler puis arrêter).
 *
 *   cd /home/ubuntu/sirenic-examples
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-audit-rattrapage-2026-08-07.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { base } from "viem/chains";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { CONTRATS } from "/home/ubuntu/apps/sirenic/src/contrats/exemples.ts";

const api = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const cle = process.env.TEST_WALLET_KEY;
if (!cle?.startsWith("0x")) { console.error("TEST_WALLET_KEY manquante"); process.exit(1); }
const compte = privateKeyToAccount(cle as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: compte });
const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const rpc = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const solde = async () => { try { return await rpc.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [compte.address] }); } catch { return null; } };

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `resultats/audit-fonctionnel-rattrapage-${horodatage}`;
mkdirSync(dossier, { recursive: true });
let n = 0;
async function acheter(nom: string, url: string) {
  n += 1;
  const debut = Date.now();
  const r = await payer(`${api}${url}`, { signal: AbortSignal.timeout(120_000) });
  const recu = Boolean(r.headers.get("payment-response") ?? r.headers.get("x-payment-response"));
  const texte = await r.text();
  let corps: unknown; try { corps = JSON.parse(texte); } catch { corps = texte.slice(0, 400); }
  writeFileSync(`${dossier}/${String(n).padStart(2, "0")}-${nom}.json`, JSON.stringify({ _meta: { url, statut: r.status, recu }, reponse: corps }, null, 2));
  console.log(`  ${r.status} ${recu ? "$" : " "} ${Math.round((Date.now() - debut) / 100) / 10}s ${nom} ${url}`);
  return corps;
}

const C = CONTRATS as Record<string, { pathParams?: Record<string, string> }>;
const lvRegnr = C["/v1/eu/entreprise/LV/{regnr}/comptes"]?.pathParams?.regnr ?? C["/v1/eu/entreprise/LV/{regnr}/dirigeants"]?.pathParams?.regnr;
const eeReg = C["/v1/eu/entreprise/EE/{registrikood}/comptes"]?.pathParams?.registrikood;
const skIco = C["/v1/eu/entreprise/SK/{ico}/comptes"]?.pathParams?.ico;
const skDate = C["/v1/eu/entreprise/SK/{ico}/comptes/{date_cloture}"]?.pathParams?.date_cloture;

console.log(`Payeur : ${compte.address}`);
const avant = await solde();
console.log(`Solde avant : ${avant === null ? "?" : formatUnits(avant, 6)}`);

if (lvRegnr) await acheter("LV-comptes", `/v1/eu/entreprise/LV/${lvRegnr}/comptes`);
if (eeReg) await acheter("EE-comptes", `/v1/eu/entreprise/EE/${eeReg}/comptes`);
if (skIco) {
  const liste = await acheter("SK-comptes-liste", `/v1/eu/entreprise/SK/${skIco}/comptes`);
  const d = skDate ?? (() => { const s = JSON.stringify(liste).match(/"date_cloture":"([0-9-]+)"/); return s?.[1]; })();
  if (d) await acheter("SK-comptes-detail", `/v1/eu/entreprise/SK/${skIco}/comptes/${d}`);
}
await acheter("DK-comptes-detail", `/v1/eu/entreprise/DK/41235292/comptes/2025-12-31`);
await acheter("GB-comptes-detail", `/v1/eu/entreprise/GB/00095407/comptes/2025-12-31`);
await acheter("BE-comptes-detail-json-recent", `/v1/eu/entreprise/BE/0400378485/comptes/2025-00539072`);

// Cycle de vie surveillance : renouveler (payant) puis arrêter (gratuit)
const SW = "sw_2bcc72f5-e579-4a2b-9938-3455fd33ee51.MjAyNi0wOC0wN1QxNzo1ODo0MS44MzZa.yYGXElMYkIFnFZdXulkt-maZ4nN634jzjLeAhn7mPtogn_lEhF1EwSn64zwdEi5zTfYQGSkUWYgC_6IIr4c9Cg";
await acheter("surveillance-renouveler", `/v1/surveillance/${encodeURIComponent(SW)}/renouveler`);
const stop = await fetch(`${api}/v1/surveillance/${encodeURIComponent(SW)}/arreter`);
console.log(`  arreter (gratuit) : HTTP ${stop.status} ${(await stop.text()).slice(0, 120)}`);

await new Promise(t => setTimeout(t, 30_000));
const apres = await solde();
console.log(`Solde après : ${apres === null ? "?" : formatUnits(apres, 6)} (dépense ${avant !== null && apres !== null ? formatUnits(avant - apres, 6) : "?"})`);
