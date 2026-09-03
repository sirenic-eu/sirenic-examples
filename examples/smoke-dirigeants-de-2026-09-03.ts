/**
 * Smoke PAYANT — transactions de dirigeants ALLEMANDES (BaFin, art. 19 MAR).
 *
 *   npx tsx --env-file=.env.wallet-test examples/smoke-dirigeants-de-2026-09-03.ts
 *
 * COÛT ANNONCÉ : **0,04 $** — deux appels payés à 0,02 $ (le même émetteur par
 * LEI puis par ISIN). Le troisième appel est un identifiant mal formé : il DOIT
 * rendre 400 sans débit, c'est justement ce qu'on vérifie.
 *
 * POURQUOI CE SMOKE EXISTE, ET POURQUOI SI TARD. La tranche allemande est en
 * production depuis le 15/08/2026, mais elle n'a **jamais** été éprouvée par un
 * achat réel : le smoke de la vitrine ne portait qu'une ligne belge pour cette
 * route. L'écart a été constaté le 03/09 en bouclant la Definition of Done de la
 * tranche FRANÇAISE, et CDU a tranché : on l'achète. Un devis 402 qui s'affiche
 * ne prouve pas qu'une route est achetable — seul un achat le prouve.
 *
 * Émetteur choisi : **Zalando SE** (LEI 529900YRFFGH5AXU4S86, ISIN DE000ZAL1111).
 * Choisi dans le stock réel, avec **au moins 3 déclarants distincts sur 12 mois**,
 * pour que la ventilation par catégorie soit effectivement servie — sous ce seuil
 * elle est masquée, et le smoke ne prouverait rien sur le k-anonymat.
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

const LEI = "529900YRFFGH5AXU4S86";
const ISIN = "DE000ZAL1111";
const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `/home/ubuntu/sirenic-examples/resultats/smoke-dirigeants-de-${horodatage}`;
mkdirSync(dossier, { recursive: true });

const echecs: string[] = [];
const verifier = (ok: boolean, quoi: string): void => {
  console.log(`${ok ? "  ok  " : " ÉCHEC"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};

/** Le devis annoncé AVANT paiement, lu dans l'en-tête PAYMENT-REQUIRED signé. */
async function devisAnnonce(url: string): Promise<number | null> {
  const r = await fetch(url);
  const entete = r.headers.get("payment-required");
  if (!entete) return null;
  const d = JSON.parse(Buffer.from(entete, "base64").toString()) as {
    accepts?: Array<{ amount?: string }>;
  };
  return Number(d.accepts?.[0]?.amount ?? NaN);
}

interface Notification {
  type_transaction?: string;
  instrument?: string;
  lieu?: string | null;
  prix?: number | null;
  montant?: number | null;
  devise?: string | null;
  quantite?: number | null;
  categorie_declarant?: string | null;
  date_publication?: string;
}
interface Corps {
  pays?: string;
  id?: string;
  denomination?: string;
  identifiants?: { lei?: string | null; isin?: string[] };
  periode?: { depuis?: string; jusqu_a?: string };
  synthese?: {
    nb_notifications?: number;
    nb_achats?: number;
    nb_ventes?: number;
    nb_autres?: number;
    montant_achats_eur?: number;
    montant_ventes_eur?: number;
    montant_net_eur?: number;
    nb_notifications_montant_hors_eur?: number;
    nb_declarants_distincts?: number;
    date_derniere_notification?: string | null;
  };
  note_montants?: string | null;
  par_categorie_declarant?: Array<{ categorie?: string | null; nb?: number }> | null;
  ventilation_masquee?: string | null;
  notifications?: Notification[];
  source?: string;
  disclaimer?: string;
  data_freshness?: string;
  provenance?: unknown[];
  error?: string;
}

async function acheter(nom: string, url: string): Promise<{ statut: number; corps: Corps; devis: number | null; regle: string | null }> {
  const devis = await devisAnnonce(url);
  const r = await payer(url);
  const brut = await r.text();
  writeFileSync(`${dossier}/${nom}.json`, `HTTP ${r.status}\ndevis annoncé: ${devis}\n${brut}\n`);
  const regle = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  writeFileSync(`${dossier}/${nom}-reglement.txt`, String(regle ?? "(aucun en-tête de règlement)"));
  console.log(`\n${nom} → HTTP ${r.status} (devis annoncé ${devis} unités atomiques)`);
  let corps: Corps = {};
  try {
    corps = JSON.parse(brut) as Corps;
  } catch {
    /* corps non-JSON : conservé sur disque, les vérifications diront quoi */
  }
  return { statut: r.status, corps, devis, regle };
}

