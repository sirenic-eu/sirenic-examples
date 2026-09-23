/**
 * Smoke post-déploiement — correctif OIB croate du 23/09/2026 (ticket #96 du dépôt principal).
 *
 * BUT : prouver sur la PROD, après déploiement du correctif (clé de contrôle ISO 7064 MOD 11,10,
 * zéros de tête complétés à l'ingestion), que les routes croates du Sudski registar livrent :
 *   1. fiche KOESTLIN d.d. par OIB (92803032010, 0,01 $) — identité, TVA, bloc registre_hr ;
 *   2. fiche KOESTLIN par MBS (10000162, 0,01 $) — résolu vers le même OIB ;
 *   3. insolvabilité TIM-PUTEVI d.o.o. u stečaju (39620744214, 0,02 $) — faillite en cours ;
 *   4. événements Zagrebačka banka d.d. (92963223473, 0,02 $) — inscriptions typées, compteurs ;
 *   5. comptes KOESTLIN (0,01 $) — dépôts par exercice, plus récent d'abord ;
 *   6. OIB à clé FAUSSE (12345678901) → 400 identifiant_invalide qui NOMME la clé, jamais facturé
 *      (l'ancien code aurait rendu un 404 « entreprise inconnue » trompeur) ;
 *   7. OIB à clé vraie inconnu du registre (12345678903) → 404, jamais facturé ;
 *   8. zéro de tête GARJEVICAKAMEN d.o.o. (02117949138) : AVANT la photo reprise par le code
 *      corrigé → 404 attendu (le sujet a été rejeté oib_invalide par la photo de l'ancien code) ;
 *      APRES_PHOTO=1 → 200 attendu (0,01 $), TVA HR02117949138, MBS 10000613.
 * COÛT ESTIMÉ : 0,07 $ (5 achats ; 0,08 $ avec APRES_PHOTO=1 ; les refus 400/404 sont gratuits
 * par construction — toute erreur du handler annule le paiement).
 *
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-croatie-oib-2026-09-23.ts
 *   APRES_PHOTO=1 node --env-file=.env.wallet-test --import tsx examples/smoke-croatie-oib-2026-09-23.ts
 *
 * Conservation (règle CDU du 24/07, étendue le 11/08) : un fichier par appel + recap.json + RECAP.md
 * sous resultats/smoke-croatie-oib-<horodatage>/, puis rsync vers sirenic-resultats/smokes/ et commit.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const BASE = process.env.SIRENIC_BASE ?? "https://api.sirenic.eu";
const APRES_PHOTO = process.env.APRES_PHOTO === "1";
const key = process.env.TEST_WALLET_KEY;
if (!key?.startsWith("0x")) {
  console.error("TEST_WALLET_KEY absente (node --env-file=.env.wallet-test …)");
  process.exit(2);
}
const account = privateKeyToAccount(key as `0x${string}`);
console.log(`payeur : ${account.address} — mode ${APRES_PHOTO ? "APRÈS photo corrigée" : "avant photo corrigée"}`);

const dossier = join("resultats", `smoke-croatie-oib-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(dossier, { recursive: true });
const ecrire = (nom: string, contenu: string): void => writeFileSync(join(dossier, nom), contenu);

const MAX_USD = 0.03;
const client = new x402Client((_v, reqs) => {
  const usdc = reqs.find((r) => r.asset.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  if (!usdc) throw new Error("pas d'option USDC dans le devis");
  const montant = Number(usdc.amount) / 1e6;
  if (montant > MAX_USD) throw new Error(`devis ${montant} $ > plafond ${MAX_USD} $ — refus`);
  return usdc;
});
registerExactEvmScheme(client, { signer: account });
const paidFetch = wrapFetchWithPayment(fetch, client);

interface Resultat { nom: string; chemin: string; attendu: string; statut: number; ok: boolean; details: string; paye: boolean; prix: number; ms: number }
const resultats: Resultat[] = [];

async function appel(nom: string, chemin: string, options: { prix: number; attendu: string; verifier: (statut: number, entetes: Headers, corps: unknown) => string | null }): Promise<void> {
  const debut = Date.now();
  const r = await paidFetch(`${BASE}${chemin}`, { signal: AbortSignal.timeout(240_000) });
  const ms = Date.now() - debut;
  const texte = await r.text();
  let corps: unknown = texte;
  try { corps = JSON.parse(texte); } catch { /* non JSON */ }
  const entetes: Record<string, string> = {};
  for (const [k, v] of r.headers) if (/payment|content-type|x-credits|x-request-id/i.test(k)) entetes[k] = k.toLowerCase().includes("payment") ? `<${v.length} octets>` : v;
  ecrire(`${nom}-trace.json`, JSON.stringify({ chemin, statut: r.status, ms, entetes }, null, 2));
  ecrire(`${nom}-corps.json`, typeof corps === "string" ? corps : JSON.stringify(corps, null, 2));
  const defaut = options.verifier(r.status, r.headers, corps);
  resultats.push({ nom, chemin, attendu: options.attendu, statut: r.status, ok: defaut === null, details: defaut ?? "conforme", paye: r.status === 200 && options.prix > 0, prix: options.prix, ms });
  console.log(`${defaut === null ? "✓" : "✗"} ${nom} — HTTP ${r.status} en ${ms} ms — ${defaut ?? "conforme"}`);
}

