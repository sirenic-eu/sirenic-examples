/**
 * Smoke PAYANT — les entrées d'agent sont-elles VRAIMENT servies en prod ?
 * (chantier « client perdu du 26/08 », déployé le 30/08/2026)
 *
 * Le 26/08, le 11ᵉ payeur externe a acheté une fois puis s'est perdu sur SIX
 * 400 après devis : 8 entrées d'agent réalistes sur 23 tombaient sur le jeu de
 * caractères. La suite de tests prouve que le code nettoie ; seul un ACHAT
 * prouve que la PROD sert. Chaque épreuve rejoue une entrée du dossier.
 *
 *   1. **Guillemets** `?q="Danone"` — 0,002 $. LE cas du client perdu (2ᵉ des
 *      23). Attendu : 200 RÉGLÉ, DANONE dans les résultats. Avant : 400.
 *   2. **Identifiant escorté et espacé** `?q=SIREN : 552 032 534` — 0,002 $.
 *      Attendu : 200 RÉGLÉ, DANONE en résolution DIRECTE (un seul résultat) —
 *      là où c'était une recherche de dénomination au résultat vide garanti.
 *   3. **Montant collé d'un tableur** `?q=552 032 534 €` — 0,002 $. Épreuve
 *      DISCRIMINANTE, en négatif : le symbole monétaire doit INTERDIRE la
 *      résolution (sinon on facture la fiche Danone pour un chiffre d'affaires).
 *      Attendu : 200 RÉGLÉ, et surtout PAS la fiche Danone en direct.
 *   4. **Rien de cherchable** `?q=***` — 0,002 $ SIGNÉ mais JAMAIS DÉBITÉ.
 *      Attendu : 400, aucun en-tête de règlement, corps portant `champ: "q"`
 *      (le verdict que le back-office enregistre désormais).
 *   5. **Europe, plancher de 2** `/v1/eu/recherche?q=e` — 0,003 $ signé, JAMAIS
 *      débité : le pré-refus doit tomber AVANT le handler (400 payé sinon).
 *   6. **HEAD sur une route payante** — attendu permanent : 405, jamais une
 *      exécution gratuite du handler.
 *
 * Coût réel attendu ≈ 0,006 $ (3 appels servis ; les 400 ne sont pas débités).
 * Wallet de test 0x9218fd5A… — exclu du revenu réel.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-entrees-clementes-2026-08-30.ts
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
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-entrees-clementes-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const echecs: string[] = [];
const verifier = (ok: boolean, quoi: string): void => {
  console.log(`${ok ? "  ok  " : " ÉCHEC"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};

async function acheter(nom: string, url: string) {
  const r = await payer(url);
  const brut = await r.text();
  writeFileSync(`${dossier}/${nom}.json`, `HTTP ${r.status}\n${url}\n${brut}\n`);
  const regle = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  writeFileSync(`${dossier}/${nom}-reglement.txt`, String(regle ?? "(aucun en-tête de règlement)"));
  let corps: Record<string, unknown> = {};
  try {
    corps = JSON.parse(brut) as Record<string, unknown>;
  } catch {
    /* corps non JSON : les assertions échoueront d'elles-mêmes */
  }
  console.log(`\n— ${nom} → HTTP ${r.status}${regle ? " (réglé)" : ""}`);
  return { statut: r.status, brut, corps, regle };
}

const noms = (c: Record<string, unknown>): string[] =>
  ((c.resultats as Array<Record<string, unknown>> | undefined) ?? []).map((x) =>
    String(x.denomination ?? ""),
  );

// --- 1. LE cas du client perdu : des guillemets autour du nom ---------------
const g = await acheter("1-guillemets", `${api}/v1/recherche?q=${encodeURIComponent('"Danone"')}`);
verifier(g.statut === 200, `guillemets : 200 (lu ${g.statut})`);
verifier(g.regle !== null, "guillemets : paiement RÉGLÉ (la requête a été SERVIE)");
verifier(
  noms(g.corps).some((n) => n.toUpperCase().includes("DANONE")),
  `guillemets : DANONE dans les résultats (lu ${JSON.stringify(noms(g.corps).slice(0, 3))})`,
);

