/**
 * Smoke PAYANT de vérification des LOTS A et B (audit 2026-08), ~1,9 $.
 *
 * Ce que seul un achat réel prouve, sur des SIREN choisis POUR CHAQUE correctif
 * (leçon : un smoke sur DANONE ne prouve rien pour A-06, il n'a aucune annonce) :
 *
 *   A-06  rapport PDF : les annonces BODACC s'impriment avec date et nature,
 *         au lieu de «   – ? : ».  → PHARMACIE ANATOLE FRANCE (LJ ouverte 24/07)
 *   A-07  une procédure ANNULÉE ne rend pas la société « en procédure »…
 *         → LE COFFEE (annulation d'un dépôt sur un plan de redressement :
 *           doit RESTER en procédure — le faux clément que le 1er correctif
 *           aurait produit)
 *   A-09  classe « vigilance » sans signal négatif → verdict « correct »
 *   A-10  un CA/résultat non saisi ne produit ni « −100 % » ni « 0 € »
 *   A-23  DANONE (70.10Z) porte enfin la note de périmètre tête de groupe
 *   A-24  la complétude compte 21 blocs (5 + 16), pas 18
 *   A-25  FNAC DARTY : résultat net à 0 en base → servi `null`, jamais « 0 € »
 *   A-03  la forme TVA POINTÉE est servie sans fuiter dans le journal
 *
 *   cd /home/ubuntu/sirenic-examples
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-lots-ab-2026-08-08.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { base } from "viem/chains";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const api = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const cle = process.env.TEST_WALLET_KEY;
if (!cle?.startsWith("0x")) { console.error("TEST_WALLET_KEY manquante"); process.exit(1); }
const compte = privateKeyToAccount(cle as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: compte });
const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const rpc = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const solde = async () => { try { return await rpc.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [compte.address] }); } catch { return null; } };

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `resultats/smoke-lots-ab-${horodatage}`;
mkdirSync(dossier, { recursive: true });

type Obs = { controle: string; observe: string; attendu: string; ok: boolean };
const obs: Obs[] = [];
const noter = (controle: string, observe: string, attendu: string, ok: boolean) => {
  obs.push({ controle, observe, attendu, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${controle} — ${observe}`);
};

let n = 0;
async function acheter(nom: string, url: string): Promise<{ statut: number; corps: unknown; brut: Buffer }> {
  n += 1;
  const r = await payer(`${api}${url}`, { signal: AbortSignal.timeout(150_000) });
  const ab = await r.arrayBuffer();
  const brut = Buffer.from(ab);
  const type = r.headers.get("content-type") ?? "";
  let corps: unknown = null;
  if (type.includes("pdf")) {
    writeFileSync(`${dossier}/${String(n).padStart(2, "0")}-${nom}.pdf`, brut);
  } else {
    const texte = brut.toString("utf8");
    try { corps = JSON.parse(texte); } catch { corps = texte.slice(0, 500); }
    writeFileSync(`${dossier}/${String(n).padStart(2, "0")}-${nom}.json`, JSON.stringify({ _meta: { url, statut: r.status }, reponse: corps }, null, 2));
  }
  console.log(`  [${r.status}] ${nom} ${url}`);
  return { statut: r.status, corps, brut };
}

/** Texte d'un PDF pdfkit (flux Flate + littéraux hexadécimaux). */
function texteDuPdf(pdf: Buffer): string {
  const bouts: string[] = [];
  let i = 0;
  while ((i = pdf.indexOf("stream", i)) !== -1) {
    if (pdf.subarray(i - 3, i).toString("latin1") === "end") { i += 6; continue; }
    let d = i + 6;
    while (pdf[d] === 13 || pdf[d] === 10) d += 1;
    const f = pdf.indexOf("endstream", d);
    if (f === -1) break;
    try {
      const flux = inflateSync(pdf.subarray(d, f)).toString("latin1");
      for (const s of flux.matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
        const hex = (s[1] ?? "").replace(/\s+/g, "");
        if (hex.length % 2 === 0) bouts.push(Buffer.from(hex, "hex").toString("latin1"));
      }
    } catch { /* flux non textuel */ }
    i = f;
  }
  return bouts.join("");
}

