/**
 * Vérification PAYANTE du barème v1.2 en production (~0,10 $).
 *
 * On achète le score d'une entreprise dont la source ne calcule PAS deux
 * ratios (VERA BIJOUX, 818813172 : autonomie financière et liquidité publiées
 * à 0 trois exercices de suite, alors que l'entreprise est bénéficiaire). Avant
 * la v1.2 elle payait 32 points de risque pour deux cases vides.
 *
 * Une vérification gratuite ne peut PAS voir ce changement : il vit dans le
 * corps payant (leçon du 01/08).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-score-v12.ts
 */
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
const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(cle as `0x${string}`) });
const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;

const siren = process.argv[2] ?? "818813172";
const r = await payer(`${api}/v1/score/defaillance/${siren}`);
console.log(`GET /v1/score/defaillance/${siren} → HTTP ${r.status}`);
if (r.status !== 200) {
  console.error(await r.text());
  process.exit(1);
}
const c = (await r.json()) as Record<string, unknown>;
console.log(JSON.stringify(
  {
    score_risque: c.score_risque,
    classe: c.classe,
    confiance: c.confiance,
    version_modele: c.version_modele,
    ratios_non_calcules: c.ratios_non_calcules,
    composantes: (c.composantes as Array<{ indicateur: string; points: number }>).map(
      (x) => `${x.indicateur}=${x.points}`,
    ),
  },
  null,
  2,
));

const controles: Array<[string, boolean]> = [
  ["barème v1.2 servi", c.version_modele === "defaillance-v1.2"],
  ["ratios non calculés NOMMÉS", Array.isArray(c.ratios_non_calcules) && (c.ratios_non_calcules as unknown[]).length > 0],
  [
    "aucune pénalité d'autonomie financière",
    !(c.composantes as Array<{ indicateur: string }>).some((x) => x.indicateur === "autonomie_financiere_%"),
  ],
  ["note explicative présente", typeof c.note_ratios === "string"],
];
for (const [libelle, ok] of controles) console.log(`  ${ok ? "✓" : "✗"} ${libelle}`);
if (controles.some(([, ok]) => !ok)) process.exit(1);
