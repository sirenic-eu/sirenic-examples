/**
 * CONTRÔLE PAYÉ du lot « associations loi 1901 » (étape 0 du 06/09/2026, GO CDU
 * « fait un lot global avec T0+T1+T2 », livré sur main le 06/09 — 8174ef4).
 *
 *  Gratuit : l'OpenAPI publie les trois routes ; le dictionnaire de provenance
 *            porte rna_interieur et joafe_dila ; HEAD sur une route → 405.
 *  Payé (≈ 0,017 $) :
 *   - /association/W751004076 (0,005 $) CROIX ROUGE FRANCAISE : waldec, active,
 *     nature R (reconnue d'utilité publique), RUP 75.000.0001, provenance rna_interieur ;
 *     le SIREN reste null jusqu'à l'ingestion Sirene du 2 octobre (colonne
 *     identifiant_association encore vide) — dit, pas caché ;
 *   - /associations/recherche?q=croix rouge&code_postal=75 (0,002 $) : W751004076 en tête ;
 *   - /association/W011006690/annonces (0,01 $) MEXIMIEUX EN MOUVEMENT : la création
 *     202600350001 de la parution 2026-0035, couverture 2020 → 2026-09-01 ;
 *   - /association/W999999999 : 404, paiement annulé (rien de débité — coût 0).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-associations-2026-09-06.ts 8174ef4 --je-confirme-depense
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const api = "https://api.sirenic.eu";
const attendu = process.argv[2];
const confirme = process.argv.includes("--je-confirme-depense");
const sante: any = await (await fetch(`${api}/healthz`)).json();
console.log(`prod sert ${sante.commit} (uptime ${sante.uptime_s}s) — attendu ${attendu ?? "(non précisé)"}`);
if (attendu && sante.commit !== attendu) { console.log("⛔ pas encore le bon commit, on ne dépense rien"); process.exit(1); }
let ko = 0;
const lignesRecap: string[] = [];
const ok = (c: boolean, lib: string, d = "") => {
  const ligne = `${c ? "✅" : "❌"} ${lib}${d ? " — " + d : ""}`;
  console.log(ligne); lignesRecap.push(ligne); if (!c) ko++;
};

// ── gratuit ──
{
  const o: any = await (await fetch(`${api}/openapi.json`)).json();
  for (const p of ["/v1/association/{rna}", "/v1/associations/recherche", "/v1/association/{rna}/annonces"]) {
    ok(o.paths[p]?.get?.["x-price"] !== undefined, `OpenAPI publie ${p}`, String(o.paths[p]?.get?.["x-price"]));
  }
  const reg: any = await (await fetch(`${api}/v1/provenance/registres`)).json();
  ok(!!reg.registres?.rna_interieur && !!reg.registres?.joafe_dila, "dictionnaire de provenance : rna_interieur + joafe_dila");
  const head = await fetch(`${api}/v1/association/W751004076`, { method: "HEAD" });
  ok(head.status === 405, "HEAD /v1/association/{rna} → 405 (jamais d'exécution gratuite)", String(head.status));
  const devis = await fetch(`${api}/v1/association/W751004076`);
  ok(devis.status === 402, "GET sans paiement → 402", String(devis.status));
}
if (!confirme) { console.log("\n(contrôles gratuits faits ; --je-confirme-depense pour les achats ≈ 0,017 $)"); process.exit(ko ? 1 : 0); }

const compte = privateKeyToAccount(process.env.TEST_WALLET_KEY as `0x${string}`);
console.log(`payeur : ${compte.address}`);
const client = new x402Client(); registerExactEvmScheme(client, { signer: compte });
const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;
const dossier = join("resultats", `${new Date().toISOString().replace(/[:.]/g, "-")}-controle-associations`);
mkdirSync(dossier, { recursive: true });
const achat = async (url: string, nom: string) => {
  const t0 = Date.now(); const r = await payer(`${api}${url}`); const ms = Date.now() - t0; const j: any = await r.json();
  writeFileSync(join(dossier, nom + ".json"), JSON.stringify(j, null, 1));
  console.log(`\n→ ${url} : ${r.status} en ${ms} ms`);
  return { r, j, ms };
};
const prov = (j: any, bloc: string) => (j.provenance ?? []).find((p: any) => p.bloc === bloc);

// ── fiche Croix-Rouge ──
{ const { r, j } = await achat("/v1/association/W751004076", "croix-rouge-fiche");
  ok(r.status === 200, "CROIX-ROUGE : 200");
  ok(j.rna === "W751004076" && j.titre === "CROIX ROUGE FRANCAISE", "CROIX-ROUGE : rna + titre", `${j.rna} / ${j.titre}`);
  ok(j.position?.libelle === "active" && j.nature?.libelle === "reconnue_utilite_publique", "CROIX-ROUGE : active, nature R lue « reconnue d'utilité publique »", JSON.stringify([j.position, j.nature]));
  ok(j.rup_mi === "75.000.0001" && j.fichier_source === "waldec" && j.fraicheur?.qualite === "declaree", "CROIX-ROUGE : RUP brut, fichier waldec, fraîcheur déclarée", JSON.stringify(j.fraicheur));
  ok(j.dates?.creation === "1964-12-30" && j.siege?.code_insee === "75114", "CROIX-ROUGE : création 1964-12-30, siège 75114", JSON.stringify(j.dates));
  ok(j.siren === null || j.siren === "775672272", "CROIX-ROUGE : siren null (colonne INSEE vide avant le 2 octobre) ou 775672272", String(j.siren));
  const p = prov(j, "association");
  ok(!!p && p.source_code === "rna_interieur" && p.etat === "servi" && p.confiance === "forte" && p.couverture?.etat === "complete", "CROIX-ROUGE : enveloppe association/rna_interieur servi, forte, complète", JSON.stringify(p));
  ok(/2026-09-01/.test(String(j.data_freshness)), "CROIX-ROUGE : data_freshness porte le millésime 2026-09-01", String(j.data_freshness));
  ok(!JSON.stringify(j).includes("adrg") && j.declarant === undefined, "CROIX-ROUGE : aucune trace de déclarant ni d'adresse de gestion");
  lignesRecap.push(`CROIX-ROUGE siren=${j.siren} siren_origine=${j.siren_origine} anomalies=${JSON.stringify(j.anomalies)}`);
}
// ── recherche ──
{ const { r, j } = await achat("/v1/associations/recherche?q=croix%20rouge&code_postal=75", "recherche-croix-rouge-75");
  ok(r.status === 200, "RECHERCHE : 200");
  const premier = (j.resultats ?? [])[0] ?? {};
  ok(premier.rna === "W751004076" && Number(premier.score_confiance) >= 0.5, "RECHERCHE : W751004076 en tête, score ≥ 0,5", `${premier.rna} score ${premier.score_confiance} (${j.total_results} résultats)`);
  const p = prov(j, "resultats");
  ok(!!p && p.source_code === "rna_interieur" && ["servi", "partiel"].includes(p.etat), "RECHERCHE : enveloppe resultats/rna_interieur", JSON.stringify(p));
  lignesRecap.push(`RECHERCHE total_results=${j.total_results} premiers=${(j.resultats ?? []).slice(0, 3).map((x: any) => `${x.rna} ${x.titre} (${x.code_postal})`).join(" | ")}`);
}
// ── annonces ──
{ const { r, j } = await achat("/v1/association/W011006690/annonces", "meximieux-annonces");
  ok(r.status === 200, "ANNONCES : 200");
  ok(j.rna === "W011006690" && j.association?.titre === "MEXIMIEUX EN MOUVEMENT", "ANNONCES : association reliée au RNA", JSON.stringify(j.association));
  const a = (j.annonces ?? [])[0] ?? {};
  ok(j.nombre >= 1 && a.identifiant === "202600350001" && a.type?.libelle === "creation" && a.date_parution === "2026-09-01", "ANNONCES : création 202600350001 du 2026-09-01", JSON.stringify({ nombre: j.nombre, identifiant: a.identifiant, type: a.type }));
  ok(j.couverture?.jusqu_a === "2026-09-01" && String(j.couverture?.depuis) <= "2020-01-14" && Number(j.couverture?.parutions) >= 300, "ANNONCES : couverture 2020 → 2026-09-01, ≥ 300 parutions", JSON.stringify(j.couverture));
  const p = prov(j, "annonces");
  ok(!!p && p.source_code === "joafe_dila" && p.etat === "servi" && p.couverture?.etat === "partielle", "ANNONCES : enveloppe annonces/joafe_dila servi, couverture partielle (historique depuis 2020, pas 2004)", JSON.stringify(p));
  lignesRecap.push(`ANNONCES couverture=${JSON.stringify(j.couverture)} pdf=${a.fichier_pdf}`);
}
// ── inconnu : 404, paiement annulé ──
{ const { r, j } = await achat("/v1/association/W999999999", "inconnu-404");
  ok(r.status === 404 && j.error === "association_inconnue", "INCONNU : 404 association_inconnue (paiement annulé, rien de débité)", String(r.status));
}

const verdict = ko === 0 ? "✅ TOUT TIENT" : `❌ ${ko} contrôle(s) en échec`;
writeFileSync(join(dossier, "RECAP.md"), [
  `# Contrôle payé — associations loi 1901, lot T0+T1+T2 (${new Date().toISOString()})`,
  ``, `Prod servie : ${sante.commit}. Payeur (wallet de TEST) : ${compte.address}. Coût annoncé ≈ 0,017 $ (3 achats + un 404 non débité).`, ``,
  ...lignesRecap.map((l) => `- ${l}`), ``, verdict, ``,
].join("\n"));
console.log(`\n${verdict} — traces : ${dossier}`);
process.exit(ko ? 1 : 0);