const PHARMACIE = "880233713";  // liquidation judiciaire ouverte le 24/07/2026
const LE_COFFEE = "877547216";  // annulation d'un dépôt SUR un plan de redressement
const DANONE = "552032534";     // 70.10Z, tête de groupe
const FNAC = "055800296";       // résultat net = 0 en base, CA 8,25 Md€
const FALAISES = "302183645";   // profil « vigilance » sans perte

console.log(`Payeur : ${compte.address}`);
const avant = await solde();
console.log(`Solde USDC avant : ${avant === null ? "?" : formatUnits(avant, 6)}\n`);

/* ---------- A-06 : le rapport PDF imprime enfin ses annonces ---------- */
console.log("=== A-06 — rapport PDF sur une société AVEC annonces BODACC (0,50 $) ===");
{
  const r = await acheter("A06-rapport-pharmacie", `/v1/rapport/${PHARMACIE}`);
  const texte = texteDuPdf(r.brut);
  noter("A-06 le PDF ne contient plus le marqueur d'échec", texte.includes("– ? :") ? "« – ? : » PRÉSENT" : "absent", "absent", !texte.includes("– ? :"));
  const aUneDate = /20\d\d-\d\d-\d\d/.test(texte);
  noter("A-06 une date d'annonce est imprimée", aUneDate ? "oui" : "NON", "oui", aUneDate);
  const aUneNature = /liquidation|redressement|clôture|cloture/i.test(texte);
  noter("A-06 la nature du jugement est imprimée", aUneNature ? "oui" : "NON", "oui", aUneNature);
}

/* ---------- A-07 : l'annulation ne rend pas le verdict clément ---------- */
console.log("\n=== A-07 — LE COFFEE : annulation d'un dépôt SUR un plan de redressement (0,10 $) ===");
{
  const r = await acheter("A07-score-le-coffee", `/v1/score/defaillance/${LE_COFFEE}`);
  const c = r.corps as Record<string, unknown>;
  const classe = String(c.classe ?? "");
  // La société est sous plan de redressement : elle DOIT rester signalée.
  // C'est le faux clément qu'aurait produit le premier correctif, trop grossier.
  noter("A-07 la procédure reste vue comme active (pas de faux clément)", `classe=${classe}`, "procedure_en_cours ou risque élevé", classe !== "sain");
  const sig = c.signaux_bodacc as Record<string, unknown> | undefined;
  noter("A-07 signaux BODACC servis", JSON.stringify(sig ?? null), "procedure_collective true", Boolean(sig?.procedure_collective));
}

/* ---------- A-09 / A-10 / A-23 / A-24 : le rapport à 1 $ ---------- */
console.log("\n=== A-23/A-24 — rapport intelligence DANONE, 70.10Z (1,00 $) ===");
{
  const r = await acheter("A23-intelligence-danone", `/v1/intelligence/${DANONE}`);
  const c = r.corps as Record<string, unknown>;
  const structure = (c.structure ?? {}) as Record<string, unknown>;
  const perimetre = String(structure.perimetre ?? "");
  noter("A-23 note de périmètre tête de groupe présente sur un 70.10", perimetre ? perimetre.slice(0, 60) : "ABSENTE", "présente", perimetre.includes("ne consolide pas"));
  noter("A-23 le libellé ne dit plus « NAF 64.20 » seul", perimetre.includes("70.10") ? "cite 70.10" : "ne cite pas 70.10", "cite 70.10", perimetre.includes("70.10"));

  // A-24 : le dénominateur de complétude passe de 18 à 21 blocs.
  const completude = Number(c.score_completude);
  const manquants = (c.blocs_manquants as Array<{ bloc: string }> | undefined) ?? [];
  const attenduPct = Math.round(((21 - manquants.length) / 21) * 100);
  noter("A-24 complétude calculée sur 21 blocs (5 + 16)", `${completude} % pour ${manquants.length} manquant(s)`, `${attenduPct} %`, completude === attenduPct);

  const synthese = (c.synthese ?? {}) as Record<string, unknown>;
  const resume = String(synthese.resume ?? "");
  noter("A-10 aucune variation « −100 % » fabriquée", /-100|−100/.test(resume) ? "PRÉSENTE" : "absente", "absente", !/-100|−100/.test(resume));
  console.log(`     verdict servi : ${String(synthese.verdict_global)}`);
}

