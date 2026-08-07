/**
 * Smoke PAYANT de vérification du LOT 2 en production (~0,17 $).
 *
 * Ce que seul un achat réel peut prouver (leçon du 24/07 : un devis qui
 * s'affiche n'est pas une route achetable ; du 01/08 : la vérification gratuite
 * ne voit pas un champ manquant dans un corps payant) :
 *   A. le score v1.4 sert bien la lentille étendue + l'avertissement + le
 *      plafond de confiance sur une tête de groupe (DANONE, 70.10Z GE) ;
 *   B. la garde du BLOQUANT tient sur données réelles : une tête de groupe en
 *      PERTE NETTE (NETMEDIA GROUP, −11,5 M€) ne gagne rien à l'être ;
 *   C. les deux routes payantes s'accordent : /v1/comparer et
 *      /v1/score/defaillance servent le MÊME score et la MÊME confiance ;
 *   D. le criblage d'un sigle court (LEO) n'accable plus le verdict ;
 *   E. le lot 1 tient toujours (PI propre, 405 sur HEAD, 400 jamais facturé).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-lot2-2026-08-07.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
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
    return await rpc.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [compte.address] });
  } catch {
    return null;
  }
};

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `resultats/smoke-lot2-${horodatage}`;
mkdirSync(dossier, { recursive: true });

type Obs = { controle: string; observe: string; attendu: string; ok: boolean };
const obs: Obs[] = [];
const noter = (controle: string, observe: string, attendu: string, ok: boolean) => {
  obs.push({ controle, observe, attendu, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${controle} — ${observe}`);
};

const DANONE = "552032534"; // 70.10Z, GE — tête de groupe, résultat net positif
const NETMEDIA = "399364751"; // 70.10Z — PERTE NETTE de 11,5 M€ : le cas du bloquant
const ORANGE = "380129866"; // GE non-holding : le cas où les deux routes divergeaient

console.log(`Payeur : ${compte.address}`);
const avant = await solde();
console.log(`Solde USDC avant : ${avant === null ? "RPC indisponible" : formatUnits(avant, 6)}`);

/* ---------- TEST 0 (gratuit) : le lot 1 tient toujours ---------- */
console.log("\n=== 0. Lot 1 — non-régression (gratuit) ===");
const head = await fetch(`${api}/v1/surveillance/jeton-inexistant/arreter`, { method: "HEAD" });
noter("HEAD sur la route qui supprimait une surveillance", `HTTP ${head.status}`, "405", head.status === 405);
noter("en-tête Allow", head.headers.get("allow") ?? "ABSENT", "GET, OPTIONS", head.headers.get("allow") === "GET, OPTIONS");

/* ---------- TEST A (0,00 $) : un 400 payé-signé ne débite rien ---------- */
console.log("\n=== A. Un 400 payé-signé ne débite toujours rien (0,00 $) ===");
try {
  const r = await payer(`${api}/v1/regulateurs/fr/alertes`);
  const recu = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  await r.text();
  noter("statut", `HTTP ${r.status}`, "400", r.status === 400);
  noter("reçu de règlement", recu ? "PRÉSENT" : "absent", "absent", !recu);
} catch (e) {
  noter("le client a levé", String(e).slice(0, 100), "400 restitué sans débit", false);
}

/* ---------- Achats ---------- */
const achats: Array<{ nom: string; chemin: string; prix: number }> = [
  { nom: "score-danone", chemin: `/v1/score/defaillance/${DANONE}`, prix: 0.1 },
  { nom: "score-netmedia", chemin: `/v1/score/defaillance/${NETMEDIA}`, prix: 0.1 },
  { nom: "score-orange", chemin: `/v1/score/defaillance/${ORANGE}`, prix: 0.1 },
  { nom: "comparer-orange-danone", chemin: `/v1/comparer?sirens=${ORANGE},${DANONE}`, prix: 0.24 },
  { nom: "sanctions-leo", chemin: `/v1/sanctions/check?name=LEO`, prix: 0.02 },
  { nom: "pi-danone", chemin: `/v1/entreprise/${DANONE}/pi`, prix: 0.03 },
];
const corps: Record<string, Record<string, unknown>> = {};
let totalRegle = 0;
console.log("\n=== Achats réels ===");
for (const a of achats) {
  const debut = Date.now();
  try {
    const r = await payer(`${api}${a.chemin}`);
    const texte = await r.text();
    writeFileSync(`${dossier}/${a.nom}.json`, `${texte}\n`);
    corps[a.nom] = JSON.parse(texte) as Record<string, unknown>;
    const recu = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
    console.log(`  ${a.nom} → HTTP ${r.status} en ${Date.now() - debut} ms (règlement ${recu ? "reçu" : "ABSENT"})`);
    if (r.status === 200 && recu) totalRegle += a.prix;
  } catch (e) {
    console.log(`  ${a.nom} → EXCEPTION ${String(e).slice(0, 140)}`);
  }
}

/* ---------- Observations ---------- */
console.log("\n=== B. Score v1.4 sur une tête de groupe (DANONE 70.10Z GE) ===");
const sd = corps["score-danone"] ?? {};
noter("score / classe", `${sd.score_risque} / ${sd.classe}`, "22 / sain", sd.score_risque === 22 && sd.classe === "sain");
noter("version du modèle", String(sd.version_modele), "defaillance-v1.4", sd.version_modele === "defaillance-v1.4");
noter("confiance plafonnée", String(sd.confiance), "moyenne", sd.confiance === "moyenne");
noter("lentille tête de groupe", sd.lentille ? "servie" : "ABSENTE", "servie (70.10)", Boolean(sd.lentille));
noter(
  "avertissement de périmètre",
  sd.avertissement_perimetre ? "servi" : "ABSENT",
  "servi",
  Boolean(sd.avertissement_perimetre),
);

