/**
 * Smoke PAYANT de `/v1/facture/verifier` (route livrée le 16/08/2026, b07d589).
 *
 * Deux achats ($0.04) :
 *  1. Cas COHÉRENT — Danone (552032534) avec SA vraie TVA calculée
 *     FR27552032534 et l'IBAN d'exemple de documentation : attendu
 *     verdict=coherent + la réserve non_verifie + le drapeau
 *     iban_exemple_documentation. Cet achat fournit l'EXEMPLE du contrat
 *     (règle « pas d'achat réel = pas d'exemple »).
 *  2. Cas INCOHÉRENT — le SIREN de Danone avec la TVA de CARREFOUR
 *     (FR14652014051, VALIDE au VIES) : attendu verdict=incoherent +
 *     tva_ne_correspond_pas_au_siren. C'est LE cas que la route existe pour
 *     attraper, et qu'une simple validation VIES ne voit pas.
 *
 *   cd /home/ubuntu/sirenic-examples
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-facture-verifier-2026-08-16.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
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

const CAS = [
  {
    nom: "coherent",
    url: "/v1/facture/verifier?siren=552032534&tva=FR27552032534&iban=FR1420041010050500013M02606",
    attendu: { verdict: "coherent" },
  },
  {
    nom: "incoherent-tva-carrefour",
    url: "/v1/facture/verifier?siren=552032534&tva=FR14652014051",
    attendu: { verdict: "incoherent", raison: "tva_ne_correspond_pas_au_siren" },
  },
];

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `resultats/${horodatage}-facture-verifier`;
mkdirSync(dossier, { recursive: true });

let echecs = 0;
for (const cas of CAS) {
  const r = await payer(`${api}${cas.url}`, { headers: { Accept: "application/json" } });
  const texte = await r.text();
  writeFileSync(`${dossier}/${cas.nom}.json`, texte);
  const paye = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  let corps: Record<string, unknown> = {};
  try { corps = JSON.parse(texte) as Record<string, unknown>; } catch { /* non-JSON */ }
  const verdictOk = corps.verdict === cas.attendu.verdict;
  const raisonOk = !cas.attendu.raison ||
    (Array.isArray(corps.raisons) && (corps.raisons as Array<{ code: string }>).some((x) => x.code === cas.attendu.raison));
  const ok = r.ok && Boolean(paye) && verdictOk && raisonOk;
  if (!ok) echecs += 1;
  console.log(`${ok ? "✔" : "✗"} ${cas.nom} — HTTP ${r.status}${paye ? " réglé" : " NON réglé"}, verdict=${String(corps.verdict)}${cas.attendu.raison ? `, raison ${cas.attendu.raison} ${raisonOk ? "présente" : "ABSENTE"}` : ""}`);
}
console.log(`réponses conservées : ${dossier}`);
process.exit(echecs === 0 ? 0 : 1);
