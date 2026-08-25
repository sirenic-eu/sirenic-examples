/**
 * Smoke PAYANT de /v1/entreprise/{siren}/emploi — signaux de recrutement
 * (chantier emploi P2, déployé le 25/08/2026, dca8f1e).
 *
 * DEUX ÉPREUVES, choisies pour couvrir les deux régimes de la méthode :
 *
 *   1. **TEREGA (095580841)** — 0,02 $ : le SIREN d'exemple du contrat Bazaar.
 *      Cas nominal provincial (≤ 5 communes autour de Pau, dénomination
 *      distinctive). Épreuve de LIVRAISON : le bloc signaux_recrutement
 *      complet, la méthode dite, le tri-état cohérent.
 *   2. **DECATHLON FRANCE (306138900)** — 0,02 $ : gros recruteur multi-sites
 *      → repli départements (top 5, couverture partielle DITE) + clés
 *      enseignes. Épreuve des avertissements de couverture.
 *
 * INVARIANT FORT du tri-état (revue du 24/08) : la Synthèse Pages employeurs
 * n'est PAS souscrite sur ce compte au moment du smoke → comptage =
 * correspondance_denomination → recrute_activement ne peut JAMAIS valoir
 * false (le repli n'affirme pas l'absence). Un false ici = bug.
 *
 * Total ≈ 0,04 $ (wallet de test 0x9218fd5A…, exclu du revenu réel).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-emploi-2026-08-25.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, erc20Abi, http } from "viem";
import { base } from "viem/chains";
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

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const rpc = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const solde = async (): Promise<bigint | null> => {
  try {
    return await rpc.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [compte.address] });
  } catch {
    return null; // RPC public indisponible : on dégrade, le ledger serveur reste vérifiable
  }
};

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-emploi-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const echecs: string[] = [];
const verifier = (ok: boolean, quoi: string): void => {
  console.log(`${ok ? "  ok  " : " ÉCHEC"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};

async function acheter(nom: string, siren: string): Promise<{ statut: number; corps: Record<string, unknown>; regle: boolean }> {
  const r = await payer(`${api}/v1/entreprise/${siren}/emploi`);
  const brut = await r.text();
  writeFileSync(`${dossier}/${nom}.json`, `HTTP ${r.status}\n${brut}\n`);
  const regle = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  writeFileSync(`${dossier}/${nom}-reglement.txt`, String(regle ?? "(aucun en-tête de règlement)"));
  let corps: Record<string, unknown> = {};
  try {
    corps = JSON.parse(brut) as Record<string, unknown>;
  } catch {
    /* corps non JSON : les assertions échoueront d'elles-mêmes */
  }
  console.log(`\n— ${nom} (${siren}) → HTTP ${r.status}`);
  return { statut: r.status, corps, regle: regle !== null };
}

/** Une sonde payante ASSERTE LA LIVRAISON, pas le statut : le bloc entier. */
function verifierLivraison(nom: string, corps: Record<string, unknown>): void {
  const s = (corps.signaux_recrutement ?? {}) as Record<string, unknown>;
  const methode = (s.methode ?? {}) as Record<string, unknown>;
  verifier(typeof s.recrute_activement === "boolean" || s.recrute_activement === null, `${nom} : tri-état présent (lu ${String(s.recrute_activement)})`);
  // SPE non souscrite au moment du smoke : false serait un bug du tri-état durci.
  verifier(s.recrute_activement !== false, `${nom} : jamais false en repli dénomination`);
  verifier(methode.comptage === "correspondance_denomination", `${nom} : comptage = correspondance_denomination (SPE non souscrite ; lu ${String(methode.comptage)})`);
  verifier(typeof s.annonces_actives === "number", `${nom} : annonces_actives numérique (lu ${String(s.annonces_actives)})`);
  const coherent = (s.annonces_actives as number) > 0 ? s.recrute_activement === true : s.recrute_activement === null;
  verifier(coherent, `${nom} : cohérence annonces (${String(s.annonces_actives)}) ↔ tri-état (${String(s.recrute_activement)})`);
  verifier(Array.isArray(s.familles_rome), `${nom} : familles_rome liste`);
  verifier(typeof s.consulte_le === "string" && !Number.isNaN(Date.parse(s.consulte_le as string)), `${nom} : consulte_le ISO (${String(s.consulte_le)})`);
  verifier(Array.isArray(corps.index_egapro), `${nom} : index_egapro liste`);
  verifier(Array.isArray(corps.avertissements), `${nom} : avertissements[] présent`);
  verifier(String(corps.source).includes("France Travail"), `${nom} : attribution France Travail`);
  verifier(String(corps.licence_france_travail).includes("francetravail.io"), `${nom} : lien licence servi (art. 4)`);
  const brut = JSON.stringify(corps);
  verifier(!brut.includes("courriel") && !brut.includes("telephone") && !brut.includes("urlPostulation"), `${nom} : aucun champ de contact d'offre dans la réponse`);
}

const avant = await solde();
console.log(`solde USDC avant : ${avant === null ? "n/a (RPC muet)" : avant.toString()} (adresse ${compte.address})`);

const terega = await acheter("terega", "095580841");
verifier(terega.statut === 200, `TEREGA : 200 (lu ${terega.statut})`);
verifier(terega.regle, "TEREGA : en-tête de règlement présent");
verifierLivraison("TEREGA", terega.corps);

const decathlon = await acheter("decathlon-france", "306138900");
verifier(decathlon.statut === 200, `DECATHLON : 200 (lu ${decathlon.statut})`);
verifier(decathlon.regle, "DECATHLON : en-tête de règlement présent");
verifierLivraison("DECATHLON", decathlon.corps);
const methodeDec = ((decathlon.corps.signaux_recrutement ?? {}) as Record<string, unknown>).methode as Record<string, unknown> | undefined;
console.log(`  zones DECATHLON : ${JSON.stringify(methodeDec?.zones ?? null)}`);

// Les règlements se minent en ~2 blocs Base.
await new Promise((r) => setTimeout(r, 30_000));
const apres = await solde();
console.log(`solde USDC après : ${apres === null ? "n/a" : apres.toString()}`);
const depense = avant !== null && apres !== null ? Number(avant - apres) / 1e6 : null;
if (depense !== null) verifier(Math.abs(depense - 0.04) < 0.005, `dépense réelle ≈ 0,04 $ (lu ${depense})`);

writeFileSync(
  `${dossier}/recap.json`,
  JSON.stringify(
    { campagne: "smoke-emploi", date: horodatage, adresse: compte.address, solde_avant: avant?.toString() ?? null, solde_apres: apres?.toString() ?? null, depense_usdc: depense, echecs },
    null,
    2,
  ),
);
writeFileSync(
  `${dossier}/RECAP.md`,
  `# Smoke emploi ${horodatage}\n\n2 achats /v1/entreprise/{siren}/emploi à 0,02 $ (TEREGA, DECATHLON FRANCE).\nSPE non souscrite → comptage correspondance_denomination attendu, false interdit.\nDépense : ${depense ?? "n/a"} $.\n\n${echecs.length === 0 ? "TOUT VERT" : `ÉCHECS :\n${echecs.map((e) => `- ${e}`).join("\n")}`}\n`,
);
console.log(`\n${"=".repeat(70)}`);
console.log(echecs.length === 0 ? "SMOKE VERT" : `SMOKE ROUGE — ${echecs.length} échec(s)`);
for (const e of echecs) console.log(`  - ${e}`);
console.log(`résultats : ${dossier}`);
process.exit(echecs.length === 0 ? 0 : 1);