/* ---------- A-09 : vigilance → « correct », jamais « solide » ---------- */
console.log("\n=== A-09 — profil « vigilance » sans signal négatif (1,00 $) ===");
{
  const r = await acheter("A09-intelligence-vigilance", `/v1/intelligence/${FALAISES}`);
  const c = r.corps as Record<string, unknown>;
  const classe = String(((c.risques as Record<string, unknown>)?.score_defaillance as Record<string, unknown>)?.classe ?? "");
  const verdict = String((c.synthese as Record<string, unknown>)?.verdict_global ?? "");
  const coherent = !(classe === "vigilance" && verdict === "solide");
  noter("A-09 le rapport ne se contredit pas", `classe=${classe} verdict=${verdict}`, "pas (vigilance + solide)", coherent);
}

/* ---------- A-25 : résultat net à 0 = absent ---------- */
console.log("\n=== A-25 — FNAC DARTY : résultat net à 0 en base (0,24 $) ===");
{
  const r = await acheter("A25-comparer-fnac", `/v1/comparer?sirens=${FNAC},${DANONE}`);
  const c = r.corps as Record<string, unknown>;
  const fnac = (c.entreprises as Array<Record<string, unknown>>).find((e) => String(e.siren) === FNAC);
  const fin = (fnac?.finances ?? null) as Record<string, unknown> | null;
  const rn = fin ? fin.resultat_net : "bloc absent";
  noter("A-25 un résultat net à 0 est servi `null`, pas « 0 »", `resultat_net=${JSON.stringify(rn)}`, "null", rn === null || rn === undefined);
}

/* ---------- A-03 : la TVA pointée est servie sans fuiter ---------- */
console.log("\n=== A-03 — forme TVA POINTÉE acceptée et masquée au journal (0,003 $) ===");
{
  const r = await acheter("A03-tva-pointee", `/v1/tva/verifier/BE0403.199.702`);
  noter("A-03 la forme pointée est bien servie (donc bien journalisée)", `HTTP ${r.statut}`, "200", r.statut === 200);
  console.log("     (le masquage lui-même se vérifie côté serveur : journalctl -u sirenic | grep 'tva/verifier')");
}

/* ---------- Récapitulatif ---------- */
console.log("\nAttente 35 s (règlements en cours de minage)...");
await new Promise((t) => setTimeout(t, 35_000));
const apres = await solde();
const depense = avant !== null && apres !== null ? formatUnits(avant - apres, 6) : "?";
const reussis = obs.filter((o) => o.ok).length;
console.log(`\n${reussis}/${obs.length} contrôles conformes — dépense réelle ${depense} USDC`);
for (const o of obs.filter((x) => !x.ok)) console.log(`  ✗ ${o.controle} : observé « ${o.observe} », attendu « ${o.attendu} »`);

writeFileSync(`${dossier}/recap.json`, JSON.stringify({
  quand: horodatage, commit: "d2b7c85", payeur: compte.address,
  solde_avant: avant === null ? null : formatUnits(avant, 6),
  solde_apres: apres === null ? null : formatUnits(apres, 6),
  depense_usdc: depense, controles: obs,
}, null, 2));
console.log(`Résultats conservés dans ${dossier}/`);
