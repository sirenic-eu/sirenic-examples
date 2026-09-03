/**
 * Smoke PAYANT — la MARQUE porte-t-elle vraiment ses dates en PRODUCTION ?
 * (chantier « dates de la PI », livré le 02/09/2026)
 *
 * Le défaut vendu : le bloc `marques` de /pi ne servait que numéro, libellé et
 * statut — la clé `date` n'était même pas dans le JSON — alors que le devis
 * x402 annonçait « statut, date et classification » pour les TROIS types de
 * titres. La suite de tests prouve que le code mappe ; seul un ACHAT prouve
 * que la PROD sert. Chaque épreuve rejoue un défaut mesuré, sur des SIREN
 * réels choisis pour ce qu'ils OPPOSENT.
 *
 *   1. **Danone 552032534** — 0,03 $. La marque doit porter dépôt,
 *      enregistrement, expiration et classes de Nice, toutes les dates en ISO.
 *      Épreuve DISCRIMINANTE : aucune date au format brut AAAAMMJJ ne doit
 *      subsister dans le TEXTE servi (c'était `"date":"19960705"`).
 *   2. **Louis Vuitton 318571064** — 0,03 $. Le portefeuille qui portait les
 *      deux autres défauts : 100 dessins sur 100 avec l'indentation du XML
 *      dans le libellé (`"\n\t\tSac à main\n\t"`), et une liste de brevets
 *      tronquée dont l'ordre n'est PAS daté (la page commence à 2012 alors
 *      qu'elle contient un 2026) — donc `note_ordre` doit être servi.
 *   3. **Le catalogue, GRATUIT** : /openapi.json doit être repassé sous
 *      200 000 octets grâce au dédoublonnage, porter ses `components/responses`,
 *      n'avoir AUCUNE référence pendante ni aucune réponse portant à la fois
 *      `$ref` et `content` (un exemple factorisé serait perdu pour un lecteur
 *      qui ne résout pas les références).
 *   4. **Le devis 402, GRATUIT** : la description vendue doit annoncer les
 *      dates ISO et l'ordre des listes, et ne plus promettre « recent items »
 *      pour les brevets.
 *
 * Coût réel attendu ≈ 0,06 $ (2 appels servis ; les contrôles 3 et 4 sont
 * gratuits). Wallet de test 0x9218fd5A… — exclu du revenu réel.
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-pi-dates-2026-09-02.ts
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
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-pi-dates-${horodatage}`;
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
  let corps: Record<string, any> = {};
  try {
    corps = JSON.parse(brut) as Record<string, any>;
  } catch {
    /* corps non JSON : les assertions échoueront d'elles-mêmes */
  }
  console.log(`\n— ${nom} → HTTP ${r.status}${regle ? " (réglé)" : ""}`);
  return { statut: r.status, brut, corps, regle };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// --- 1. Danone : la marque porte enfin ses trois dates et ses classes -------
const d = await acheter("1-danone-marque-dates", `${api}/v1/entreprise/552032534/pi`);
verifier(d.statut === 200, `Danone : 200 (lu ${d.statut})`);
verifier(d.regle !== null, "Danone : paiement RÉGLÉ (la réponse a été SERVIE)");
const m0 = d.corps.marques?.liste?.[0] ?? {};
verifier(ISO.test(String(m0.date)), `marque : date de dépôt en ISO (lu ${JSON.stringify(m0.date)})`);
verifier(m0.date_nature === "depot", `marque : date_nature=depot (lu ${JSON.stringify(m0.date_nature)})`);
verifier(
  "date_enregistrement" in m0 && "date_expiration" in m0,
  "marque : les clés date_enregistrement ET date_expiration sont SERVIES (même à null)",
);
verifier(
  typeof m0.classification === "string" && m0.classification.length > 0,
  `marque : classes de Nice servies (lu ${JSON.stringify(m0.classification)})`,
);
// ÉPREUVE DISCRIMINANTE : c'est le défaut, pas un embellissement.
verifier(
  !/"date[a-z_]*":"\d{8}"/.test(d.brut),
  "aucune date au format brut AAAAMMJJ dans le TEXTE servi",
);
verifier(
  ISO.test(String(d.corps.brevets?.liste?.[0]?.date)),
  `brevet : date de publication en ISO (lu ${JSON.stringify(d.corps.brevets?.liste?.[0]?.date)})`,
);
verifier(
  d.corps.brevets?.liste?.[0]?.date_nature === "publication",
  "brevet : date_nature=publication (une date de brevet n'est pas un dépôt)",
);
verifier(
  d.corps.marques?.liste_ordre === "date_decroissante" &&
    d.corps.dessins_modeles?.liste_ordre === "date_decroissante" &&
    d.corps.brevets?.liste_ordre === "amont_non_trie",
  `l'ordre de chaque liste est servi (lu marques=${d.corps.marques?.liste_ordre}, brevets=${d.corps.brevets?.liste_ordre}, dessins=${d.corps.dessins_modeles?.liste_ordre})`,
);
verifier(
  String(d.corps.disclaimer ?? "").includes("liste_ordre") &&
    !String(d.corps.disclaimer ?? "").includes("en montre les plus récents"),
  "le disclaimer ne promet plus « les plus récents » : il renvoie à liste_ordre",
);
// RGPD, attendu permanent : aucun nom d'inventeur ne sort de la route payée.
verifier(!/INVN/i.test(d.brut), "RGPD : aucun champ d'inventeur dans la réponse payée");

