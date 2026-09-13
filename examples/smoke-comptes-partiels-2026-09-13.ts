/**
 * Smoke PAYANT — comptes à compte de résultat confidentiel servis en les nommant (13/09/2026).
 *
 *   npx tsx --env-file=.env.wallet-test examples/smoke-comptes-partiels-2026-09-13.ts
 *
 * COÛT ANNONCÉ : **0,13 $** — trois appels payés sur LOG SYSTEM 335146965 (comptes 2023 et 2024
 * déposés avec un compte de résultat confidentiel, art. L. 232-25 C. com.) : `/finances` (0,01 $),
 * `/documents` (0,02 $) et le téléchargement du PDF du bilan 2024 (0,10 $). Ce que ce smoke prouve,
 * et que la suite ne prouve pas : que le registre INPI sert bien le PDF d'un dépôt partiel (partie
 * bilan) à travers notre route, que la liste le nomme avec son statut, et que l'exercice 2024 est
 * servi avec sa CAUSE (compte de résultat confidentiel) et ses postes non publiés à null.
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

const SIREN = "335146965";
const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-comptes-partiels-${horodatage}`;
mkdirSync(dossier, { recursive: true });
const echecs: string[] = [];
const verifier = (ok: boolean, quoi: string): void => {
  console.log(`${ok ? "  ok  " : " ÉCHEC"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};
type Obj = Record<string, any>;
async function acheterJson(nom: string, url: string): Promise<{ statut: number; corps: Obj; regle: string | null }> {
  const r = await payer(url);
  const brut = await r.text();
  writeFileSync(`${dossier}/${nom}.json`, `HTTP ${r.status}\n${brut}\n`);
  const regle = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  console.log(`\n${nom} → HTTP ${r.status}`);
  let corps: Obj = {};
  try { corps = JSON.parse(brut) as Obj; } catch { /* conservé brut */ }
  return { statut: r.status, corps, regle };
}

// 1. /finances — l'exercice 2024 porte sa cause, ses postes non publiés valent null
const fin = await acheterJson("01-finances", `${api}/v1/entreprise/${SIREN}/finances`);
verifier(fin.statut === 200 && Boolean(fin.regle), "achat /finances → 200 réglé");
const exercices: Obj[] = fin.corps.exercices ?? [];
const ex2024 = exercices.find((e) => e.date_cloture === "2024-12-31");
verifier(Boolean(ex2024), "exercice 2024 servi");
verifier(ex2024?.qualite?.anomalies?.includes("compte_de_resultat_confidentiel") === true, `anomalie compte_de_resultat_confidentiel sur 2024 (lu ${JSON.stringify(ex2024?.qualite?.anomalies)})`);
verifier(ex2024?.qualite?.fiabilite === "exploitable", "2024 reste exploitable");
verifier(ex2024?.chiffre_affaires === null && ex2024?.ebe === null, `CA et EBE 2024 servis null (lu ${ex2024?.chiffre_affaires} / ${ex2024?.ebe})`);
verifier(typeof ex2024?.resultat_net === "number" && typeof ex2024?.ratios?.autonomie_financiere === "number", "résultat net et autonomie 2024 lus");
// La colonne peut encore être NULL en base (ré-ingestion à venir) : la cause vient alors de la liasse INPI ;
// dans les deux cas le statut est servi.
verifier(ex2024?.confidentialite === "compte_de_resultat_confidentiel", `exercice 2024 marqué confidentialite (lu ${ex2024?.confidentialite})`);
const liasses: Obj[] = fin.corps.bilans_saisis_inpi ?? [];
const liasse2024 = liasses.find((b) => b.date_cloture === "2024-12-31");
verifier(Boolean(liasse2024), `liasse INPI 2024 servie (${liasses.length} liasses)`);
verifier(liasse2024?.confidentialite === "compte_de_resultat_confidentiel" && Array.isArray(liasse2024?.pages_servies) && !liasse2024.pages_servies.includes(3) && !liasse2024.pages_servies.includes(4), `liasse 2024 : statut + pages du bilan seules (lu ${JSON.stringify(liasse2024?.pages_servies)})`);
verifier(liasse2024?.postes_cles?.chiffre_affaires === null && typeof liasse2024?.postes_cles?.resultat_net === "number", "liasse 2024 : CA null par construction, résultat au passif lu");
verifier(/compte de résultat confidentiel/.test(String(fin.corps.note)), "la note de couverture dit la partie bilan");
verifier(String((fin.corps.qualification ?? {}).anomalies?.compte_de_resultat_confidentiel ?? "").includes("L. 232-25"), "lexique : la lecture de l'anomalie est servie");
verifier(!/Partiellement confidentiel/.test(JSON.stringify(exercices)), "les exercices portent le code fermé, pas le libellé amont");

