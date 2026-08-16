/**
 * Campagne de ré-indexation Bazaar — descriptions optimisées + fiche manquante
 * (2026-08-16, second passage du jour, après 7ed415c).
 *
 * ─────────────────────────────── pourquoi ─────────────────────────────
 * 1. `/v1/documents/{type}/{id}` vendait SANS fiche depuis le 24/07 : son
 *    `enum` de pathParamsSchema rendait l'extension discovery invalide sur
 *    l'appel gabarit du crawler (%7Btype%7D), et le facilitateur jetait la
 *    fiche en silence. L'enum est retiré (7ed415c) ; le PREMIER règlement
 *    depuis ce déploiement doit créer la fiche.
 * 2. Sept descriptions ont été réécrites pour attaquer les requêtes perdues
 *    (« company lookup KYB » rang 4, « sanctions screening » rang 4, « VAT
 *    validation » absent, « invoice verification » niche vide…). Une fiche ne
 *    se rafraîchit qu'au RÈGLEMENT sur sa route : chaque route réécrite est
 *    achetée une fois.
 * 3. Quelques routes saines sont re-payées uniquement pour pousser leurs tags
 *    (d17cf20) vers les requêtes mesurées à zéro résultat ou sans nous
 *    (search, registry, alerts, kbo, uk, decp, credit risk).
 *
 * Un 503/404 amont N'EST PAS facturé (paiement annulé) : la fiche concernée ne
 * bouge pas, et le bilan le dit. Résultats conservés puis commités sur le
 * dépôt privé de traces (règle CDU du 11/08).
 *
 *   cd /home/ubuntu/sirenic-examples
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-bazaar-reindex-2026-08-16-descriptions.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
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
    return await rpc.readContract({
      address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [compte.address],
    });
  } catch { return null; }
};

/** Cibles RÉELLES et servables aujourd'hui. FI/SK/DK/CZ/SE comptes et ES sont
 *  encore en reconstruction post-incident (503 fail-closed) : pas de cible. */
const CIBLES: Array<{ route: string; url: string | null; pourquoi: string }> = [
  // — la liste, qui donne l'id du document pour la fiche manquante
  { route: "/v1/entreprise/{siren}/documents", url: "/v1/entreprise/552032534/documents", pourquoi: "id de document pour l'achat suivant" },
  { route: "/v1/documents/{type}/{id}", url: null, pourquoi: "FICHE MANQUANTE depuis le 24/07 (enum retiré en 7ed415c)" }, // rempli au vol
  // — les 7 descriptions réécrites
  { route: "/v1/kyb/{siren}", url: "/v1/kyb/552032534", pourquoi: "description « company lookup KYB » (rang 4 → viser 1)" },
  { route: "/v1/tva/verifier/{numero}", url: "/v1/tva/verifier/FR40303265045", pourquoi: "description « VAT validation » (absent → viser 1)" },
  { route: "/v1/sanctions/check", url: "/v1/sanctions/check?name=Sberbank", pourquoi: "description « (AML/KYC) » + 6 listes (rang 4)" },
  { route: "/v1/facturation/dossier", url: "/v1/facturation/dossier?siren=552032534", pourquoi: "description « invoice verification » (niche vide)" },
  { route: "/v1/eu/facturation/dossier", url: "/v1/eu/facturation/dossier?pays=PL&id=7342867148", pourquoi: "greffe « invoice verification » UE" },
  { route: "/v1/eu/entreprise/{pays}/{id}/transactions-dirigeants", url: "/v1/eu/entreprise/BE/0403199702/transactions-dirigeants", pourquoi: "description « director/insider transactions »" },
  { route: "/v1/eu/entreprise/{pays}/{id}/comptes", url: "/v1/eu/entreprise/BE/0403199702/comptes", pourquoi: "description « company financials Europe »" },
  // — tags d17cf20 vers les requêtes à zéro résultat ou sans nous
  { route: "/v1/recherche", url: "/v1/recherche?q=Danone", pourquoi: "requête « search » (absents)" },
  { route: "/v1/entreprise/{siren}", url: "/v1/entreprise/552032534", pourquoi: "requêtes « registry » / « company profile » (absents)" },
  { route: "/v1/eu/entreprise/BE/{id}", url: "/v1/eu/entreprise/BE/0403199702", pourquoi: "requêtes « kbo » / « bce » (zéro résultat)" },
  { route: "/v1/eu/entreprise/GB/{company_number}/dirigeants", url: "/v1/eu/entreprise/GB/00445790/dirigeants", pourquoi: "requête « uk » (absents)" },
  { route: "/v1/entreprise/{siren}/marches-publics", url: "/v1/entreprise/552032534/marches-publics", pourquoi: "requête « decp » (zéro résultat)" },
  { route: "/v1/entreprise/{siren}/alertes", url: "/v1/entreprise/552032534/alertes", pourquoi: "requête « alerts » (absents, 13 résultats)" },
  { route: "/v1/score/defaillance/{siren}", url: "/v1/score/defaillance/552032534", pourquoi: "requête « credit risk » + rafraîchir l'échantillon v1.8 de la vitrine" },
];

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `resultats/${horodatage}-bazaar-reindex-descriptions`;
mkdirSync(dossier, { recursive: true });

