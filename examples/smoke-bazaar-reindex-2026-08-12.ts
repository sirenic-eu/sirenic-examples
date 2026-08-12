/**
 * C4 — Ré-indexation Bazaar des 6 routes « valid mais jamais crawlées »
 * (campagne du 12/08/2026, coût estimé 0,24 $).
 *
 * Constat mesuré le 11/08 (sonde gratuite POST /v2/x402/validate, sans clé) :
 * 73/73 routes valides x402, 67/73 à l'index Bazaar. Les 6 absentes passent le
 * préflight 25-26/26 — le motif n'est PAS un défaut de schéma : l'entrée
 * d'index se crée au RÈGLEMENT d'un paiement sur l'URL, jamais au crawl
 * (mécanisme prouvé le 01/08 : fiche rafraîchie 1 s après le settle).
 * Un paiement par route les fait donc entrer au catalogue.
 *
 * Les 6 URLs et leur prix (relevés au /.well-known/x402 le 12/08) :
 *  - /v1/eu/entreprise/LV/40003032949/comptes            0,03 $
 *  - /v1/eu/entreprise/EE/10003666/comptes               0,02 $
 *  - /v1/eu/entreprise/DK/41235292/comptes/2025-12-31    0,05 $
 *  - /v1/eu/entreprise/SK/36417475/comptes               0,01 $
 *  - /v1/eu/entreprise/SK/36417475/comptes/2025-12-31    0,03 $
 *  - /v1/documents/actes/6a33ae8b0397b4bf6e0f5118        0,10 $
 *
 * Un échec amont (503) N'EST PAS facturé (le paiement est annulé) — la route
 * concernée ne sera alors pas indexée, on le rapporte honnêtement.
 * Après les achats, le script re-sonde /validate (gratuit) jusqu'à voir
 * apparaître index.active, avec un plafond d'attente de ~5 minutes.
 *
 * Les réponses complètes sont conservées (règle CDU) puis commitées sur le
 * dépôt privé de traces kopko13/sirenic-resultats.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-bazaar-reindex-2026-08-12.ts
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

/** Solde USDC on-chain : la dépense RÉELLE se prouve là, pas dans le récit. */
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const rpc = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const solde = async (): Promise<bigint | null> => {
  try {
    return await rpc.readContract({
      address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [compte.address],
    });
  } catch {
    return null;
  }
};

const ROUTES: Array<{ chemin: string; prix: string }> = [
  { chemin: "/v1/eu/entreprise/LV/40003032949/comptes", prix: "0.03" },
  { chemin: "/v1/eu/entreprise/EE/10003666/comptes", prix: "0.02" },
  { chemin: "/v1/eu/entreprise/DK/41235292/comptes/2025-12-31", prix: "0.05" },
  { chemin: "/v1/eu/entreprise/SK/36417475/comptes", prix: "0.01" },
  { chemin: "/v1/eu/entreprise/SK/36417475/comptes/2025-12-31", prix: "0.03" },
  { chemin: "/v1/documents/actes/6a33ae8b0397b4bf6e0f5118", prix: "0.10" },
];

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-bazaar-reindex-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const soldeAvant = await solde();
console.log(`wallet de test ${compte.address}`);
console.log(`solde USDC avant : ${soldeAvant === null ? "illisible" : `${Number(soldeAvant) / 1e6} $`}`);

type Resultat = {
  chemin: string;
  prix_annonce: string;
  statut: number;
  octets: number;
  content_type: string | null;
  cache_control: string | null;
  erreur?: string;
};
const resultats: Resultat[] = [];

