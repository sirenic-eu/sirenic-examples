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
 *   4. route sous le plafond avec un client PAR DÉFAUT — 0,002 $ (payant ; 0,001 $ avant le 19/08 soir)
 *   5. EURC sans opt-in : l'option n'atteint pas le sélecteur (gratuit)
 *   6. EURC avec opt-in : charge signable produite (gratuit — le wallet de test
 *      a 0 EURC, aucun règlement en euros n'est possible aujourd'hui)
 *   7. surface MCP payée de bout en bout — 0,002 $ (payant)
 *
 * Dépense attendue : ~1,054 USDC (0,004 si SMOKE_ACHAT_AU_DELA=0, qui saute le
 * seul achat au-delà du plafond).
 *
 * DURCI le 19/08 après relecture adversariale du premier passage : quatre
 * assertions ne regardaient que l'enveloppe et pouvaient passer au vert sur une
 * réponse dégradée, une erreur MCP, une absence comparée à une absence, ou une
 * régression du devis côté SERVEUR. Chaque épreuve vérifie désormais ce qu'elle
 * annonce, et le montant réglé est LU dans l'en-tête PAYMENT-RESPONSE au lieu
 * d'être écrit en dur dans le résumé.
 *
 *   cd /home/ubuntu/sirenic-examples
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-plafond-client-2026-08-19.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";

/**
 * Contenu de l'en-tête PAYMENT-RESPONSE (base64 JSON) = `SettleResponse` du
 * facilitateur : `success`, `transaction`, `network`, `payer`.
 *
 * ⚠️ Il ne porte PAS le montant sur le schéma `exact` (le champ `amount` y est
 * documenté comme présent seulement pour les schémas type `upto`) : une sonde
 * qui prétendait vérifier « combien a été réglé » depuis cet en-tête ne pouvait
 * que rougir à tort — première rédaction de ce durcissement, 19/08. Le montant
 * qui fait foi est celui du DEVIS SIGNÉ (en-tête PAYMENT-REQUIRED), lisible
 * GRATUITEMENT avant de payer : c'est `montantSigneDe()` ci-dessous.
 */
function reglement(r: Response): {
  succes: boolean | null;
  tx: string | null;
  payeur: string | null;
  brut: string | null;
} {
  const brut = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  if (!brut) return { succes: null, tx: null, payeur: null, brut: null };
  try {
    const d = JSON.parse(Buffer.from(brut, "base64").toString("utf8")) as Record<string, any>;
    return { succes: d.success ?? null, tx: d.transaction ?? null, payeur: d.payer ?? null, brut };
  } catch {
    return { succes: null, tx: null, payeur: null, brut };
  }
}

/** Montant du devis SIGNÉ pour une URL, lu sur un 402 gratuit (option 1 = USDC). */
async function montantSigneDe(url: string): Promise<string | null> {
  const r = await fetch(url);
  const entete = r.headers.get("payment-required");
  if (r.status !== 402 || !entete) return null;
  return decodePaymentRequiredHeader(entete).accepts?.[0]?.amount ?? null;
}

/** Total réellement réglé pendant la course, lu dans les en-têtes. */
const regles: { epreuve: string; montant: string | null; tx: string | null }[] = [];

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
/** Version du SDK client réellement chargée : c'est elle qui décide du plafond,
 *  donc elle doit figurer dans la trace (une même sonde ne prouve pas la même
 *  chose en 2.22 et en 2.23). */
