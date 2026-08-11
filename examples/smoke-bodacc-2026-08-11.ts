/**
 * Smoke PAYANT de `GET /v1/bodacc/recherche` (brique 2 « adaptations Pappers »).
 *
 * Trois achats à 0,03 $, choisis pour éprouver ce qu'aucune vérification
 * gratuite ne voit :
 *   1. le cas de référence du cadrage — « toutes les procédures collectives du
 *      59 cette semaine » : le devis, la forme servie, et surtout que le TEXTE
 *      LIBRE du jugement (qui nomme les mandataires avec leur adresse) n'y est
 *      PAS ;
 *   2. `famille=dpc` (dépôts des comptes, 26,1 M d'annonces) — c'est le code
 *      qui avait été INVENTÉ (`depot`) et qui rendait une liste vide payée ;
 *   3. `famille=retablissement_professionnel` — la procédure ne visant que les
 *      personnes physiques, la réponse doit être vide MAIS le compteur
 *      d'exclusions doit l'expliquer.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-bodacc-2026-08-11.ts
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
const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(cle as `0x${string}`) });
const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-bodacc-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const echecs: string[] = [];
const verifier = (ok: boolean, quoi: string): void => {
  console.log(`${ok ? "  ok  " : " ÉCHEC"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};

interface Reponse {
  annonces?: Array<Record<string, unknown>>;
  total_servi?: number;
  exclues_personnes_physiques?: number;
  exclues_type_indetermine?: number;
  tronque?: boolean;
  limite?: number;
  disclaimer?: string;
  criteres?: Record<string, string>;
}

async function acheter(nom: string, query: string): Promise<Reponse | null> {
  const url = `${api}/v1/bodacc/recherche?${query}`;
  const devis = await fetch(url);
  const entete = devis.headers.get("payment-required");
  const attendu = entete
    ? Number(JSON.parse(Buffer.from(entete, "base64").toString()).accepts?.[0]?.amount)
    : null;
  const r = await payer(url);
  const brut = await r.text();
  writeFileSync(`${dossier}/${nom}.json`, `HTTP ${r.status}\ndevis: ${attendu}\n${brut}\n`);
  console.log(`\n${nom} → HTTP ${r.status} (devis ${attendu})`);
  verifier(attendu === 30000, `${nom} : devis de 0,03 $ exactement`);
  verifier(r.status === 200, `${nom} : achat réel servi en 200`);
  return r.status === 200 ? (JSON.parse(brut) as Reponse) : null;
}

// --- 1. Le cas de référence du cadrage -----------------------------------
const a = await acheter("collective-59-semaine", "famille=collective&depuis=2026-08-04&departement=59");
if (a) {
  verifier((a.total_servi ?? 0) > 0, "des annonces sont servies");
  verifier(a.total_servi === (a.annonces ?? []).length, "`total_servi` égale le nombre réellement servi");
  verifier((a.exclues_personnes_physiques ?? -1) >= 0, "le nombre d'exclusions de personnes physiques est servi");
  // LE contrôle RGPD : aucun texte libre de jugement, donc aucun mandataire nommé.
  const brut = JSON.stringify(a);
  verifier(!brut.includes("complement"), "aucun champ de texte libre du jugement");
  verifier(!/Maître|\bMe [A-Z]/.test(brut), "aucun mandataire de justice nommé");
  verifier(!brut.includes("commercant"), "le champ `commercant` de l'amont n'est jamais recopié");
  // Et le disclaimer ne promet pas ce qui a été retiré.
  verifier(
    !/telles que publiées|as published/.test(a.disclaimer ?? ""),
    "le disclaimer ne promet PAS le texte intégral",
  );
  verifier(
    (a.disclaimer ?? "").includes("STRUCTUR") || (a.disclaimer ?? "").includes("structur"),
    "le disclaimer dit que la restitution est structurée",
  );
  console.log(`      ${a.total_servi} servies, ${a.exclues_personnes_physiques} personnes physiques exclues`);
  const p = (a.annonces ?? [])[0];
  console.log(`      ex. ${p?.date_parution} ${p?.siren ?? "(sans siren)"} ${p?.ville} | ${JSON.stringify(p?.jugement)}`);
}

// --- 2. Le code de famille qui avait été inventé -------------------------
const b = await acheter("dpc-depots-des-comptes", "famille=dpc&depuis=2026-08-10");
if (b) {
  verifier((b.total_servi ?? 0) > 0, "`dpc` rend bien des annonces (le code inventé `depot` n'en rendait aucune)");
  verifier(b.criteres?.famille === "dpc", "les critères servis sont ceux demandés");
}

// --- 3. La famille qui ne peut presque rien rendre, et qui le DIT --------
const c = await acheter("retablissement-professionnel", "famille=retablissement_professionnel&depuis=2026-01-01");
if (c) {
  const vide = (c.total_servi ?? 0) === 0;
  const explique = (c.exclues_personnes_physiques ?? 0) > 0;
  verifier(
    !vide || explique,
    "une réponse vide est EXPLIQUÉE par le compteur d'exclusions (procédure réservée aux personnes physiques)",
  );
  console.log(`      ${c.total_servi} servies, ${c.exclues_personnes_physiques} exclues (personnes physiques)`);
}

// --- 4. Ce qui ne doit PAS être vendu ------------------------------------
for (const [nom, query, attendu] of [
  ["famille inventée", "famille=depot&depuis=2026-08-10", "famille_invalide"],
  ["famille sans type de personne", "famille=divers&depuis=2026-08-10", "famille_non_servie"],
  ["propriété du prototype", "famille=constructor&depuis=2026-08-10", "famille_invalide"],
  ["département inexistant", "famille=collective&depuis=2026-08-10&departement=20", "departement_invalide"],
] as const) {
  const r = await payer(`${api}/v1/bodacc/recherche?${query}`);
  const corps = await r.text();
  writeFileSync(`${dossier}/refus-${attendu}.json`, `HTTP ${r.status}\n${corps}\n`);
  verifier(r.status === 400 && corps.includes(attendu), `${nom} → 400 ${attendu}, rien encaissé`);
}

writeFileSync(
  `${dossier}/recap.txt`,
  [
    `Smoke PAYANT /v1/bodacc/recherche — ${new Date().toISOString()}`,
    `API : ${api}`,
    `3 achats à 0,03 $ = 0,09 $ ; 4 refus non facturés`,
    `Contrôles en échec : ${echecs.length}`,
    ...echecs.map((e) => `ÉCHEC : ${e}`),
  ].join("\n"),
);
console.log(`\nRésultats conservés dans ${dossier}`);
if (echecs.length > 0) {
  console.error(`${echecs.length} contrôle(s) en échec`);
  process.exit(1);
}
console.log("Smoke payant vert.");