// --- 2. Louis Vuitton : libellés propres, et l'ordre non daté est DIT -------
const lv = await acheter("2-louis-vuitton-libelles-ordre", `${api}/v1/entreprise/318571064/pi`);
verifier(lv.statut === 200, `LV : 200 (lu ${lv.statut})`);
verifier(lv.regle !== null, "LV : paiement RÉGLÉ");
const libelles: string[] = (lv.corps.dessins_modeles?.liste ?? []).map((t: any) => String(t.libelle ?? ""));
verifier(
  libelles.length > 0 && libelles.every((l) => l === l.trim() && !/\s\s|\n|\t/.test(l)),
  `dessins : aucun libellé avec l'indentation du XML (lu ${JSON.stringify(libelles.slice(0, 3))})`,
);
verifier(
  !/"libelle":"[^"]*\\[tn]/.test(lv.brut),
  "aucune tabulation ni retour à la ligne dans un libellé du TEXTE servi",
);
verifier(
  lv.corps.brevets?.liste_tronquee === true &&
    String(lv.corps.brevets?.note_ordre ?? "").includes("pas les titres les plus récents"),
  "brevets tronqués : la note d'ordre est SERVIE (elle ne l'est que là)",
);
verifier(
  lv.corps.marques?.note_ordre === undefined && lv.corps.dessins_modeles?.note_ordre === undefined,
  "aucune note d'ordre là où l'amont trie par date, même tronqué",
);
verifier(
  lv.corps.dessins_modeles?.nombre_majorant === true &&
    String(lv.corps.dessins_modeles?.note_nombre ?? "").includes("que nous demandons") &&
    !String(lv.corps.dessins_modeles?.note_nombre ?? "").includes("aucune pagination"),
  "la note de majorant ne prétend plus que l'INPI ne pagine pas : la limite est la NÔTRE",
);
verifier(
  (lv.corps.marques?.liste ?? []).every((t: any) => t.date === null || ISO.test(String(t.date))),
  "toutes les dates de marque servies sont en ISO (ou null)",
);