const versionSdk = (() => {
  try {
    return createRequire(import.meta.url)("@x402/core/package.json").version as string;
  } catch {
    return "inconnue";
  }
})();

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
if (process.env.SMOKE_ACHAT_AU_DELA === "0") {
  console.log("↷ 2. achat au-delà du plafond SAUTÉ (SMOKE_ACHAT_AU_DELA=0)");
  journal.push({ epreuve: "2. plafond levé : le devis à 1,05 $ est réglé (payant)", ok: null, saute: true });
} else {
  const payer = wrapFetchWithPayment(fetch, clientNeuf({ plafond: "$100" })) as typeof fetch;
  const r = await payer(`${api}/v1/kyb/batch?sirens=${DIX_SIREN}`, {
    headers: { Accept: "application/json" },
  });
  const texte = await r.text();
  writeFileSync(`${dossier}/2-achat-plafond-leve.json`, texte);
  const paiement = reglement(r);
  const montantSigne2 = await montantSigneDe(`${api}/v1/kyb/batch?sirens=${DIX_SIREN}`);
  regles.push({ epreuve: "2", montant: montantSigne2, tx: paiement.tx });
  writeFileSync(`${dossier}/2-reglement-entete.json`, JSON.stringify(paiement, null, 2));
  let corps: any = {};
  try { corps = JSON.parse(texte); } catch { /* non-JSON */ }
  // Forme réelle de la route (contrat) : { nombre_demande, nombre_trouve, entreprises[] }.
  const fiches = Array.isArray(corps?.entreprises) ? corps.entreprises.length : null;
  const trouvees = Array.isArray(corps?.entreprises)
    ? corps.entreprises.filter((e: any) => e?.trouve === true).length
    : 0;
  noter(
    "2. plafond levé : le devis à 1,05 $ est réglé ET livré (payant)",
    r.ok &&
      // le MONTANT du devis signé, pas seulement le fait qu'il y ait eu
      // règlement : 1 050 000 atomiques = 1,05 $, le total du lot et non le
      // prix unitaire. Plus la confirmation du facilitateur et sa transaction.
      montantSigne2 === "1050000" &&
      paiement.succes === true &&
      Boolean(paiement.tx) &&
      fiches === 10 &&
      corps?.nombre_demande === 10 &&
      // livraison : des fiches RÉELLES, pas 10 trouve=false (facturés pareil).
      trouvees === 10,
    {
      http: r.status,
      montant_signe: montantSigne2,
      succes_facilitateur: paiement.succes,
      tx: paiement.tx,
      fiches,
      fiches_trouvees: trouvees,
      nombre_demande: corps?.nombre_demande ?? null,
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
  // ⚠️ La contre-épreuve doit prouver que la route CONCURRENTE est bien tarifée
  // (402 + son prix) avant de conclure qu'elle ne porte pas la note : sinon
  // c'est une absence comparée à une absence, verte même si la route perdait
  // son péage. Et l'intitulé est précis : sous le plafond, la route ne porte pas
  // la note de PLAFOND — elle porte bien, comme toutes, l'avertissement EURC.
  noter("3. le 402 porte la note de plafond sur la route concernée, PAS sous le plafond (gratuit)",
    r.status === 402 &&
      note.includes("spendControls") &&
      note.includes("up to $10.50") &&
      montantSigne === "1050000" &&
      cheap.status === 402 &&
      corpsCheap?.price === "$0.002" &&
      !String(corpsCheap?.pricing_note ?? "").includes("up to $") &&
      // l'avertissement EURC, lui, DOIT être là (les deux annonces ne se
      // confondent pas) et doit nommer le cap par actif.
      String(corpsCheap?.message ?? "").includes("maxAmountPerPayment"),
    {
      montant_signe: montantSigne,
      http_contre_epreuve: cheap.status,
      prix_contre_epreuve: corpsCheap?.price ?? null,
      note_plafond_sous_le_seuil: corpsCheap?.pricing_note ?? null,
      eurc_cap_par_actif_annonce: String(corpsCheap?.message ?? "").includes("maxAmountPerPayment"),
    });
}

// ------------------------------- 4. route sous le plafond avec un client PAR DÉFAUT
{
  const payer = wrapFetchWithPayment(fetch, clientNeuf()) as typeof fetch;
  const r = await payer(`${api}/v1/recherche?q=danone`, { headers: { Accept: "application/json" } });
  const texte = await r.text();
  writeFileSync(`${dossier}/4-achat-sous-plafond.json`, texte);
  const paiement = reglement(r);
  const montantSigne4 = await montantSigneDe(`${api}/v1/recherche?q=danone`);
  regles.push({ epreuve: "4", montant: montantSigne4, tx: paiement.tx });
  let corps: any = {};
  try { corps = JSON.parse(texte); } catch { /* non-JSON */ }
  const rangs: string[] = Array.isArray(corps?.resultats)
    ? corps.resultats.map((x: any) => String(x?.siren))
    : [];
  // ⚠️ Le 19/08, cette épreuve n'assertait que l'enveloppe (200 + réglé) : elle
  // a acheté une réponse à UN résultat là où la route vend « the top 10
  // matches » (trois étages de recherche abandonnés en silence sur
  // statement_timeout) et l'a affichée verte. On assert désormais la LIVRAISON :
  // un plancher de résultats et le SIREN attendu au rang 1.
  // Depuis le correctif du même jour, la route DIT sa complétude :
  // `etages_abandonnes` est toujours servi, `[]` = top 10 complet (un étage
  // perdu bascule sur le registre temps réel ; un partiel est drapé
  // `resultats_partiels: true`). L'épreuve exige le contrat complet.
  const etagesAbandonnes: unknown = corps?.etages_abandonnes;
  noter("4. client par défaut : une route à 0,002 $ s'achète ET livre (payant)",
    r.ok &&
      montantSigne4 === "2000" &&
      paiement.succes === true &&
      Boolean(paiement.tx) &&
      rangs.length >= 5 &&
      rangs[0] === "552032534" &&
      Array.isArray(etagesAbandonnes) &&
      etagesAbandonnes.length === 0 &&
      corps?.resultats_partiels !== true,
    {
      http: r.status,
      montant_signe: montantSigne4,
      succes_facilitateur: paiement.succes,
      tx: paiement.tx,
      total_results: corps?.total_results ?? null,
      resultats: rangs.length,
      rang1: rangs[0] ?? null,
      etages_abandonnes: etagesAbandonnes ?? null,
      resultats_partiels: corps?.resultats_partiels ?? false,
      data_freshness: corps?.data_freshness ?? null,
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
  // ⚠️ Le message « aucune option EURC » est jeté par NOTRE sélecteur : sans la
  // condition `optionEurc`, l'épreuve resterait verte si le SERVEUR cessait de
  // servir la jambe EURC — en concluant « le client a filtré » alors que le
  // client n'aurait rien eu à filtrer. Le devis doit d'abord la porter.
  noter("5. le devis porte l'EURC mais, sans opt-in, l'option n'atteint pas le sélecteur (gratuit)",
    Boolean(optionEurc) &&
      optionEurc?.amount === devis.accepts[0]?.amount &&
      /aucune option EURC|spendControls/.test(refus),
    {
      option_eurc_dans_le_devis: Boolean(optionEurc),
      montant_eurc: optionEurc?.amount ?? null,
      refus: refus.slice(0, 160) || null,
    });

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
  const appelMcp = async (args: Record<string, unknown>, outil = "search_french_companies") => {
    const r = await fetch(`${api}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: outil, arguments: args },
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
    const entete = encodePaymentSignatureHeader(charge);
    paye = await appelMcp({ q: "danone", x_payment: entete });
    // Le montant réglé côté MCP est celui du devis signé : on le conserve depuis
    // la charge elle-même (la réponse MCP ne porte pas l'en-tête HTTP).
    regles.push({
      epreuve: "7",
      montant: String((structure.quote as any)?.accepts?.[0]?.amount ?? ""),
      tx: null,
    });
    writeFileSync(`${dossier}/7-mcp-paye.json`, JSON.stringify(paye, null, 2));
  } catch (e) {
    erreur = e instanceof Error ? e.message : String(e);
  }
  const payeeStructure = paye?.result?.structuredContent ?? {};
  const resultatsMcp = Array.isArray(payeeStructure?.resultat?.resultats)
    ? payeeStructure.resultat.resultats.length
    : 0;
  const paiementMcp = regles.find((x) => x.epreuve === "7");
  // ⚠️ `payment_required: false` + `resultat` non vide sont VRAIS aussi sur un
  // 429 ou un 500 (resultatOutil range alors { statut_http, ...corps } dans
  // `resultat`). On lit donc `isError`, posé exprès pour ce cas (audit C67), et
  // on exige une livraison réelle.
  noter("7. MCP : flux payé de bout en bout, sans erreur déguisée (payant)",
    structure.payment_required === true &&
      paye?.result?.isError === false &&
      payeeStructure.payment_required === false &&
      resultatsMcp >= 5,
    {
      isError: paye?.result?.isError ?? null,
      paye: payeeStructure.payment_required === false,
      resultats: resultatsMcp,
      montant_regle: paiementMcp?.montant ?? null,
      erreur: erreur.slice(0, 200) || null,
    });

  // La NOUVEAUTÉ de la surface MCP — la note de plafond reprise dans l'indice —
  // ne s'exerce que sur un outil dont la route porte une `pricing_note`. Sur
  // /v1/recherche, l'indice ne montre que la constante statique : la première
  // rédaction de cette épreuve croyait donc tester l'enrichissement sans jamais
  // le déclencher. Gratuit : un 402 sans en-tête de paiement ne coûte rien.
  const devisBatchMcp = await appelMcp(
    { sirens: DIX_SIREN.split(",") },
    "get_french_company_kyb_batch",
  );
  const indiceBatch = String(devisBatchMcp?.result?.structuredContent?.hint ?? "");
  writeFileSync(`${dossier}/7bis-mcp-402-batch.json`, JSON.stringify(devisBatchMcp, null, 2));
  noter("7 bis. MCP : l'indice du lot reprend la note de plafond du corps 402 (gratuit)",
    devisBatchMcp?.result?.structuredContent?.payment_required === true &&
      indiceBatch.includes("up to $10.50") &&
      indiceBatch.includes("maxAmountPerPayment"),
    {
      plafond_dans_l_indice: indiceBatch.includes("up to $10.50"),
      eurc_cap_par_actif: indiceBatch.includes("maxAmountPerPayment"),
    });
}

writeFileSync(
  `${dossier}/RESUME.json`,
  JSON.stringify(
    {
      horodatage,
      api,
      wallet: compte.address,
      version_sdk_client: versionSdk,
      // Somme LUE dans les en-têtes de règlement (et le devis signé pour MCP) :
      // un littéral écrit à la main ne prouvait rien et ne bougeait pas quand
      // une épreuve était sautée.
      depense_mesuree_usdc:
        regles.reduce((t, x) => t + Number(x.montant ?? 0), 0) / 1_000_000,
      reglements: regles,
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