const avant = await solde();
console.log(`wallet ${compte.address}`);
console.log(`solde USDC avant : ${avant === null ? "?" : (Number(avant) / 1e6).toFixed(6)} $\n`);

const resultats: Array<Record<string, unknown>> = [];
for (const [i, cible] of CIBLES.entries()) {
  // L'achat du document exige l'id rendu par la liste du tour précédent.
  if (cible.route === "/v1/documents/{type}/{id}" && cible.url === null) {
    const liste = resultats[0]?.corps as { documents?: Array<{ id?: string; type?: string }> } | undefined;
    const acte = liste?.documents?.find((d) => d.type === "actes" || d.type === "acte") ?? liste?.documents?.[0];
    if (acte?.id) cible.url = `/v1/documents/actes/${acte.id}`;
  }
  if (!cible.url) {
    console.log(`✗ ${cible.route} — pas de cible servable, ignorée`);
    resultats.push({ route: cible.route, statut: "ignoree" });
    continue;
  }
  const t0 = Date.now();
  try {
    const r = await payer(`${api}${cible.url}`, { headers: { Accept: "application/json" } });
    const brut = Buffer.from(await r.arrayBuffer());
    const nom = `${String(i + 1).padStart(2, "0")}-${cible.route.replace(/[^a-z0-9]+/gi, "-")}`;
    const estJson = (r.headers.get("content-type") ?? "").includes("json");
    writeFileSync(`${dossier}/${nom}${estJson ? ".json" : ".bin"}`, brut);
    const paye = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
    console.log(`${r.ok ? "✔" : "✗"} ${r.status} ${cible.url}  (${Date.now() - t0} ms)${paye ? " · réglé" : " · NON réglé"} — ${cible.pourquoi}`);
    let corps: unknown = null;
    if (estJson) { try { corps = JSON.parse(brut.toString("utf8")); } catch { /* binaire */ } }
    resultats.push({ route: cible.route, url: cible.url, http: r.status, regle: Boolean(paye), corps });
  } catch (e) {
    console.log(`✗ ${cible.url} — ${String(e).slice(0, 140)}`);
    resultats.push({ route: cible.route, url: cible.url, erreur: String(e).slice(0, 300) });
  }
}

const apres = await solde();
const depense = avant !== null && apres !== null ? Number(avant - apres) / 1e6 : null;
console.log(`\nsolde USDC après : ${apres === null ? "?" : (Number(apres) / 1e6).toFixed(6)} $`);
console.log(`dépense RÉELLE on-chain : ${depense === null ? "?" : depense.toFixed(6)} $`);
const bilan = resultats.map(({ corps: _c, ...reste }) => reste);
writeFileSync(`${dossier}/bilan.json`, JSON.stringify({ horodatage, wallet: compte.address, depense_usdc: depense, resultats: bilan }, null, 1));
console.log(`réponses conservées : ${dossier}`);
