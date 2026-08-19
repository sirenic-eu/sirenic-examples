/**
 * Smoke PAYANT du 19/08/2026 — plafond de dépense CLIENT (`spendControls`) et
 * opt-in EURC, tels qu'ils se comportent sur le MAINNET avec un vrai client.
 *
 * Contexte : depuis `@x402/core` 2.23, un acheteur qui n'a rien configuré
 * refuse LUI-MÊME tout devis au-delà de 1 $ et ne peut plus prendre l'option
 * EURC. Nos routes par lot cotent jusqu'à 50 $. Sirenic annonce désormais les
 * deux contraintes (corps 402, `x-price`, indice MCP, carte A2A) — ce smoke
 * vérifie l'annonce ET le comportement réel, argent compris.
 *
 * Sept épreuves, dont quatre GRATUITES (un refus côté client ne coûte rien) :
 *   1. refus par défaut au-delà de 1 $ (gratuit)
 *   2. achat du MÊME devis, plafond levé — 1,05 $ (payant)
 *   3. avertissement servi sur le 402 nu + contre-épreuve sous le plafond (gratuit)
 *   4. route sous le plafond avec un client PAR DÉFAUT — 0,001 $ (payant)
 *   5. EURC sans opt-in : l'option n'atteint pas le sélecteur (gratuit)
 *   6. EURC avec opt-in : charge signable produite (gratuit — le wallet de test
 *      a 0 EURC, aucun règlement en euros n'est possible aujourd'hui)
 *   7. surface MCP payée de bout en bout — 0,001 $ (payant)
 *
 * Dépense attendue : ~1,052 USDC.
 *
 *   cd /home/ubuntu/sirenic-examples
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-plafond-client-2026-08-19.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";

const api = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const cle = process.env.TEST_WALLET_KEY;
if (!cle?.startsWith("0x")) {
  console.error("TEST_WALLET_KEY manquante (--env-file=.env.wallet-test)");
  process.exit(1);
}
const compte = privateKeyToAccount(cle as `0x${string}`);
const EURC_BASE = "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42".toLowerCase();

/** 10 SIREN réels : 10 × 0,105 $ = 1,05 $, le premier devis au-delà du plafond. */
const DIX_SIREN = [
  "552032534", // DANONE
  "542107651", // TOTALENERGIES SE
  "552100554", // L'OREAL
  "775670417", // LVMH (775665019 est Luhn-INVALIDE : vérifié avant de payer)
  "380129866", // BNP PARIBAS (SIREN de filiale connue du registre)
  "542051180", // SANOFI
  "632012100", // MICHELIN
  "552081317", // AIR LIQUIDE
  "562082909", // RENAULT
  "552144503", // SAINT-GOBAIN
].join(",");

/** Client neuf. `spendControls` n'existe qu'à partir de 2.23 : on ne l'appelle
 *  que s'il est là, pour que ce script reste exécutable sur une version plus
 *  ancienne du SDK (il dira alors simplement que le refus n'a pas lieu). */
function clientNeuf(options?: {
  plafond?: string;
  actifsAutorises?: { network: string; asset: string }[];
  selecteur?: (v: unknown, exigences: any[]) => any;
}) {
  const client = options?.selecteur
    ? new x402Client(options.selecteur as never)
    : new x402Client();
  const avecControles = client as unknown as {
    setSpendControls?: (c: unknown) => void;
  };
  if ((options?.plafond || options?.actifsAutorises) && avecControles.setSpendControls) {
    avecControles.setSpendControls({
      ...(options.plafond ? { maxAmountPerPayment: options.plafond } : {}),
      ...(options.actifsAutorises ? { allowedAssets: options.actifsAutorises } : {}),
    });
  }
  registerExactEvmScheme(client, { signer: compte });
  return client;
}

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `resultats/${horodatage}-plafond-client-1-dollar`;
mkdirSync(dossier, { recursive: true });

const journal: Record<string, unknown>[] = [];
let echecs = 0;
const versionSdk = (await import("@x402/core/package.json", { with: { type: "json" } }).catch(() => null)) as
  | { default?: { version?: string } }
  | null;

function noter(nom: string, ok: boolean, details: Record<string, unknown>) {
  if (!ok) echecs += 1;
  journal.push({ epreuve: nom, ok, ...details });
  console.log(`${ok ? "✔" : "✗"} ${nom} — ${JSON.stringify(details).slice(0, 220)}`);
}

