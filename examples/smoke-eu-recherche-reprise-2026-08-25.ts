/**
 * REPRISE de la SEULE route fermée du balayage payé du 25/08/2026.
 *
 * `/v1/eu/recherche?q=equinor&pays=NO` a rendu 503 `registres_muets` à
 * 15:46:19 UTC après **12 392 ms** — soit très exactement le budget par patte
 * (`budgetPatteMs = 12_000` dans src/eu/service.ts). Le paiement a été annulé
 * (log prod : « paiement vérifié puis annulé (handler en échec) — aucun débit »),
 * donc la fiche Bazaar n'a été ni réarmée ni habillée de l'icône : c'est la
 * 80e ressource, la seule que le balayage n'a pas couverte.
 *
 * Ce que ce passage MESURE, et pourquoi il n'est pas un simple « on retente » :
 * pour `pays=NO`, la recherche n'a qu'UNE patte — la table locale (NO fait
 * partie de REGISTRES_LOCAUX, il n'est pas dans `registresLive`), et GLEIF
 * n'est PAS ajouté quand un registre local existe. Une seule patte muette =
 * toutes les pattes muettes = 503. Un succès ici dit « incident transitoire
 * côté stock local » ; un second 503 dit « la route est invendable pour NO »,
 * ce qui est un défaut de production, pas un aléa.
 *
 *   cd /home/ubuntu/sirenic-examples
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-eu-recherche-reprise-2026-08-25.ts
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

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `resultats/${horodatage}-eu-recherche-reprise`;
mkdirSync(dossier, { recursive: true });

const url = "/v1/eu/recherche?q=equinor&pays=NO";
const t0 = Date.now();
const r = await payer(`${api}${url}`, {
  headers: { Accept: "application/json" },
  signal: AbortSignal.timeout(180_000),
});
const brut = Buffer.from(await r.arrayBuffer());
const ms = Date.now() - t0;
const regle = Boolean(r.headers.get("payment-response") ?? r.headers.get("x-payment-response"));
writeFileSync(`${dossier}/eu-recherche-NO.json`, brut);

let nombre: number | null = null;
let muets: unknown = null;
try {
  const corps = JSON.parse(brut.toString("utf8")) as { nombre_resultats?: number; registres_muets?: unknown };
  nombre = corps.nombre_resultats ?? null;
  muets = corps.registres_muets ?? null;
} catch {
  /* corps non JSON : le fichier conservé fait foi */
}

console.log(`HTTP ${r.status} en ${ms} ms — ${regle ? "RÉGLÉ" : "NON facturé"}`);
console.log(`nombre_resultats: ${nombre ?? "?"} | registres_muets: ${JSON.stringify(muets)}`);
// Un 200 réglé mais VIDE serait le pire des trois cas : l'acheteur paie une
// liste vide sur une requête dont on sait qu'elle a une réponse (Equinor ASA
// existe au registre norvégien). On le dit ici, on ne le déduit pas plus tard.
const verdict =
  r.status === 200 && regle && (nombre ?? 0) > 0
    ? "REPRISE OK (incident transitoire)"
    : r.status === 200 && regle
      ? "SUCCÈS À ZÉRO — 200 réglé mais aucun résultat"
      : r.status === 503 && !regle
        ? "TOUJOURS FERMÉE (503 non facturé) — défaut persistant côté patte NO"
        : `INATTENDU (${r.status}, ${regle ? "réglé" : "non facturé"})`;
console.log(`══ ${verdict} ══`);
writeFileSync(
  `${dossier}/bilan.json`,
  JSON.stringify({ horodatage, url, http: r.status, regle, ms, nombre_resultats: nombre, registres_muets: muets, verdict }, null, 1),
);
console.log(`réponse conservée : ${dossier}`);
process.exit(verdict.startsWith("REPRISE OK") ? 0 : 1);
