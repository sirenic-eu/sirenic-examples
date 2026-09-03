/**
 * Pay-and-call smoke of the procurement-anticipation routes (2026-08-17,
 * extended 2026-09-02) — the ONLY proof a route is actually buyable.
 * Requires the extended DECP stock (post migration 050 re-ingestion); before
 * that, the three routes answer an honest 503 `collecte_en_cours` and nothing
 * is charged.
 *
 * ⚠️ Each call asserts SEVERAL fields, not one. A single field name proves the
 * route answered, not that it delivered: on 2026-08 a paid probe validated a
 * response that carried exactly one useful value. The lists below name the
 * fields that ARE the product — how to read an amount (envelope vs firm
 * price), the lot number, who shares the contract, and what is subcontracted.
 * Fields opened by migration 066 stay `null` until the v4 re-ingestion runs:
 * their KEY must be present, their value may legitimately be null.
 *
 *   TEST_WALLET_KEY=0x... npx tsx examples/smoke-marches-predictifs.ts
 *
 * Cost: $0.05 + $0.02 + $0.02 + $0.01 = $0.10 in USDC on Base mainnet.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const apiUrl = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const key = process.env.TEST_WALLET_KEY;
if (!key?.startsWith("0x")) {
  console.error("Set TEST_WALLET_KEY=0x<private key of a DEDICATED test wallet>");
  process.exit(2);
}
const account = privateKeyToAccount(key as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const fetchPayant = wrapFetchWithPayment(fetch, client);

const dossierResultats = join("resultats", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(dossierResultats, { recursive: true });

const CALLS: Array<{ path: string; expect: string[]; price: string }> = [
  // Tender anticipation: construction contracts expiring within 6 months.
  {
    path: "/v1/marches/expirations?cpv=45&fenetre_mois=6",
    expect: ["total_marches", "montant_est_enveloppe", "modalites_execution", "lot_numero"],
    price: "$0.05",
  },
  // Buyer profile: CHU de Toulouse, the most prolific buyer in the DECP stock.
  {
    path: "/v1/acheteur/26310012500016/profil",
    expect: [
      "titulaires_principaux",
      "part_montants_enveloppe_pct",
      "part_sous_traitance_declaree_pct",
      "modalites_connues",
    ],
    price: "$0.02",
  },
  // Rivals on the same CPV segments (a training operator with 26 contracts).
  { path: "/v1/entreprise/130031487/concurrents-marches", expect: ["concurrents"], price: "$0.02" },
  // The per-company route: the richest DECP response, and the one that must
  // never let an amount be read as revenue.
  {
    path: "/v1/entreprise/130031487/marches-publics",
    expect: [
      "marches_en_cours",
      "montant_plafonds_accords_cadres",
      "montant_enveloppes",
      "nombre_modalites_connues",
      "montant_est_enveloppe",
      "nombre_titulaires",
      "lot_numero",
      "sous_traitance",
      "plateforme_source",
      // Régime DECP de la ligne et durée après avenant : ajoutés le 03/09/2026
      // avec la profondeur historique 2019-2023. La durée amendée est la
      // donnée que nos réserves déclaraient ABSENTE de la source — vrai du
      // régime en vigueur, faux du v3 qui en porte 56 516.
      "regime",
      "duree_mois_modifiee",
    ],
    price: "$0.01",
  },
];

let echecs = 0;
let ordre = 0;
for (const appel of CALLS) {
  const r = await fetchPayant(`${apiUrl}${appel.path}`, {
    headers: { Accept: "application/json" },
  });
  const corps = await r.text();
  ordre += 1;
  const nom = `${String(ordre).padStart(2, "0")}-${appel.path.replace(/^\/v1\//, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 80)}.json`;
  writeFileSync(join(dossierResultats, nom), corps);
  const manquants = appel.expect.filter((champ) => !corps.includes(`"${champ}"`));
  const ok = r.status === 200 && manquants.length === 0;
  if (!ok) echecs += 1;
  console.log(
    `${ok ? "✅" : "❌"} ${appel.price} ${appel.path} → HTTP ${r.status}` +
      (ok ? ` (${appel.expect.length} champs vérifiés)` : ` — champs absents : ${manquants.join(", ")}`),
  );
}
console.log(echecs === 0 ? `\nTout est vert — réponses conservées dans ${dossierResultats}/` : `\n${echecs} échec(s) — corps conservés dans ${dossierResultats}/`);
process.exit(echecs === 0 ? 0 : 1);