// ---------------------------------------------------------------- 1. refus par défaut
{
  const payer = wrapFetchWithPayment(fetch, clientNeuf()) as typeof fetch;
  let message = "";
  let statut: number | null = null;
  try {
    const r = await payer(`${api}/v1/kyb/batch?sirens=${DIX_SIREN}`);
    statut = r.status;
    writeFileSync(`${dossier}/1-refus-par-defaut-REPONSE-INATTENDUE.json`, await r.text());
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  writeFileSync(`${dossier}/1-refus-par-defaut.txt`, message || `AUCUN REFUS — HTTP ${statut}`);
  noter("1. client par défaut refuse un devis à 1,05 $ (gratuit)", /spendControls/.test(message), {
    refus: message.slice(0, 160) || null,
    http: statut,
  });
}

// ------------------------------------------------- 2. achat du même devis, plafond levé
{
  const payer = wrapFetchWithPayment(fetch, clientNeuf({ plafond: "$100" })) as typeof fetch;
  const r = await payer(`${api}/v1/kyb/batch?sirens=${DIX_SIREN}`, {
    headers: { Accept: "application/json" },
  });
  const texte = await r.text();
  writeFileSync(`${dossier}/2-achat-plafond-leve.json`, texte);
  const regle = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  let corps: any = {};
  try { corps = JSON.parse(texte); } catch { /* non-JSON */ }
  // Forme réelle de la route (contrat) : { nombre_demande, nombre_trouve, entreprises[] }.
  const fiches = Array.isArray(corps?.entreprises) ? corps.entreprises.length : null;
  noter(
    "2. plafond levé : le devis à 1,05 $ est réglé (payant)",
    r.ok && Boolean(regle) && fiches === 10 && corps?.nombre_demande === 10,
    {
      http: r.status,
      regle: Boolean(regle),
      fiches,
      nombre_demande: corps?.nombre_demande ?? null,
      nombre_trouve: corps?.nombre_trouve ?? null,
    },
  );
}

// ----------------------------------------- 3. avertissement servi (402 nu) + contre-épreuve
{
  const r = await fetch(`${api}/v1/kyb/batch?sirens=${DIX_SIREN}`);
  const corps: any = await r.json();
  const entete = r.headers.get("payment-required");
  const devis = entete ? decodePaymentRequiredHeader(entete) : null;
  const montantSigne = devis?.accepts?.[0]?.amount ?? null;
  writeFileSync(`${dossier}/3-402-nu-batch.json`, JSON.stringify({ corps, montantSigne }, null, 2));

  const cheap = await fetch(`${api}/v1/recherche?q=danone`);
  const corpsCheap: any = await cheap.json();
  writeFileSync(`${dossier}/3-402-nu-recherche.json`, JSON.stringify(corpsCheap, null, 2));

  const note = String(corps?.pricing_note ?? "");
  noter("3. le 402 annonce le plafond sur la route concernée, et RIEN sous le plafond (gratuit)",
    r.status === 402 &&
      note.includes("spendControls") &&
      note.includes("up to $10.50") &&
      montantSigne === "1050000" &&
      !String(corpsCheap?.pricing_note ?? "").includes("spendControls"),
    {
      montant_signe: montantSigne,
      note_batch: note.slice(0, 120),
      note_recherche: corpsCheap?.pricing_note ?? null,
      message_eurc: String(corps?.message ?? "").includes("allowedAssets"),
    });
}

// ------------------------------- 4. route sous le plafond avec un client PAR DÉFAUT
{
  const payer = wrapFetchWithPayment(fetch, clientNeuf()) as typeof fetch;
  const r = await payer(`${api}/v1/recherche?q=danone`, { headers: { Accept: "application/json" } });
  const texte = await r.text();
  writeFileSync(`${dossier}/4-achat-sous-plafond.json`, texte);
  const regle = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  noter("4. client par défaut : une route à 0,001 $ s'achète toujours (payant)", r.ok && Boolean(regle), {
    http: r.status,
    regle: Boolean(regle),
  });
}

// ------------------------------------------------ 5 & 6. EURC sans puis avec opt-in
{
  const r = await fetch(`${api}/v1/recherche?q=danone`);
  const devis = decodePaymentRequiredHeader(r.headers.get("payment-required") as string);
  const optionEurc = devis.accepts.find((e: any) => String(e.asset).toLowerCase() === EURC_BASE);
  writeFileSync(`${dossier}/5-6-devis-mainnet.json`, JSON.stringify(devis, null, 2));

  const selecteurEurc = (_v: unknown, exigences: any[]) => {
    const eurc = exigences.find((e) => String(e.asset).toLowerCase() === EURC_BASE);
    if (!eurc) throw new Error("aucune option EURC n'a atteint le sélecteur");
    return eurc;
  };

  let refus = "";
  try {
    await clientNeuf({ selecteur: selecteurEurc }).createPaymentPayload(devis as never);
  } catch (e) {
    refus = e instanceof Error ? e.message : String(e);
  }
  writeFileSync(`${dossier}/5-eurc-sans-optin.txt`, refus || "AUCUN REFUS");
  noter("5. EURC sans opt-in : l'option n'atteint pas le sélecteur (gratuit)",
    /aucune option EURC|spendControls/.test(refus),
    { option_eurc_dans_le_devis: Boolean(optionEurc), refus: refus.slice(0, 160) || null });

  let signable = false;
  let erreur = "";
  try {
    const charge = await clientNeuf({
      selecteur: selecteurEurc,
      actifsAutorises: [{ network: devis.accepts[0].network, asset: EURC_BASE }],
    }).createPaymentPayload(devis as never);
    signable = Boolean(charge);
    writeFileSync(`${dossier}/6-eurc-avec-optin-charge.json`, JSON.stringify(charge, null, 2));
  } catch (e) {
    erreur = e instanceof Error ? e.message : String(e);
    writeFileSync(`${dossier}/6-eurc-avec-optin-ECHEC.txt`, erreur);
  }
  noter("6. EURC avec opt-in : charge signée produite — pas de règlement, wallet à 0 EURC (gratuit)",
    signable, { signable, erreur: erreur.slice(0, 200) || null });
}

// ------------------------------------------------------ 7. surface MCP payée de bout en bout
{
  const appelMcp = async (args: Record<string, unknown>) => {
    const r = await fetch(`${api}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search_french_companies", arguments: args },
      }),
    });
    const texte = await r.text();
    const debut = texte.indexOf("{");
    return JSON.parse(debut > 0 ? texte.slice(debut) : texte);
  };

  const devisMcp = await appelMcp({ q: "danone" });
  const structure = devisMcp?.result?.structuredContent ?? {};
  writeFileSync(`${dossier}/7-mcp-402.json`, JSON.stringify(devisMcp, null, 2));

  let paye: any = null;
  let erreur = "";
  try {
    const charge = await clientNeuf().createPaymentPayload(structure.quote as never);
    paye = await appelMcp({ q: "danone", x_payment: encodePaymentSignatureHeader(charge) });
    writeFileSync(`${dossier}/7-mcp-paye.json`, JSON.stringify(paye, null, 2));
  } catch (e) {
    erreur = e instanceof Error ? e.message : String(e);
  }
  const payeeStructure = paye?.result?.structuredContent ?? {};
  noter("7. MCP : indice enrichi au 402 puis flux payé (payant)",
    structure.payment_required === true &&
      String(structure.hint ?? "").includes("allowedAssets") &&
      payeeStructure.payment_required === false &&
      Boolean(payeeStructure.resultat),
    {
      indice_opt_in_eurc: String(structure.hint ?? "").includes("allowedAssets"),
      paye: payeeStructure.payment_required === false,
      resultats: Array.isArray(payeeStructure?.resultat?.resultats)
        ? payeeStructure.resultat.resultats.length
        : null,
      erreur: erreur.slice(0, 200) || null,
    });
}

writeFileSync(
  `${dossier}/RESUME.json`,
  JSON.stringify(
    {
      horodatage,
      api,
      wallet: compte.address,
      version_sdk_client: versionSdk?.default?.version ?? "inconnue",
      depense_attendue_usdc: 1.052,
      epreuves: journal,
      echecs,
    },
    null,
    2,
  ),
);
console.log(`\nréponses conservées : ${dossier}`);
console.log(echecs === 0 ? "TOUT VERT" : `${echecs} épreuve(s) en échec`);
process.exit(echecs === 0 ? 0 : 1);