/** Listes FERMÉES du socle commun — servir autre chose serait un défaut RGPD. */
const CATEGORIES = new Set([
  "organe_administration",
  "cadre_superieur",
  "personne_liee_organe",
  "personne_liee_cadre",
  "personne_liee",
]);
const TYPES = new Set(["acquisition", "cession", "autre"]);

const chemin = (id: string): string => `${api}/v1/eu/entreprise/DE/${id}/transactions-dirigeants`;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Achat par LEI — le cas nominal
// ─────────────────────────────────────────────────────────────────────────────
const parLei = await acheter("01-par-lei", chemin(LEI));
verifier(parLei.statut === 200, "achat par LEI → 200");
verifier(parLei.devis === 20000, `devis annoncé = 20000 unités (0,02 $) — lu ${parLei.devis}`);
verifier(Boolean(parLei.regle), "en-tête de règlement présent (le paiement a été réglé)");
verifier(parLei.corps.pays === "DE", "pays = DE");
verifier(Boolean(parLei.corps.denomination), `dénomination servie (${parLei.corps.denomination ?? "—"})`);

const s = parLei.corps.synthese ?? {};
verifier((s.nb_notifications ?? 0) > 0, `notifications servies (${s.nb_notifications ?? 0})`);
// Cohérence interne : la somme des trois sens DOIT faire le total. `nb_autres`
// a été ajouté le 15/08 précisément parce que son absence rendait la synthèse
// illisible (SAP : 49 notifications, 6 achats, 1 vente).
verifier(
  (s.nb_achats ?? 0) + (s.nb_ventes ?? 0) + (s.nb_autres ?? 0) === (s.nb_notifications ?? -1),
  `nb_achats + nb_ventes + nb_autres = nb_notifications (${s.nb_achats}+${s.nb_ventes}+${s.nb_autres} vs ${s.nb_notifications})`,
);
verifier(
  Math.abs((s.montant_net_eur ?? 0) - ((s.montant_achats_eur ?? 0) - (s.montant_ventes_eur ?? 0))) < 0.02,
  "montant_net_eur = achats − ventes",
);
verifier((s.nb_declarants_distincts ?? 0) >= 3, `≥ 3 déclarants distincts (${s.nb_declarants_distincts}) — la ventilation doit donc être servie`);

// Le k-anonymat : au-dessus du seuil, la ventilation existe ; ses catégories
// sont dans la liste fermée ; et une catégorie fondue l'est AUSSI dans le détail.
verifier(Array.isArray(parLei.corps.par_categorie_declarant), "ventilation par catégorie servie");
const categoriesServies = (parLei.corps.par_categorie_declarant ?? []).map((c) => c.categorie);
verifier(
  categoriesServies.every((c) => c === null || CATEGORIES.has(String(c))),
  `catégories toutes en liste fermée (${categoriesServies.join(", ") || "—"})`,
);
verifier(parLei.corps.ventilation_masquee == null, "ventilation_masquee absente (cohérent avec ≥ 3 déclarants)");

const notifs = parLei.corps.notifications ?? [];
verifier(notifs.length > 0, `détail des notifications servi (${notifs.length})`);
verifier(notifs.every((n) => TYPES.has(String(n.type_transaction))), "type_transaction toujours en liste fermée");
// L'Allemagne ne publie AUCUN nombre de titres : `quantite` doit être null, et
// surtout jamais déduite de montant ÷ prix — ce serait une donnée fabriquée.
verifier(notifs.every((n) => n.quantite === null), "quantite null sur TOUTES les lignes (BaFin ne publie pas le nombre de titres)");
// Aucune personne nommée : les seules chaînes libres possibles seraient là.
const champsAttendus = new Set([
  "date_publication", "date_transaction", "type_transaction", "instrument", "lieu",
  "prix", "montant", "devise", "categorie_declarant", "quantite",
]);
const champsInattendus = [...new Set(notifs.flatMap((n) => Object.keys(n)))].filter((c) => !champsAttendus.has(c));
verifier(champsInattendus.length === 0, `aucun champ inattendu dans le détail (${champsInattendus.join(", ") || "aucun"})`);

