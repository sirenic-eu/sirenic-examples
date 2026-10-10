/**
 * Paye UN endpoint Sirenic précis avec le wallet de test — vérification
 * ciblée post-correctif (ex. /comptes-pdf après le fix grands déposants).
 *
 *   node --env-file=.env.wallet-test --import tsx scripts/payer-un-endpoint.ts /v1/entreprise/552032534/comptes-pdf 2.00
 *
 * Même appel par une clé d'API (contrôle du CONTENU, débité en crédits, aucun règlement on-chain ;
 * la clé l'emporte si les deux sont posées, règle du 24/09/2026, ticket 166 de kopko13/sirenic) :
 *
 *   SIRENIC_API_KEY=… npx tsx scripts/payer-un-endpoint.ts /v1/entreprise/552032534 0.05
 *
 * Argument 1 : chemin ; argument 2 : prix MAXIMAL accepté en USD (garde-fou : refus du devis en x402 ;
 * sous la clé, aucun devis, le débit lu dans x-credits-charged est comparé après coup, code 1 au delà).
 * Un statut non-200 est rapporté tel quel (402/503/500) — jamais facturé.
 * Sous la clé, un 402 est un échec (code 1), jamais un paiement. SIRENIC_URL change l'hôte (défaut
 * https://api.sirenic.eu).
 */
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { choisirRail, creditsDebites, ENTETE_CREDITS, fetchAvecRail, ligneRail } from "../examples/rail.js";

const chemin = process.argv[2];
const maxUsd = Number(process.argv[3] ?? "0");
const apiUrl = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const choix = choisirRail();
if (!chemin || !maxUsd || "erreur" in choix) {
  console.error("usage: SIRENIC_API_KEY=… ou TEST_WALLET_KEY=… payer-un-endpoint.ts <chemin> <prix max USD>");
  process.exit(2);
}
const rail = choix;
console.log(ligneRail(rail));

const fetchRail = fetchAvecRail(rail);
let paidFetch: typeof fetch = fetchRail;
if (rail.type === "x402") {
  const account = privateKeyToAccount(rail.cleWallet);
  const client = new x402Client((_v, reqs) => {
    const usdc = reqs.find((r) => r.asset.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    if (!usdc) throw new Error("pas d'option USDC dans le devis");
    const montant = Number(usdc.amount) / 1e6;
    if (montant > maxUsd) throw new Error(`devis ${montant} $ > plafond ${maxUsd} $ — refus`);
    return usdc;
  });
  registerExactEvmScheme(client, { signer: account });
  // Les en-têtes du rail sous l'enveloppe de paiement : le second envoi, payé, les porte aussi.
  paidFetch = wrapFetchWithPayment(fetchRail, client);
}

const debut = Date.now();
const r = await paidFetch(`${apiUrl}${chemin}`, { signal: AbortSignal.timeout(240_000) });
const ms = Date.now() - debut;
// Sous la clé : un 402 est un échec rapporté (jamais un paiement) ; le débit se lit après coup.
let codeSortie = 0;
if (rail.type === "cle") {
  if (r.status === 402) {
    console.log(`HTTP 402 en ${ms} ms : échec sous la clé (crédits ou accès), aucun paiement tenté`);
    process.exit(1);
  }
  const debit = creditsDebites(r);
  console.log(`${ENTETE_CREDITS}: ${debit === null ? "absent" : debit.toFixed(3)}`);
  if (debit !== null && debit > maxUsd) {
    console.log(`débit ${debit.toFixed(3)} $ > plafond ${maxUsd} $ : à rapporter`);
    codeSortie = 1;
  }
}
// Un PDF se sauvegarde (3e argument = chemin de sortie), le JSON s'affiche.
const sortie = process.argv[4];
if (sortie && (r.headers.get("content-type") ?? "").includes("pdf")) {
  const octets = Buffer.from(await r.arrayBuffer());
  await import("node:fs/promises").then((fs) => fs.writeFile(sortie, octets));
  console.log(`HTTP ${r.status} en ${ms} ms — PDF ${(octets.length / 1024).toFixed(0)} Ko écrit dans ${sortie}`);
  process.exit(codeSortie);
}
const corps = await r.text();
console.log(`HTTP ${r.status} en ${ms} ms`);
try {
  const j = JSON.parse(corps) as Record<string, unknown>;
  const resume = {
    depuis_cache: j.depuis_cache,
    couverture: (j.annexe as Record<string, unknown> | undefined)?.couverture,
    error: j.error,
    message: typeof j.message === "string" ? (j.message as string).slice(0, 160) : undefined,
    cles: Object.keys(j).slice(0, 10),
  };
  console.log(JSON.stringify(resume, null, 1));
} catch {
  console.log(corps.slice(0, 300));
}
process.exit(codeSortie);