for (const route of ROUTES) {
  const url = `${api}${route.chemin}`;
  process.stdout.write(`→ ${route.chemin} (${route.prix} $) … `);
  try {
    const r = await payer(url);
    const type = r.headers.get("content-type");
    const cache = r.headers.get("cache-control");
    const corps = Buffer.from(await r.arrayBuffer());
    const slug = route.chemin.replace(/^\/v1\//, "").replace(/[^a-z0-9]+/gi, "-");
    const ext = type?.includes("pdf") ? "pdf" : "json";
    writeFileSync(`${dossier}/${slug}.${ext}`, corps);
    resultats.push({
      chemin: route.chemin, prix_annonce: route.prix, statut: r.status,
      octets: corps.length, content_type: type, cache_control: cache,
    });
    console.log(`${r.status}, ${corps.length} o, cache-control=${cache ?? "ABSENT"}`);
  } catch (e) {
    resultats.push({
      chemin: route.chemin, prix_annonce: route.prix, statut: 0, octets: 0,
      content_type: null, cache_control: null, erreur: String(e).slice(0, 300),
    });
    console.log(`ÉCHEC ${String(e).slice(0, 120)}`);
  }
}

// Les règlements se minent en ~2 blocs Base.
console.log("attente 30 s (minage des règlements)…");
await new Promise((r) => setTimeout(r, 30_000));
const soldeApres = await solde();
const depense =
  soldeAvant !== null && soldeApres !== null ? Number(soldeAvant - soldeApres) / 1e6 : null;

// Re-sonde GRATUITE /validate : l'entrée d'index apparaît-elle ?
const VALIDATE = "https://api.cdp.coinbase.com/platform/v2/x402/validate";
const sonderIndex = async (chemin: string): Promise<string> => {
  try {
    const r = await fetch(VALIDATE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource: `${api}${chemin}` }),
    });
    const corps = (await r.json()) as { valid?: boolean; index?: { active?: boolean } };
    if (corps.index?.active) return "INDEXÉE";
    return corps.index ? "index inactif" : "index absent";
  } catch (e) {
    return `sonde en échec: ${String(e).slice(0, 80)}`;
  }
};

const index: Record<string, string> = {};
for (let tour = 1; tour <= 5; tour++) {
  let restantes = 0;
  for (const route of ROUTES) {
    if (index[route.chemin] === "INDEXÉE") continue;
    index[route.chemin] = await sonderIndex(route.chemin);
    if (index[route.chemin] !== "INDEXÉE") restantes++;
  }
  console.log(`sonde /validate tour ${tour} : ${ROUTES.length - restantes}/${ROUTES.length} indexées`);
  if (restantes === 0) break;
  if (tour < 5) await new Promise((r) => setTimeout(r, 60_000));
}

const recap = {
  campagne: "smoke-bazaar-reindex (C4, analyse chantiers x402 du 11/08)",
  date: new Date().toISOString(),
  wallet: compte.address,
  solde_avant: soldeAvant === null ? null : Number(soldeAvant) / 1e6,
  solde_apres: soldeApres === null ? null : Number(soldeApres) / 1e6,
  depense_reelle_usd: depense,
  cout_estime_usd: 0.24,
  achats: resultats,
  indexation_bazaar: index,
};
writeFileSync(`${dossier}/recap.json`, JSON.stringify(recap, null, 2));

const lignes = resultats
  .map((r) => `| ${r.chemin} | ${r.prix_annonce} $ | ${r.statut || "ÉCHEC"} | ${r.octets} o | ${index[r.chemin] ?? "?"} |`)
  .join("\n");
writeFileSync(
  `${dossier}/RECAP.md`,
  `# Smoke C4 — ré-indexation Bazaar (${new Date().toISOString().slice(0, 10)})

But : faire entrer à l'index Bazaar les 6 routes « valid mais jamais crawlées »
(constat sonde du 11/08 : 67/73 indexées). Mécanisme : l'entrée d'index se crée
au règlement.

Wallet ${compte.address} — solde ${recap.solde_avant} → ${recap.solde_apres} $ (dépense réelle ${depense ?? "?"} $, estimé 0,24 $).

| Route | Prix | HTTP | Taille | Index Bazaar |
|---|---|---|---|---|
${lignes}

L'indexation peut prendre plus que les ~5 min sondées : re-vérifier à la veille
du lundi avec la même sonde /validate (gratuite) si des lignes restent « index absent ».
`,
);
console.log(`\nRécap : ${dossier}/RECAP.md`);
console.log(`Dépense réelle : ${depense ?? "illisible"} $ (estimé 0,24 $)`);
