/**
 * RÉINDEXATION AVANT EXPIRATION — les 8 routes dont le compteur de 30 jours
 * arrive à échéance avant le 13/09/2026.
 *
 * Pourquoi (mesuré le 23/08/2026) : « Resources that go 30 days without a
 * settlement are removed from both the catalog and search results » (doc CDP
 * `x402/seller/get-discovered`). Le compteur est PAR RESSOURCE — `lastCalledAt`
 * dans le catalogue —, pas par service : la première ressource à tomber est
 * `/v1/eu/entreprise/{pays}/{id}`, dernier règlement le 03/08, donc retirée
 * vers le 02/09. Aucun règlement n'est arrivé depuis le 21/08, et la dernière
 * vente externe date du 16/08.
 *
 * Second effet, voulu : la fiche du catalogue n'est rafraîchie QU'AU PAIEMENT
 * (`lastUpdated` suit `lastCalledAt` à la seconde). Ce balayage est donc aussi
 * ce qui fait remonter la nouvelle `iconUrl` sur ces 8 fiches. À lancer APRÈS
 * le déploiement de l'icône, jamais avant — sinon il dépense pour publier
 * l'ancienne métadonnée.
 *
 * Ce que ce script ne répare PAS : l'exemple `%7Bsiren%7D` des paramètres de
 * chemin. Mesuré le même jour sur 6 règlements du 21/08 portant
 * `{"siren":"552032534"}` : la fiche a bien été rafraîchie, `queryParams` a
 * gardé notre valeur, `pathParams` est resté le gabarit encodé. C'est un défaut
 * amont — voir docs/TICKET-CDP-PATHPARAMS-2026-08-23.md du dépôt code.
 *
 * Cibles : `cibles-reindex-2026-08-23.json`, généré depuis la SOURCE DE VÉRITÉ
 * du dépôt code (CONTRATS + grille + `exempleConcret`), pas recopié à la main.
 * Dépense attendue : 0,17 $ (8 appels). Exécution SÉRIELLE (nonce du wallet).
 *
 *   cd /home/ubuntu/sirenic-examples
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-reindex-avant-expiration-2026-08-23.ts
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
    return await rpc.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [compte.address],
    });
  } catch {
    return null;
  }
};

interface Cible {
  endpoint: string;
  prix: string;
  mime: string;
  url: string;
  expire_le: string;
}
const cibles: Cible[] = JSON.parse(
  readFileSync(new URL("./cibles-reindex-2026-08-23.json", import.meta.url), "utf8"),
);

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `resultats/${horodatage}-reindex-avant-expiration`;
mkdirSync(dossier, { recursive: true });

const avant = await solde();
console.log(
  `wallet ${compte.address} — solde avant : ${avant === null ? "?" : (Number(avant) / 1e6).toFixed(6)} $`,
);
console.log(`${cibles.length} routes à réindexer, en série\n`);

const verdicts: Array<Record<string, unknown>> = [];

for (const [i, cible] of cibles.entries()) {
  const t0 = Date.now();
  try {
    const r = await payer(`${api}${cible.url}`, {
      headers: { Accept: `${cible.mime}, application/json` },
      signal: AbortSignal.timeout(180_000),
    });
    const brut = Buffer.from(await r.arrayBuffer());
    const ms = Date.now() - t0;
    // Un 503 non facturé ne réarme RIEN : sans règlement, le compteur de 30
    // jours ne bouge pas et la ressource sortira quand même du catalogue. Le
    // verdict le dit, pour ne pas lire « rien à signaler » là où il reste une
    // ressource à sauver.
    const regle = Boolean(r.headers.get("payment-response") ?? r.headers.get("x-payment-response"));
    const nom = `${String(i + 1).padStart(2, "0")}-${cible.endpoint.replace(/[^a-z0-9]+/gi, "-")}`;
    writeFileSync(`${dossier}/${nom}.json`, brut);
    const verdict = r.ok && regle ? "RÉINDEXÉE" : "NON RÉARMÉE";
    verdicts.push({
      endpoint: cible.endpoint,
      expire_le: cible.expire_le,
      prix: cible.prix,
      http: r.status,
      regle,
      ms,
      octets: brut.length,
      verdict,
    });
    console.log(
      `${verdict === "RÉINDEXÉE" ? "✔" : "✗"} ${String(r.status)} ${cible.endpoint} (${ms} ms, ${cible.prix}${regle ? " réglé" : " NON facturé"}) — expirait le ${cible.expire_le}`,
    );
  } catch (e) {
    verdicts.push({
      endpoint: cible.endpoint,
      expire_le: cible.expire_le,
      prix: cible.prix,
      erreur: String(e).slice(0, 200),
      verdict: "NON RÉARMÉE",
    });
    console.log(`✗ ${cible.endpoint} — ${String(e).slice(0, 120)}`);
  }
}

/** Solde lu APRÈS stabilisation on-chain.
 *
 * ⚠️ Défaut mesuré sur le premier passage de ce script (23/08/2026, 18:15) : le
 * solde lu immédiatement après la dernière réponse donnait 0,13 $ de dépense
 * alors que les 8 règlements en valaient 0,17 $ — deux transferts n'étaient pas
 * encore confirmés. Un bilan qui SOUS-ESTIME la dépense est pire qu'un bilan
 * absent : il devient la référence. On attend donc deux lectures identiques,
 * espacées de 10 s, et on compare au total attendu depuis les prix des cibles.
 * (Le balayage complet du 16/08 lit son solde de la même façon : son « ≈ 4,2 $ »
 * est probablement sous-estimé pour la même raison.) */
async function soldeStabilise(): Promise<bigint | null> {
  let precedent = await solde();
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const courant = await solde();
    if (courant !== null && courant === precedent) return courant;
    precedent = courant;
  }
  return precedent;
}

const apres = await soldeStabilise();
const depense = avant !== null && apres !== null ? Number(avant - apres) / 1e6 : null;
const attendu = cibles.reduce((s, c) => s + Number(c.prix.replace("$", "")), 0);
const reindexees = verdicts.filter((v) => v.verdict === "RÉINDEXÉE").length;
console.log(
  `\n══ BILAN : ${reindexees}/${cibles.length} réindexées — dépense on-chain ${depense === null ? "?" : depense.toFixed(6)} $ (attendu ${attendu.toFixed(2)} $) ══`,
);
if (depense !== null && Math.abs(depense - attendu) > 0.0005) {
  console.log(
    `⚠️ écart de ${(attendu - depense).toFixed(6)} $ entre la dépense lue et le total des prix : re-lire le solde plus tard, ou vérifier le ledger.`,
  );
}
if (reindexees < cibles.length) {
  console.log(
    "⚠️ les routes NON RÉARMÉES seront bien retirées du catalogue à leur échéance : rien n'a été réglé pour elles.",
  );
}
writeFileSync(
  `${dossier}/bilan.json`,
  JSON.stringify(
    { horodatage, wallet: compte.address, depense_usdc: depense, depense_attendue_usdc: attendu, reindexees, verdicts },
    null,
    1,
  ),
);
console.log(`réponses conservées : ${dossier}`);
process.exit(reindexees === cibles.length ? 0 : 1);