console.log("\n=== C. LE BLOQUANT : une tête de groupe en PERTE ne gagne rien (NETMEDIA) ===");
const sn = corps["score-netmedia"] ?? {};
noter("score / classe", `${sn.score_risque} / ${sn.classe}`, "37 / vigilance (et surtout PAS 18/sain)", sn.score_risque === 37);
noter("lentille refusée", sn.lentille ? "SERVIE (défaut !)" : "absente", "absente (perte nette)", !sn.lentille);
noter("avertissement quand même servi", sn.avertissement_perimetre ? "servi" : "ABSENT", "servi", Boolean(sn.avertissement_perimetre));

console.log("\n=== D. Accord entre les deux routes payantes (GE non-holding : ORANGE) ===");
const so = corps["score-orange"] ?? {};
const cmp = corps["comparer-orange-danone"] ?? {};
// ⚠️ Le bloc solidité vit sous `entreprises[]`, pas à la racine : la première
//  version de ce smoke cherchait `cmp.solidite` et rendait un faux ✗ alors que
//  les deux routes s'accordaient parfaitement. Lire la forme RÉELLE du payload
//  avant d'écrire l'assertion.
const entreprises = (cmp.entreprises ?? []) as Array<Record<string, unknown>>;
const orangeDansLot = entreprises.find((e) => String(e.siren) === ORANGE)?.solidite as
  | Record<string, unknown>
  | undefined;
noter("score /v1/score/defaillance", `${so.score_risque} / ${so.classe} / ${so.confiance}`, "servi", so.score_risque !== undefined);
if (orangeDansLot) {
  noter(
    "score identique dans /v1/comparer",
    `${orangeDansLot.score_risque} / ${orangeDansLot.classe} / ${orangeDansLot.confiance}`,
    "identique aux trois champs",
    orangeDansLot.score_risque === so.score_risque &&
      orangeDansLot.classe === so.classe &&
      orangeDansLot.confiance === so.confiance,
  );
} else {
  noter("bloc solidite d'ORANGE dans /v1/comparer", `introuvable (clés: ${Object.keys(cmp).join(",")})`, "présent", false);
}
const avertLot = JSON.stringify(cmp).includes("tete_de_groupe_dans_le_lot");
noter("avertissement tête de groupe dans le lot", avertLot ? "présent" : "absent", "présent (DANONE est 70.10Z)", avertLot);

console.log("\n=== E. Criblage d'un sigle court (LEO) ===");
const leo = corps["sanctions-leo"] ?? {};
const corr = (leo.correspondances ?? []) as Array<Record<string, unknown>>;
const navires = corr.filter((c) => c.type === "navire").length;
const aeronefs = corr.filter((c) => c.type === "aeronef").length;
noter("correspondances servies (niveau inchangé, option B)", `${corr.length} dont ${corr.filter((c) => c.niveau === "forte").length} fortes`, "toujours visibles", corr.length > 0);
noter("aucun navire criblé", `${navires} navire(s)`, "0", navires === 0);
noter("aucun aéronef criblé", `${aeronefs} aéronef(s)`, "0 — sinon la ré-ingestion reste à faire", aeronefs === 0);

console.log("\n=== F. Lot 1 — bloc PI toujours propre ===");
const pi = corps["pi-danone"] ?? {};
const spi = JSON.stringify(pi);
noter("aucun fragment XML", spi.includes("<country>") ? "PRÉSENT" : "absent", "absent", !spi.includes("<country>"));
noter("aucune entité non décodée", spi.includes("&apos;") ? "PRÉSENTE" : "absente", "absente", !spi.includes("&apos;"));
const dm = (pi.dessins_modeles ?? {}) as { nombre?: number; liste?: Array<{ numero?: string }>; nombre_unite?: string };
const nums = (dm.liste ?? []).map((t) => t.numero);
noter(
  "dessins & modèles groupés par dépôt",
  `nombre ${dm.nombre} (${dm.nombre_unite}), ${nums.length} lignes, ${new Set(nums).size} distincts`,
  "nombre = distincts",
  dm.nombre === new Set(nums).size,
);

/* ---------- Solde ---------- */
await new Promise((r) => setTimeout(r, 20_000)); // laisser les derniers règlements se miner
const apres = await solde();
if (avant !== null && apres !== null) {
  const delta = Number(formatUnits(avant - apres, 6));
  console.log(`\nSolde USDC après : ${formatUnits(apres, 6)}`);
  noter(
    "débit on-chain = somme des 200 réglés",
    `${delta.toFixed(6)} $`,
    `${totalRegle.toFixed(3)} $ (le 400 du test A ne débite RIEN)`,
    Math.abs(delta - totalRegle) < 0.000001,
  );
}

writeFileSync(`${dossier}/RECAP.json`, `${JSON.stringify({ horodatage, payeur: compte.address, total_regle_attendu: totalRegle, observations: obs }, null, 2)}\n`);
const ko = obs.filter((o) => !o.ok);
console.log(`\nRéponses payées conservées : ${dossier}/`);
console.log(`Bilan : ${obs.length - ko.length}/${obs.length} contrôles conformes.`);
if (ko.length) console.log(`Écarts : ${ko.map((o) => o.controle).join(" ; ")}`);
