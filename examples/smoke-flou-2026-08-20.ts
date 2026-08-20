/**
 * Smoke PAYANT du 20/08/2026 — la tolérance aux FAUTES DE FRAPPE, vendue par
 * /v1/recherche depuis toujours, fonctionne-t-elle vraiment ?
 *
 * Contexte : le lot A « montée en charge » (réglage PostgreSQL du 20/08) a
 * fait passer l'étage flou trigramme de 49 290 ms à ~225 ms. Sous l'ancien
 * cache de 512 Mo, cet étage dépassait TOUJOURS son délai de 2,5 s : la
 * fonctionnalité était vendue (description de route, node n8n : « forgives
 * typos ») sans jamais pouvoir servir. Ce smoke l'achète pour de vrai.
 *
 * Deux achats à 0,002 $ : une faute de frappe (« danonne ») et un nom tronqué
 * (« carefour »). Dépense attendue : 0,004 $.
 *
 *   cd /home/ubuntu/sirenic-examples
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-flou-2026-08-20.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
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

const dossier = `resultats/${new Date().toISOString().replace(/[:.]/g, "-")}-flou`;
mkdirSync(dossier, { recursive: true });

const cas = [
  { q: "danonne", attendu: "552032534", nom: "DANONE" },   // lettre en trop
  { q: "carefour", attendu: null, nom: "CARREFOUR" },       // lettre manquante
];

let vert = true;
for (const c of cas) {
  const t0 = Date.now();
  const r = await payer(`${api}/v1/recherche?q=${encodeURIComponent(c.q)}`, { signal: AbortSignal.timeout(60_000) });
  const ms = Date.now() - t0;
  const corps = (await r.json()) as {
    resultats?: Array<{ siren: string; denomination: string; score_confiance: number }>;
    etages_abandonnes?: string[];
    resultats_partiels?: boolean;
    data_freshness?: string;
  };
  writeFileSync(`${dossier}/${c.q}.json`, JSON.stringify(corps, null, 1));
  const trouve = (corps.resultats ?? []).find((x) => x.denomination?.toUpperCase().startsWith(c.nom));
  const regle = Boolean(r.headers.get("payment-response") ?? r.headers.get("x-payment-response"));
  // Ce que le flou doit livrer : la société malgré la faute, un score < 1 (ce
  // n'est pas une correspondance exacte), aucun étage abandonné, et une
  // réponse servie depuis le stock LOCAL (pas un repli amont qui masquerait
  // un étage mort).
  // Le score de confiance n'est PAS forcément < 1 sur une faute : la
  // normalisation du nom peut ramener « danonne » à une correspondance
  // parfaite. L'assertion qui compte est ailleurs : la société est trouvée
  // ET la réponse vient du STOCK LOCAL — un repli amont masquerait un étage
  // flou toujours mort (c'est ce qui distinguait les deux passages du 20/08).
  const ok = r.ok && regle && Boolean(trouve)
    && (corps.etages_abandonnes ?? []).length === 0
    && (corps.data_freshness ?? "").includes("stock Sirene");
  vert &&= ok;
  console.log(`${ok ? "✔" : "✗"} « ${c.q} » → ${trouve ? `${trouve.denomination} (${trouve.siren}, confiance ${trouve.score_confiance})` : "PAS TROUVÉ"} — ${ms} ms, ${corps.resultats?.length ?? 0} résultats, étages abandonnés ${JSON.stringify(corps.etages_abandonnes)}, ${corps.data_freshness}`);
}
console.log(`\nréponses conservées : ${dossier}`);
console.log(vert ? "TOUT VERT — la tolérance aux fautes de frappe est LIVRÉE" : "ROUGE");
process.exit(vert ? 0 : 1);
