/**
 * Smoke PAYANT — tranche T1 « fraîcheur finlandaise » (livrée le 15/08/2026,
 * commit b7963fc).
 *
 * Ce que ce smoke doit prouver, et que 2140 tests verts ne prouvent pas :
 * 1. la route liste FI est TOUJOURS achetable après le changement de forme
 *    interne (`exercices()` rend désormais `{ photo_le, depots }` au lieu d'un
 *    tableau — une erreur là aurait cassé la route en production) ;
 * 2. `data_freshness` porte la DATE MESURÉE de la photo servie, pas une
 *    promesse de cadence : c'est le correctif d'honnêteté de la tranche ;
 * 3. l'OpenAPI servi déclare bien le 503 des deux chemins FI (contrat public) ;
 * 4. le détail d'un exercice reste achetable et inchangé.
 *
 * Coût : 0,01 $ (liste) + 0,15 $ (détail) = 0,16 $.
 *
 * Usage : TEST_WALLET_KEY=0x… npx tsx examples/smoke-fi-fraicheur-2026-08-15.ts
 */
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const apiUrl = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const key = process.env.TEST_WALLET_KEY;
if (!key?.startsWith("0x")) {
  console.error("Set TEST_WALLET_KEY=0x…");
  process.exit(1);
}

const compte = privateKeyToAccount(key as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: compte });
const payer = wrapFetchWithPayment(fetch, client);

const BUSINESS_ID = "0103396-3"; // Arkkitehtitoimisto HKP Oy (cas de référence)
const resultats: Record<string, unknown> = { horodatage: new Date().toISOString(), api: apiUrl };

// — 0. Contrat public : le 503 est-il déclaré sur les deux chemins FI ? ————
const openapi = (await (await fetch(`${apiUrl}/openapi.json`)).json()) as {
  paths: Record<string, { get?: { responses?: Record<string, unknown> } }>;
};
const codes = (chemin: string): string[] =>
  Object.keys(openapi.paths[chemin]?.get?.responses ?? {}).sort();
resultats.openapi_liste = codes("/v1/eu/entreprise/{pays}/{id}/comptes");
resultats.openapi_detail = codes("/v1/eu/entreprise/{pays}/{id}/comptes/{reference}");
console.log("OpenAPI liste  :", resultats.openapi_liste);
console.log("OpenAPI détail :", resultats.openapi_detail);

// — 1. Devis 402 (gratuit) ————————————————————————————————————————————————
const devis = await fetch(`${apiUrl}/v1/eu/entreprise/FI/${BUSINESS_ID}/comptes`);
resultats.devis_statut = devis.status;
resultats.devis_entete_paiement = devis.headers.get("payment-required") ? "présent" : "absent";
console.log(`\nDevis → HTTP ${devis.status}`);

// — 2. Achat de la liste (0,01 $) —————————————————————————————————————————
const liste = await payer(`${apiUrl}/v1/eu/entreprise/FI/${BUSINESS_ID}/comptes`);
const corpsListe = (await liste.json()) as Record<string, unknown>;
resultats.liste_statut = liste.status;
resultats.liste_corps = corpsListe;
resultats.liste_reglement = liste.headers.get("payment-response") ?? null;
console.log(`\nListe payée → HTTP ${liste.status}`);
console.log("  nombre_depots  :", corpsListe.nombre_depots);
console.log("  data_freshness :", corpsListe.data_freshness);

// — 3. Achat du détail de l'exercice le plus récent (0,15 $) ———————————————
const depots = corpsListe.depots as Array<{ date_cloture: string }> | undefined;
const plusRecent = depots?.[0]?.date_cloture;
if (plusRecent) {
  const detail = await payer(
    `${apiUrl}/v1/eu/entreprise/FI/${BUSINESS_ID}/comptes/${plusRecent}`,
  );
  const corpsDetail = (await detail.json()) as Record<string, unknown>;
  resultats.detail_statut = detail.status;
  resultats.detail_corps = corpsDetail;
  resultats.detail_reglement = detail.headers.get("payment-response") ?? null;
  console.log(`\nDétail ${plusRecent} payé → HTTP ${detail.status}`);
  console.log("  data_freshness :", corpsDetail.data_freshness);
}

// — 4. Verdict lisible ————————————————————————————————————————————————————
const fraicheur = String(corpsListe.data_freshness ?? "");
const controles: Array<[string, boolean]> = [
  ["liste achetée (200)", liste.status === 200],
  ["détail acheté (200)", resultats.detail_statut === 200],
  ["data_freshness porte une DATE (AAAA-MM-JJ)", /pré-ingéré le \d{4}-\d{2}-\d{2}/.test(fraicheur)],
  ["data_freshness annonce la borne de 21 jours", fraicheur.includes("21 jours")],
  ["OpenAPI liste déclare le 503", (resultats.openapi_liste as string[]).includes("503")],
  ["OpenAPI détail déclare le 503", (resultats.openapi_detail as string[]).includes("503")],
];
resultats.controles = Object.fromEntries(controles);
console.log("\n— Verdict —");
for (const [libelle, ok] of controles) console.log(`  ${ok ? "✅" : "❌"} ${libelle}`);
console.log(JSON.stringify(resultats));