const provenanceServie = (corps: unknown): boolean => Array.isArray((corps as { provenance?: unknown[] })?.provenance) && ((corps as { provenance: unknown[] }).provenance.length > 0);

// 1. Fiche KOESTLIN par OIB (0,01 $).
await appel("1-koestlin-fiche-oib", "/v1/eu/entreprise/HR/92803032010", {
  prix: 0.01,
  attendu: "200 ; dénomination KOESTLIN ; tva HR92803032010 ; registre_hr.mbs 10000162 ; provenance[]",
  verifier: (statut, _e, corps) => {
    if (statut !== 200) return `statut ${statut}`;
    const c = corps as { denomination?: string; identifiants?: { tva?: string; oib?: string }; registre_hr?: { mbs?: string }; provenance?: unknown[] };
    if (!c.denomination?.includes("KOESTLIN")) return "dénomination sans KOESTLIN";
    if (c.identifiants?.tva !== "HR92803032010") return `tva ${c.identifiants?.tva}`;
    if (c.registre_hr?.mbs !== "10000162") return `registre_hr.mbs ${c.registre_hr?.mbs}`;
    if (!provenanceServie(corps)) return "provenance absente";
    return null;
  },
});

// 2. Fiche KOESTLIN par MBS, résolu en OIB (0,01 $ ; décision CDU 2A du 17/09).
await appel("2-koestlin-fiche-mbs", "/v1/eu/entreprise/HR/10000162", {
  prix: 0.01,
  attendu: "200 ; même fiche que par OIB (tva HR92803032010, mbs 10000162)",
  verifier: (statut, _e, corps) => {
    if (statut !== 200) return `statut ${statut}`;
    const c = corps as { denomination?: string; identifiants?: { tva?: string }; registre_hr?: { mbs?: string } };
    if (!c.denomination?.includes("KOESTLIN")) return "dénomination sans KOESTLIN";
    if (c.identifiants?.tva !== "HR92803032010") return `tva ${c.identifiants?.tva}`;
    if (c.registre_hr?.mbs !== "10000162") return `registre_hr.mbs ${c.registre_hr?.mbs}`;
    return null;
  },
});

// 3. Insolvabilité TIM-PUTEVI, en faillite (0,02 $).
await appel("3-tim-putevi-insolvabilite", "/v1/eu/entreprise/HR/39620744214/insolvabilite", {
  prix: 0.02,
  attendu: "200 ; procedure.en_cours=true, libellé faillite ; aucune_procedure=false ; provenance[]",
  verifier: (statut, _e, corps) => {
    if (statut !== 200) return `statut ${statut}`;
    const c = corps as { procedure?: { code?: string; libelle?: string; en_cours?: boolean }; aucune_procedure?: boolean; provenance?: unknown[] };
    if (c.procedure?.en_cours !== true) return `procedure.en_cours ${c.procedure?.en_cours}`;
    if (!/faillite|stečaj|bankrupt/i.test(`${c.procedure?.code} ${c.procedure?.libelle}`)) return `procédure inattendue : ${c.procedure?.code}`;
    if (c.aucune_procedure !== false) return `aucune_procedure ${c.aucune_procedure}`;
    if (!provenanceServie(corps)) return "provenance absente";
    return null;
  },
});

// 4. Événements Zagrebačka banka : inscriptions typées et compteurs (0,02 $).
await appel("4-zaba-evenements", "/v1/eu/entreprise/HR/92963223473/evenements", {
  prix: 0.02,
  attendu: "200 ; inscriptions[] non vide avec type et catégorie ; compteurs textes_servis/textes_retenus ; provenance[]",
  verifier: (statut, _e, corps) => {
    if (statut !== 200) return `statut ${statut}`;
    const c = corps as { nombre_inscriptions?: number; textes_servis?: number; textes_retenus?: number; inscriptions?: Array<{ type_id?: number; type_libelle?: string | null; categorie?: string }>; provenance?: unknown[] };
    if (!Array.isArray(c.inscriptions) || c.inscriptions.length === 0) return "inscriptions vides";
    if (typeof c.textes_servis !== "number" || typeof c.textes_retenus !== "number") return "compteurs absents";
    if ((c.nombre_inscriptions ?? 0) !== c.inscriptions.length) return `nombre_inscriptions ${c.nombre_inscriptions} ≠ ${c.inscriptions.length}`;
    if (c.inscriptions.some((i) => typeof i.type_id !== "number" || !i.categorie)) return "une inscription sans type ou catégorie";
    if (!provenanceServie(corps)) return "provenance absente";
    return null;
  },
});

