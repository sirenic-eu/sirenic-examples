/**
 * BALAYAGE COMPLET pré-vacances — les 76 routes payantes, une fois chacune
 * (demande CDU du 16/08/2026 : « tester chaque endpoint pour être sûr »).
 *
 * Les cibles viennent de `cibles-balayage-2026-08-16.json`, généré depuis la
 * SOURCE DE VÉRITÉ du dépôt (CONTRATS + grille) : chaque appel utilise les
 * identifiants d'exemple RÉELS publiés par les contrats. Exécution SÉRIELLE
 * (nonce séquentiel du wallet).
 *
 * Verdicts par route :
 *  - ACHETABLE : 2xx + paiement réglé ;
 *  - FERMÉE (reprise) : 503 NON facturé sur un stock en reconstruction
 *    post-incident (SK/DK/CZ/SE comptes-insolvabilité, BORME ES) — attendu,
 *    la route rouvre seule quand sa collecte finit ;
 *  - ANOMALIE : tout le reste (à examiner).
 *
 * La surveillance créée est ARRÊTÉE en fin de balayage (route gratuite), comme
 * dans smoke-test.ts. Dépense attendue ~4,6 $ ; mesurée on-chain avant/après.
 *
 *   cd /home/ubuntu/sirenic-examples
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-balayage-complet-2026-08-16.ts
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
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
    return await rpc.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [compte.address] });
  } catch { return null; }
};

interface Cible { endpoint: string; prix: string; mime: string; url: string }
const cibles: Cible[] = JSON.parse(readFileSync(new URL("./cibles-balayage-2026-08-16.json", import.meta.url), "utf8"));

/** Routes dont le stock est en RECONSTRUCTION post-incident du 15/08 : un 503
 *  non facturé y est le comportement contractuel, pas une panne. */
const REPRISE_EN_COURS = [
  "/v1/eu/entreprise/SK/{ico}/comptes",
  "/v1/eu/entreprise/SK/{ico}/comptes/{date_cloture}",
  "/v1/eu/entreprise/DK/{id}/comptes",
  "/v1/eu/entreprise/DK/{id}/comptes/{date_cloture}",
  "/v1/eu/entreprise/CZ/{ico}/insolvabilite",
  "/v1/eu/entreprise/SE/{orgnr}/comptes",
  "/v1/eu/entreprise/ES/{hoja}/actes",
  "/v1/eu/entreprise/FI/{business_id}/comptes",
];

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `resultats/${horodatage}-balayage-complet`;
mkdirSync(dossier, { recursive: true });

const avant = await solde();
console.log(`wallet ${compte.address} — solde avant : ${avant === null ? "?" : (Number(avant) / 1e6).toFixed(6)} $`);
console.log(`${cibles.length} routes à balayer, en série\n`);

let jetonSurveillance: string | null = null;
const verdicts: Array<Record<string, unknown>> = [];

for (const [i, cible] of cibles.entries()) {
  let url = cible.url;
  // Le renouvellement porte sur la surveillance créée deux crans plus haut.
  if (cible.endpoint === "/v1/surveillance/{jeton}/renouveler") {
    if (!jetonSurveillance) {
      verdicts.push({ endpoint: cible.endpoint, verdict: "ANOMALIE", detail: "pas de jeton (création échouée en amont)" });
      console.log(`✗ ${cible.endpoint} — pas de jeton de surveillance`);
      continue;
    }
    url = url.replace("sw_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", jetonSurveillance);
  }
  const t0 = Date.now();
  try {
    const r = await payer(`${api}${url}`, {
      headers: { Accept: `${cible.mime}, application/json` },
      signal: AbortSignal.timeout(180_000),
    });
    const brut = Buffer.from(await r.arrayBuffer());
    const ms = Date.now() - t0;
    const regle = Boolean(r.headers.get("payment-response") ?? r.headers.get("x-payment-response"));
    const nom = `${String(i + 1).padStart(2, "0")}-${cible.endpoint.replace(/[^a-z0-9]+/gi, "-")}`;
    const estJson = (r.headers.get("content-type") ?? "").includes("json");
    writeFileSync(`${dossier}/${nom}${estJson ? ".json" : ".pdf"}`, brut);

    if (cible.endpoint === "/v1/surveillance/creer" && r.ok) {
      try { jetonSurveillance = String((JSON.parse(brut.toString("utf8")) as { surveillance_id?: string }).surveillance_id ?? ""); } catch { /* sans jeton */ }
    }
    const verdict = r.ok && regle
      ? "ACHETABLE"
      : r.status === 503 && !regle && REPRISE_EN_COURS.includes(cible.endpoint)
        ? "FERMÉE (reprise)"
        : "ANOMALIE";
    verdicts.push({ endpoint: cible.endpoint, prix: cible.prix, http: r.status, regle, ms, octets: brut.length, verdict });
    const marque = verdict === "ACHETABLE" ? "✔" : verdict.startsWith("FERMÉE") ? "◌" : "✗";
    console.log(`${marque} ${String(r.status)} ${cible.endpoint} (${ms} ms, ${cible.prix}${regle ? " réglé" : " non facturé"}) ${verdict !== "ACHETABLE" ? "— " + verdict : ""}`);
  } catch (e) {
    verdicts.push({ endpoint: cible.endpoint, prix: cible.prix, erreur: String(e).slice(0, 200), verdict: "ANOMALIE" });
    console.log(`✗ ${cible.endpoint} — ${String(e).slice(0, 120)}`);
  }
}

// Ménage : la surveillance de test est arrêtée (gratuit, purge vérifiée en base
// par le produit) — on ne laisse pas une watch de 30 jours au ledger.
if (jetonSurveillance) {
  const r = await fetch(`${api}/v1/surveillance/${jetonSurveillance}/arreter`);
  console.log(`\nsurveillance de test arrêtée : HTTP ${r.status}`);
}

const apres = await solde();
const depense = avant !== null && apres !== null ? Number(avant - apres) / 1e6 : null;
const total = { achetables: 0, fermees: 0, anomalies: 0 };
for (const v of verdicts) {
  if (v.verdict === "ACHETABLE") total.achetables += 1;
  else if (String(v.verdict).startsWith("FERMÉE")) total.fermees += 1;
  else total.anomalies += 1;
}
console.log(`\n══ BILAN : ${total.achetables} achetables, ${total.fermees} fermées (reprise), ${total.anomalies} anomalies — dépense on-chain ${depense === null ? "?" : depense.toFixed(6)} $ ══`);
writeFileSync(`${dossier}/bilan.json`, JSON.stringify({ horodatage, wallet: compte.address, depense_usdc: depense, total, verdicts }, null, 1));
console.log(`réponses conservées : ${dossier}`);
process.exit(total.anomalies === 0 ? 0 : 1);