// --- 2. Identifiant escorté ET espacé : résolution DIRECTE ------------------
const e = await acheter(
  "2-siren-escorte-espace",
  `${api}/v1/recherche?q=${encodeURIComponent("SIREN : 552 032 534")}`,
);
verifier(e.statut === 200, `SIREN escorté : 200 (lu ${e.statut})`);
verifier(e.regle !== null, "SIREN escorté : paiement RÉGLÉ");
verifier(
  noms(e.corps).some((n) => n.toUpperCase().includes("DANONE")),
  `SIREN escorté : DANONE servi (lu ${JSON.stringify(noms(e.corps).slice(0, 3))})`,
);
verifier(
  Number(e.corps.nombre_resultats ?? noms(e.corps).length) === 1,
  `SIREN escorté : résolution DIRECTE, un seul résultat (lu ${String(e.corps.nombre_resultats)})`,
);

// --- 3. En NÉGATIF : un montant ne doit JAMAIS résoudre une fiche -----------
const m = await acheter(
  "3-montant-euro-negatif",
  `${api}/v1/recherche?q=${encodeURIComponent("552 032 534 €")}`,
);
verifier(m.statut === 200, `montant € : 200 (lu ${m.statut})`);
verifier(
  !(Number(m.corps.nombre_resultats ?? 99) === 1 && noms(m.corps)[0]?.toUpperCase().includes("DANONE")),
  `montant € : PAS de résolution directe vers DANONE (lu ${String(m.corps.nombre_resultats)} résultat(s) : ${JSON.stringify(noms(m.corps).slice(0, 2))})`,
);

// --- 4. Rien de cherchable : 400 SIGNÉ mais JAMAIS débité, avec verdict -----
const v = await acheter("4-rien-de-cherchable", `${api}/v1/recherche?q=${encodeURIComponent("***")}`);
verifier(v.statut === 400, `rien de cherchable : 400 (lu ${v.statut})`);
verifier(v.regle === null, "rien de cherchable : AUCUN règlement (un 400 n'est jamais facturé)");
verifier(v.corps.error === "parametre_invalide", `corps : error=parametre_invalide (lu ${String(v.corps.error)})`);
verifier(v.corps.champ === "q", `corps : champ=q — le VERDICT que le back-office enregistre (lu ${String(v.corps.champ)})`);

// --- 5. Europe : le plancher de 2 tombe AVANT le handler payé --------------
const p = await acheter("5-eu-plancher-2", `${api}/v1/eu/recherche?q=e`);
verifier(p.statut === 400, `plancher EU : 400 (lu ${p.statut})`);
verifier(p.regle === null, "plancher EU : AUCUN règlement");
verifier(p.corps.champ === "q", `plancher EU : champ=q (lu ${String(p.corps.champ)})`);

// --- 6. Attendu permanent : HEAD ne fait jamais tourner le handler ----------
const h = await fetch(`${api}/v1/recherche?q=danone`, { method: "HEAD" });
writeFileSync(`${dossier}/6-head.txt`, `HTTP ${h.status}\nAllow: ${h.headers.get("allow") ?? "(absent)"}\n`);
verifier(h.status === 405, `HEAD : 405 (lu ${h.status})`);
verifier((h.headers.get("allow") ?? "").includes("GET"), "HEAD : en-tête Allow présent");

// --- Récapitulatif ---------------------------------------------------------
const recap = {
  campagne: "entrees-clementes",
  quand: new Date().toISOString(),
  api,
  epreuves: 6,
  assertions_echouees: echecs,
  note: "Les épreuves 4 et 5 sont SIGNÉES mais non débitées : un 400 n'est jamais facturé.",
};
writeFileSync(`${dossier}/recap.json`, JSON.stringify(recap, null, 2));
console.log(`\n=== ${echecs.length === 0 ? "TOUT VERT" : `${echecs.length} ÉCHEC(S)`} — traces : ${dossier}`);
if (echecs.length > 0) {
  for (const e2 of echecs) console.log(`  - ${e2}`);
  process.exit(1);
}