// --- 3. Le catalogue, GRATUIT : le dédoublonnage a-t-il tenu la route ? -----
const rSpec = await fetch(`${api}/openapi.json`);
const brutSpec = await rSpec.text();
writeFileSync(`${dossier}/3-openapi-taille.txt`, `HTTP ${rSpec.status}\noctets: ${Buffer.byteLength(brutSpec, "utf8")}\n`);
const spec = JSON.parse(brutSpec) as any;
const octetsSpec = Buffer.byteLength(brutSpec, "utf8");
verifier(octetsSpec <= 200_000, `openapi.json sous le plafond de 200 000 o (lu ${octetsSpec})`);
const composants = Object.keys(spec.components?.responses ?? {});
verifier(composants.length >= 3, `components/responses est servi (lu ${composants.length} composant(s) : ${composants.join(", ")})`);
let refs = 0;
const pendantes: string[] = [];
const refEtContenu: string[] = [];
for (const [chemin, item] of Object.entries<any>(spec.paths ?? {})) {
  for (const [verbe, op] of Object.entries<any>(item ?? {})) {
    for (const [code, rep] of Object.entries<any>(op?.responses ?? {})) {
      if (rep?.$ref === undefined) continue;
      refs += 1;
      const nom = String(rep.$ref).replace("#/components/responses/", "");
      if (spec.components?.responses?.[nom] === undefined) pendantes.push(`${verbe} ${chemin} ${code}`);
      if (rep.content !== undefined) refEtContenu.push(`${verbe} ${chemin} ${code}`);
    }
  }
}
verifier(refs > 100, `les références sont bien posées en prod (lu ${refs})`);
verifier(pendantes.length === 0, `aucune référence pendante (lu ${pendantes.join(", ") || "aucune"})`);
verifier(
  refEtContenu.length === 0,
  `aucune réponse portant à la fois $ref et content (lu ${refEtContenu.join(", ") || "aucune"})`,
);
const rep400 = (() => {
  const op = spec.paths?.["/v1/entreprise/{siren}/pi"]?.get;
  const r = op?.responses?.["400"];
  const nom = String(r?.$ref ?? "").replace("#/components/responses/", "");
  return String(r?.description ?? spec.components?.responses?.[nom]?.description ?? "");
})();
verifier(
  rep400.includes("Never charged") && rep400.includes("Jamais facturé"),
  "le rappel de non-facturation reste LISIBLE après résolution de la référence",
);

// --- 4. Le devis vendu, GRATUIT : il ne promet plus ce qu'on ne sert pas ----
const r402 = await fetch(`${api}/v1/entreprise/552032534/pi`);
const corps402 = await r402.text();
const enTete = r402.headers.get("payment-required");
const devis = enTete ? JSON.parse(Buffer.from(enTete, "base64").toString()) : null;
writeFileSync(`${dossier}/4-devis-402.json`, `HTTP ${r402.status}\n${corps402}\n\n--- en-tête PAYMENT-REQUIRED ---\n${JSON.stringify(devis, null, 2)}\n`);
verifier(r402.status === 402, `devis : 402 sans paiement (lu ${r402.status})`);
const descriptionVendue = String(
  devis?.accepts?.[0]?.extra?.description ??
    devis?.accepts?.[0]?.description ??
    spec.paths?.["/v1/entreprise/{siren}/pi"]?.get?.description ??
    "",
);
writeFileSync(`${dossier}/4-description-vendue.txt`, descriptionVendue);
verifier(
  descriptionVendue.includes("ISO dates") || descriptionVendue.includes("dates en ISO"),
  "la description vendue annonce les dates ISO",
);
verifier(
  descriptionVendue.includes("liste_ordre"),
  "la description vendue renvoie à liste_ordre au lieu de promettre « recent items » pour les brevets",
);
verifier(
  !/counts plus recent items/.test(descriptionVendue),
  "l'ancienne promesse « counts plus recent items » a disparu",
);

// --- Récapitulatif ---------------------------------------------------------
const recap = {
  campagne: "pi-dates",
  quand: new Date().toISOString(),
  api,
  epreuves: 4,
  appels_payes: 2,
  cout_annonce_usd: 0.06,
  assertions_echouees: echecs,
  openapi_octets: octetsSpec,
  composants_reponses: composants,
  references_posees: refs,
};
writeFileSync(`${dossier}/recap.json`, `${JSON.stringify(recap, null, 2)}\n`);
writeFileSync(
  `${dossier}/RECAP.md`,
  [
    "# Smoke payant — dates de la PI (02/09/2026)",
    "",
    `- API : ${api}`,
    `- Appels payés : 2 (Danone 552032534, Louis Vuitton 318571064) — 0,03 $ chacun`,
    `- openapi.json : ${octetsSpec} o, ${composants.length} composants de réponse, ${refs} références`,
    `- Assertions échouées : ${echecs.length === 0 ? "aucune" : echecs.length}`,
    "",
    ...(echecs.length === 0 ? ["Tout est vert."] : echecs.map((e) => `- ÉCHEC : ${e}`)),
  ].join("\n"),
);

console.log(`\nRésultats conservés dans ${dossier}`);
if (echecs.length > 0) {
  console.error(`\n${echecs.length} assertion(s) en échec :`);
  for (const e of echecs) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("\nToutes les assertions sont vertes.");
