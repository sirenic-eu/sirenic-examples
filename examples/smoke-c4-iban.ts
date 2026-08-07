/**
 * Smoke PAYANT ciblé sur les deux routes requalifiées par C4 (~0,065 $).
 *
 * Pourquoi il existe : les exemples publiés de ces deux routes avaient été
 * RECOMPOSÉS localement, alors que la règle maison est « pas d'achat réel, pas
 * d'exemple » — et la note servie à côté d'eux annonce « extrait RÉEL d'une
 * réponse payée ». Ce smoke achète les vraies réponses pour que cette note
 * redevienne vraie, et vérifie au passage que C4 sert bien ce qu'il annonce.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-c4-iban.ts
 *
 * Les réponses sont conservées telles quelles : elles alimentent ensuite
 * src/contrats/exemples.ts (troncature à un élément par tableau) et le miroir
 * examples/responses/ de cette vitrine.
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

const DANONE = "552032534";
// IBAN d'exemple de La Banque Postale, publié dans les documentations : c'est
// LUI qui doit porter le drapeau, et c'est tout l'intérêt pédagogique.
const IBAN_DOC = "FR1420041010050500013M02606";

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `resultats/c4-iban-${horodatage}`;
mkdirSync(dossier, { recursive: true });

type Obs = { controle: string; observe: string; ok: boolean };
const obs: Obs[] = [];
const noter = (controle: string, observe: string, ok: boolean) => {
  obs.push({ controle, observe, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${controle} — ${observe}`);
};

const achats = [
  { nom: "iban-verifier", chemin: `/v1/iban/verifier/${IBAN_DOC}`, prix: 0.005 },
  { nom: "facturation-dossier", chemin: `/v1/facturation/dossier?siren=${DANONE}&iban=${IBAN_DOC}`, prix: 0.03 },
  { nom: "eu-facturation-dossier-pl", chemin: `/v1/eu/facturation/dossier?pays=PL&id=7342867148`, prix: 0.03 },
];
const corps: Record<string, Record<string, unknown>> = {};
console.log(`Payeur : ${compte.address}\n=== Achats réels ===`);
for (const a of achats) {
  const debut = Date.now();
  try {
    const r = await payer(`${api}${a.chemin}`);
    const texte = await r.text();
    writeFileSync(`${dossier}/${a.nom}.json`, `${texte}\n`);
    corps[a.nom] = JSON.parse(texte) as Record<string, unknown>;
    const recu = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
    console.log(`  ${a.nom} → HTTP ${r.status} en ${Date.now() - debut} ms (règlement ${recu ? "reçu" : "ABSENT"})`);
  } catch (e) {
    console.log(`  ${a.nom} → EXCEPTION ${String(e).slice(0, 140)}`);
  }
}

console.log("\n=== Ce que C4 doit servir ===");
const iban = corps["iban-verifier"] ?? {};
noter("nature_du_controle", String(iban.nature_du_controle), typeof iban.nature_du_controle === "string");
noter(
  "non_verifie au premier niveau",
  JSON.stringify(iban.non_verifie),
  Array.isArray(iban.non_verifie) && iban.non_verifie.length === 2,
);
noter("IBAN de documentation signalé", String(iban.exemple_de_documentation), iban.exemple_de_documentation === true);
noter("verification_titulaire inchangé", String(iban.verification_titulaire), iban.verification_titulaire === "non_disponible");

const dossierFr = corps["facturation-dossier"] ?? {};
const verdict = (dossierFr.verdict ?? {}) as Record<string, unknown>;
noter("verdict.pret_a_facturer", String(verdict.pret_a_facturer), verdict.pret_a_facturer !== undefined);
noter(
  "verdict.non_verifie à côté du vert",
  JSON.stringify(verdict.non_verifie),
  Array.isArray(verdict.non_verifie) && verdict.non_verifie.length === 2,
);
const raisons = (verdict.raisons ?? []) as Array<Record<string, unknown>>;
noter(
  "raison informative sur l'IBAN d'exemple",
  raisons.map((r) => String(r.code)).join(",") || "(aucune)",
  raisons.some((r) => String(r.code) === "iban_exemple_documentation"),
);

// LA garde du chantier : plus AUCUNE affirmation d'inexistence de compte.
// ⚠️ Le motif doit viser le COMPTE, pas n'importe quelle négation voisine du
//  mot « compte ». Première version trop large : elle criait au loup sur le
//  disclaimer polonais « no account ↔ NIP link is attested », qui dit
//  l'absence d'un LIEN ATTESTÉ — exactement la formulation juste. On exclut
//  donc explicitement les tournures « lien/link » avant de conclure.
const AFFIRMATIONS = /(?:aucun compte|no account|compte inexistant)(?![^.]*(?:↔|lien|link))|(?:le compte|the account)[^.]{0,40}(?:n'existe pas|does not exist)/i;
for (const [nom, c] of Object.entries(corps)) {
  const texte = JSON.stringify(c);
  noter(`${nom} : aucune affirmation d'inexistence de compte`, AFFIRMATIONS.test(texte) ? "PRÉSENTE" : "absente", !AFFIRMATIONS.test(texte));
}

const pl = corps["eu-facturation-dossier-pl"] ?? {};
const dispPl = String(pl.disclaimer ?? "");
noter(
  "disclaimer PL dit l'état RÉEL du wykaz",
  dispPl.includes("Ici le wykaz a répondu") ? "confirmé/refusé (le registre a répondu)" : dispPl.includes("n'a PAS conclu") ? "non conclu" : "?",
  dispPl.includes("wykaz"),
);

writeFileSync(`${dossier}/RECAP.json`, `${JSON.stringify({ horodatage, payeur: compte.address, observations: obs }, null, 2)}\n`);
const ko = obs.filter((o) => !o.ok);
console.log(`\nRéponses payées conservées : ${dossier}/`);
console.log(`Bilan : ${obs.length - ko.length}/${obs.length} conformes.`);
if (ko.length) console.log(`Écarts : ${ko.map((o) => o.controle).join(" ; ")}`);