// 5. Comptes KOESTLIN : dépôts par exercice, plus récent d'abord (0,01 $).
await appel("5-koestlin-comptes", "/v1/eu/entreprise/HR/92803032010/comptes", {
  prix: 0.01,
  attendu: "200 ; depots[] non vide, plus récent d'abord ; aucun_depot=false ; provenance[]",
  verifier: (statut, _e, corps) => {
    if (statut !== 200) return `statut ${statut}`;
    const c = corps as { depots?: Array<{ annee?: number | null }>; nombre_depots?: number; aucun_depot?: boolean; dernier_exercice?: number | null; provenance?: unknown[] };
    if (!Array.isArray(c.depots) || c.depots.length === 0) return "depots vides";
    if (c.aucun_depot !== false) return `aucun_depot ${c.aucun_depot}`;
    const annees = c.depots.map((d) => d.annee ?? -1);
    if (annees.some((a, i) => i > 0 && a > (annees[i - 1] ?? -1))) return "dépôts pas du plus récent au plus ancien";
    if (c.dernier_exercice !== (c.depots[0]?.annee ?? null)) return `dernier_exercice ${c.dernier_exercice}`;
    if (!provenanceServie(corps)) return "provenance absente";
    return null;
  },
});

// 6. Clé de contrôle FAUSSE : 400 franc qui nomme la clé, jamais facturé (LE correctif côté route).
await appel("6-cle-fausse-400", "/v1/eu/entreprise/HR/12345678901", {
  prix: 0,
  attendu: "400 identifiant_invalide, message nommant la clé de contrôle, paiement annulé",
  verifier: (statut, _e, corps) => {
    if (statut !== 400) return `statut ${statut} au lieu de 400 (l'ancien code rendait 404)`;
    const c = corps as { error?: string; message?: string };
    if (c.error !== "identifiant_invalide") return `error ${c.error}`;
    if (!/clé de contrôle|check digit/i.test(c.message ?? "")) return "le message ne nomme pas la clé de contrôle";
    return null;
  },
});

// 7. Clé vraie mais sujet inconnu du registre : 404, jamais facturé.
await appel("7-cle-vraie-inconnue-404", "/v1/eu/entreprise/HR/12345678903/comptes", {
  prix: 0,
  attendu: "404 (clé valide, sujet absent du registre), paiement annulé",
  verifier: (statut) => (statut === 404 ? null : `statut ${statut} au lieu de 404`),
});

// 8. Zéro de tête : GARJEVICAKAMEN d.o.o., OIB servi 2117949138 par l'amont, vrai OIB 02117949138.
await appel("8-garjevicakamen-zero-de-tete", "/v1/eu/entreprise/HR/02117949138", {
  prix: APRES_PHOTO ? 0.01 : 0,
  attendu: APRES_PHOTO
    ? "200 ; tva HR02117949138 ; registre_hr.mbs 10000613 (photo reprise par le code corrigé)"
    : "404 avant la photo corrigée (sujet rejeté oib_invalide par la photo de l'ancien code), paiement annulé",
  verifier: (statut, _e, corps) => {
    if (!APRES_PHOTO) return statut === 404 ? null : `statut ${statut} au lieu de 404 (photo déjà reprise ?)`;
    if (statut !== 200) return `statut ${statut}`;
    const c = corps as { denomination?: string; identifiants?: { tva?: string }; registre_hr?: { mbs?: string } };
    if (!c.denomination?.includes("GARJEVICAKAMEN")) return "dénomination sans GARJEVICAKAMEN";
    if (c.identifiants?.tva !== "HR02117949138") return `tva ${c.identifiants?.tva}`;
    if (c.registre_hr?.mbs !== "10000613") return `registre_hr.mbs ${c.registre_hr?.mbs}`;
    return null;
  },
});

const depense = resultats.filter((r) => r.paye).reduce((s, r) => s + r.prix, 0);
const recap = { campagne: "smoke-croatie-oib-2026-09-23", mode: APRES_PHOTO ? "apres_photo" : "avant_photo", base: BASE, payeur: account.address, depense_usd_nominale: depense, resultats };
ecrire("recap.json", JSON.stringify(recap, null, 2));
ecrire("RECAP.md", [
  "# Smoke correctif OIB croate — 23/09/2026 (ticket #96)",
  "",
  `Mode : ${APRES_PHOTO ? "APRÈS" : "AVANT"} la photo reprise par le code corrigé. Base : ${BASE} — payeur ${account.address} — dépense nominale ${depense.toFixed(2)} $ (les 400/404 annulent le paiement par construction).`,
  "",
  "| Appel | Chemin | Attendu | HTTP | Verdict |",
  "|---|---|---|---|---|",
  ...resultats.map((r) => `| ${r.nom} | \`${r.chemin}\` | ${r.attendu} | ${r.statut} | ${r.ok ? "✓" : "✗"} ${r.details} |`),
  "",
].join("\n"));
console.log(`\n${resultats.filter((r) => r.ok).length}/${resultats.length} conformes — dépense nominale ${depense.toFixed(2)} $ — dossier ${dossier}`);
process.exit(resultats.every((r) => r.ok) ? 0 : 1);
