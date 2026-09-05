/**
 * CONTRÔLE PAYÉ du chantier « publications en double » + « verdict v1.6 »
 * (étape 0 du 04/09/2026, GO CDU du 05/09, livré sur main le 05/09).
 *
 *  Gratuit : l'OpenAPI dit les DEUX bornes sur /marches-publics et les deux
 *            champs du verdict sur /intelligence.
 *  Payé (≈ 3,02 $, GO CDU « a » du 05/09) :
 *   - /entreprise/380129866/marches-publics (0,01 $) ORANGE : attendu ≈ 2 075 lignes /
 *     1 898 dédoublonnées, 62 899 M€ brut / ≈ 49 008 M€ dédoublonnés, note + statut par ligne
 *   - /entreprise/410034607/marches-publics (0,01 $) SUEZ EAU FRANCE : ≈ 663 / 597,
 *     3 580 → ≈ 3 482 M€ ; Cœur de Flandre 202625023A = ligne_repetee, Haut-Bugey
 *     2025S00026 = publication_multiple liée à 20252025-02
 *   - /intelligence/380129866 (1 $) ORANGE et /intelligence/344434253 (1 $) BEXLEY :
 *     version 1.6, verdict « correct » INCHANGÉ, verdict_plafonne_par NON vide, tête « SOUS RÉSERVE »,
 *     qualifications structurées sur le signal englobant
 *   - /intelligence/552032534 (1 $) DANONE : « solide », motifs [classe_sain], plafond vide
 *
 *   node --env-file=.env.wallet-test --import tsx examples/controle-marches-verdict-2026-09-05.ts <commit_attendu> --je-confirme-depense
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
const STATUTS = ["unique", "publication_multiple", "ligne_repetee", "etablissements_multiples", "avenant"];
const meur = (n: unknown) => (Math.round(Number(n) / 1e5) / 10).toLocaleString("fr-FR") + " M€";

// ── gratuit ──
{
  const o: any = await (await fetch(`${api}/openapi.json`)).json();
  const dm = String(o.paths["/v1/entreprise/{siren}/marches-publics"]?.get?.responses?.["200"]?.description ?? "");
  ok(/TWO bounds/.test(dm) && /publication status/.test(dm), "OpenAPI marches-publics : deux bornes + statut de publication");
  const di = JSON.stringify(o.paths["/v1/intelligence/{siren}"] ?? {});
  ok(/motifs_verdict/.test(di) && /verdict_plafonne_par/.test(di), "OpenAPI intelligence : motifs_verdict + verdict_plafonne_par");
}
if (!confirme) { console.log("\n(contrôles gratuits faits ; --je-confirme-depense pour les achats ≈ 3,02 $)"); process.exit(ko ? 1 : 0); }

const compte = privateKeyToAccount(process.env.TEST_WALLET_KEY as `0x${string}`);
console.log(`payeur : ${compte.address}`);
const client = new x402Client(); registerExactEvmScheme(client, { signer: compte });
const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;
const dossier = join("resultats", `${new Date().toISOString().replace(/[:.]/g, "-")}-controle-marches-verdict`);
mkdirSync(dossier, { recursive: true });
const achat = async (url: string, nom: string) => {
  const t0 = Date.now(); const r = await payer(`${api}${url}`); const ms = Date.now() - t0; const j: any = await r.json();
  writeFileSync(join(dossier, nom + ".json"), JSON.stringify(j, null, 1));
  console.log(`\n→ ${url} : ${r.status} en ${ms} ms`);
  return { r, j, ms };
};
const distribution = (marches: any[]) => {
  const d: Record<string, number> = {};
  for (const m of marches) d[String(m.publication?.statut)] = (d[String(m.publication?.statut)] ?? 0) + 1;
  return JSON.stringify(d);
};

// ── ORANGE marchés ──
{ const { r, j } = await achat("/v1/entreprise/380129866/marches-publics", "orange-marches");
  ok(r.status === 200, "ORANGE : 200");
  ok(j.nombre_marches >= j.nombre_marches_dedoublonne && j.nombre_publications_en_double === j.nombre_marches - j.nombre_marches_dedoublonne,
     `ORANGE : ${j.nombre_marches} lignes, ${j.nombre_marches_dedoublonne} marchés dédoublonnés, ${j.nombre_publications_en_double} en double`);
  ok(Number(j.montant_total) > Number(j.montant_total_dedoublonne) && Math.abs(Number(j.montant_total_dedoublonne) - 49_007_800_000) < 1_500_000_000,
     `ORANGE : ${meur(j.montant_total)} brut → ${meur(j.montant_total_dedoublonne)} dédoublonnés (attendu ≈ 49 008 M€)`);
  ok(typeof j.montant_total_dedoublonne_en_groupement === "number" || j.montant_total_dedoublonne_en_groupement === null, "ORANGE : part en groupement servie", String(j.montant_total_dedoublonne_en_groupement));
  ok(/borne HAUTE/.test(String(j.note_dedoublonnage)) && /LOWER bound/.test(String(j.note_dedoublonnage)), "ORANGE : note de dédoublonnage FR/EN");
  const marches: any[] = j.marches ?? [];
  ok(marches.length > 0 && marches.every((m) => STATUTS.includes(m.publication?.statut) && Array.isArray(m.publication?.lignes_liees) && typeof m.publication?.identifiant_partage === "boolean"),
     `ORANGE : ${marches.length} lignes servies, chacune avec publication.statut de la liste fermée`, distribution(marches));
}
// ── SUEZ marchés ──
{ const { r, j } = await achat("/v1/entreprise/410034607/marches-publics", "suez-marches");
  ok(r.status === 200, "SUEZ : 200");
  ok(Math.abs(Number(j.montant_total_dedoublonne) - 3_482_400_000) < 100_000_000,
     `SUEZ : ${j.nombre_marches} lignes / ${j.nombre_marches_dedoublonne} marchés, ${meur(j.montant_total)} → ${meur(j.montant_total_dedoublonne)} (attendu ≈ 3 482 M€)`);
  const marches: any[] = j.marches ?? [];
  const flandre = marches.filter((m) => m.id === "202625023A");
  ok(flandre.length === 2 && flandre.every((m) => m.publication?.statut === "ligne_repetee"), "SUEZ / Cœur de Flandre 202625023A : deux lignes, statut ligne_repetee", distribution(flandre));
  const atexo = marches.find((m) => m.id === "2025S00026");
  ok(!!atexo && atexo.publication?.statut === "publication_multiple" && (atexo.publication?.lignes_liees ?? []).includes("20252025-02") && (atexo.publication?.plateformes ?? []).length === 2,
     "SUEZ / Haut-Bugey 2025S00026 : publication_multiple, liée à 20252025-02, deux plateformes", JSON.stringify(atexo?.publication ?? null));
  lignesRecap.push(`SUEZ distribution des statuts (100 plus récentes) : ${distribution(marches)}`);
}
// ── intelligence ──
const englobantStructure = (j: any) => (j.signaux ?? []).find((s: any) => s.signal === "correspondance_sanctions_nom_englobant");
for (const [siren, nom] of [["380129866", "ORANGE"], ["344434253", "BEXLEY"]] as const) {
  const { r, j } = await achat(`/v1/intelligence/${siren}`, `${nom.toLowerCase()}-intelligence`);
  const s = j.synthese ?? {};
  ok(r.status === 200 && j.version_rapport === "1.6", `${nom} intelligence : 200, version_rapport 1.6`, String(j.version_rapport));
  ok(s.verdict_global === "correct", `${nom} : verdict_global INCHANGÉ = correct`, String(s.verdict_global));
  ok(Array.isArray(s.verdict_plafonne_par) && s.verdict_plafonne_par.length > 0, `${nom} : verdict_plafonne_par non vide`, JSON.stringify(s.verdict_plafonne_par));
  ok(Array.isArray(s.motifs_verdict) && s.motifs_verdict.length > 0, `${nom} : motifs_verdict`, JSON.stringify(s.motifs_verdict));
  ok(/SOUS RÉSERVE/.test(String(s.resume)), `${nom} : tête « SOUS RÉSERVE »`, String(s.resume).slice(0, 120));
  const sig = englobantStructure(j);
  ok(!!sig && Array.isArray(sig.qualifications) && sig.niveau === "forte", `${nom} : signal englobant avec qualifications structurées`, JSON.stringify(sig?.qualifications ?? null));
  lignesRecap.push(`${nom} points_vigilance : ${JSON.stringify(s.points_vigilance)} ; complétude ${j.score_completude}`);
}
{ const { r, j } = await achat("/v1/intelligence/552032534", "danone-intelligence");
  const s = j.synthese ?? {};
  ok(r.status === 200 && s.verdict_global === "solide", "DANONE : solide", String(s.verdict_global));
  ok(JSON.stringify(s.motifs_verdict) === JSON.stringify(["classe_sain"]) && Array.isArray(s.verdict_plafonne_par) && s.verdict_plafonne_par.length === 0,
     "DANONE : motifs [classe_sain], plafond vide", `${JSON.stringify(s.motifs_verdict)} / ${JSON.stringify(s.verdict_plafonne_par)}`);
  ok(/Profil solide/.test(String(s.resume)), "DANONE : tête « Profil solide » inchangée");
}

const verdict = ko === 0 ? "✅ TOUT TIENT" : `❌ ${ko} contrôle(s) en échec`;
writeFileSync(join(dossier, "RECAP.md"), [
  `# Contrôle payé — publications en double + verdict v1.6 (${new Date().toISOString()})`,
  ``, `Prod servie : ${sante.commit}. Payeur (wallet de TEST) : ${compte.address}. Coût annoncé ≈ 3,02 $.`, ``,
  ...lignesRecap.map((l) => `- ${l}`), ``, verdict, ``,
].join("\n"));
console.log(`\n${verdict} — traces : ${dossier}`);
process.exit(ko ? 1 : 0);