// 2. /documents — le bilan 2024 est listé avec son statut
const docs = await acheterJson("02-documents", `${api}/v1/entreprise/${SIREN}/documents`);
verifier(docs.statut === 200 && Boolean(docs.regle), "achat /documents → 200 réglé");
const bilans: Obj[] = docs.corps.bilans ?? [];
const bilan2024 = bilans.find((b) => b.date_cloture === "2024-12-31");
verifier(Boolean(bilan2024?.id), `bilan 2024 listé avec un identifiant (${bilans.length} bilans)`);
verifier(bilan2024?.confidentialite === "compte_de_resultat_confidentiel", `bilan 2024 : confidentialite (lu ${bilan2024?.confidentialite})`);
verifier(bilans.some((b) => b.confidentialite === "public"), "les bilans publics portent « public »");
verifier(/compte de résultat confidentiel/.test(String(docs.corps.disclaimer)), "le disclaimer dit ce qui est servi");

// 3. Téléchargement du PDF du bilan 2024 — ce que l'INPI publie, tel quel
let pdfOk = false;
if (bilan2024?.id) {
  const r = await payer(`${api}/v1/documents/bilans/${bilan2024.id}`);
  const octets = Buffer.from(await r.arrayBuffer());
  writeFileSync(`${dossier}/03-bilan-2024.pdf`, octets);
  writeFileSync(`${dossier}/03-bilan-2024-entetes.txt`, `HTTP ${r.status}\ncontent-type: ${r.headers.get("content-type")}\ntaille: ${octets.length}\nreglement: ${r.headers.get("payment-response") ?? r.headers.get("x-payment-response") ?? "(aucun)"}\n`);
  console.log(`\n03-bilan-2024 → HTTP ${r.status}, ${octets.length} octets, ${r.headers.get("content-type")}`);
  pdfOk = r.status === 200 && octets.subarray(0, 5).toString() === "%PDF-" && octets.length > 2000;
  verifier(pdfOk, "PDF du bilan partiel servi par l'INPI à travers /documents (magic %PDF-, > 2 Ko)");
  verifier(r.status !== 200 || Boolean(r.headers.get("payment-response") ?? r.headers.get("x-payment-response")), "règlement présent sur le PDF servi");
  if (r.status === 404) verifier(!(r.headers.get("payment-response") ?? r.headers.get("x-payment-response")), "404 non débité");
}

const resume = [
  `Smoke comptes à compte de résultat confidentiel — ${new Date().toISOString()}`,
  `appels payés : /finances 0,01 $ + /documents 0,02 $ + PDF bilan 2024 0,10 $ = 0,13 $ (LOG SYSTEM ${SIREN})`,
  `exercice 2024 : anomalies ${JSON.stringify(ex2024?.qualite?.anomalies)}, confidentialite ${ex2024?.confidentialite}, CA ${ex2024?.chiffre_affaires}, RN ${ex2024?.resultat_net}`,
  `liasse 2024 : pages ${JSON.stringify(liasse2024?.pages_servies)}, statut ${liasse2024?.confidentialite}`,
  `documents : ${bilans.length} bilans listés, 2024 = ${bilan2024?.confidentialite}, PDF ${pdfOk ? "servi" : "NON servi"}`,
  ``,
  echecs.length === 0 ? "RÉSULTAT : tous les contrôles au vert." : `RÉSULTAT : ${echecs.length} ÉCHEC(S)`,
  ...echecs.map((e) => `  - ${e}`),
].join("\n");
writeFileSync(`${dossier}/RESUME.txt`, `${resume}\n`);
console.log(`\n${resume}\n\nRésultats conservés : ${dossier}`);
process.exit(echecs.length === 0 ? 0 : 1);