// Devises : si des montants hors euro ont été écartés des totaux, la réponse
// DOIT le dire. Précédent NYXOAH : 7,8 M€ de faux montant servis parce qu'un
// champ nommé `_eur` sommait toutes les devises.
const horsEur = s.nb_notifications_montant_hors_eur ?? 0;
verifier(
  horsEur === 0 ? parLei.corps.note_montants == null : Boolean(parLei.corps.note_montants),
  `note_montants cohérente avec ${horsEur} montant(s) hors euro`,
);

verifier(/bafin/i.test(String(parLei.corps.source)), "attribution BaFin dans `source`");
verifier(/aucune personne n'est nommée|no individual is named/i.test(String(parLei.corps.disclaimer)), "disclaimer : aucune personne nommée");
verifier(Boolean(parLei.corps.data_freshness), `fraîcheur annoncée (${parLei.corps.data_freshness ?? "—"})`);
verifier(Array.isArray(parLei.corps.provenance) && parLei.corps.provenance.length > 0, "bloc provenance servi");

// ─────────────────────────────────────────────────────────────────────────────
// 2. Achat par ISIN — même émetteur, même agrégat
// ─────────────────────────────────────────────────────────────────────────────
const parIsin = await acheter("02-par-isin", chemin(ISIN));
verifier(parIsin.statut === 200, "achat par ISIN → 200");
verifier(
  JSON.stringify(parIsin.corps.synthese) === JSON.stringify(parLei.corps.synthese),
  "ISIN et LEI rendent la MÊME synthèse (l'agrégat porte l'émetteur, pas la ligne de cotation)",
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Identifiant mal formé — 400, et SURTOUT aucun débit
// ─────────────────────────────────────────────────────────────────────────────
// Un SIREN : la forme que tout le reste de l'offre française accepte, et que
// cette route doit refuser. Le paywall passe AVANT la validation, donc le
// middleware doit ANNULER le paiement — personne ne paie un 400.
const malForme = await acheter("03-identifiant-mal-forme", chemin("490586708"));
verifier(malForme.statut === 400, `identifiant mal formé → 400 (lu ${malForme.statut})`);
verifier(malForme.corps.error === "parametre_invalide", `code d'erreur parametre_invalide (lu ${malForme.corps.error ?? "—"})`);
verifier(!malForme.regle, "AUCUN règlement sur le 400 — le paiement a bien été annulé");

// ─────────────────────────────────────────────────────────────────────────────
// 4. Attendu permanent de la procédure : HEAD ne s'exécute pas
// ─────────────────────────────────────────────────────────────────────────────
const tete = await fetch(chemin(LEI), { method: "HEAD" });
verifier(tete.status === 405, `HEAD → 405 (lu ${tete.status})`);
verifier(/GET/.test(tete.headers.get("allow") ?? ""), `en-tête Allow présent (${tete.headers.get("allow") ?? "—"})`);

// ─────────────────────────────────────────────────────────────────────────────
const resume = [
  `Smoke dirigeants DE (BaFin) — ${new Date().toISOString()}`,
  `émetteur : ${parLei.corps.denomination ?? "?"} (LEI ${LEI}, ISIN ${ISIN})`,
  `appels payés : 2 × 0,02 $ = 0,04 $ ; 1 appel en 400 non débité`,
  `notifications servies : ${s.nb_notifications} (${s.nb_achats} achats, ${s.nb_ventes} ventes, ${s.nb_autres} autres)`,
  `déclarants distincts : ${s.nb_declarants_distincts} · catégories servies : ${categoriesServies.join(", ") || "—"}`,
  `flux net : ${s.montant_net_eur} € · hors euro écartés : ${horsEur}`,
  `fraîcheur : ${parLei.corps.data_freshness}`,
  ``,
  echecs.length === 0 ? "RÉSULTAT : tous les contrôles au vert." : `RÉSULTAT : ${echecs.length} ÉCHEC(S)`,
  ...echecs.map((e) => `  - ${e}`),
].join("\n");
writeFileSync(`${dossier}/RESUME.txt`, `${resume}\n`);
console.log(`\n${resume}\n\nRésultats conservés : ${dossier}`);
process.exit(echecs.length === 0 ? 0 : 1);
