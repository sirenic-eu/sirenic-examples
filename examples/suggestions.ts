/**
 * `GET /v1/suggestions` — autocomplete GRATUIT nom → SIREN.
 *
 * Aucun wallet, aucune clé, aucun compte : c'est tout l'intérêt de la route.
 * Ce script sert donc DEUX rôles :
 *   1. l'exemple d'intégration (résoudre un nom, puis enchaîner sur un achat) ;
 *   2. la vérification de livraison. La règle CDU « tout test conserve ses
 *      résultats » s'applique même sans paiement : les réponses réelles sont
 *      écrites dans resultats/<horodatage>/.
 *
 *   npx tsx examples/suggestions.ts            # production
 *   SIRENIC_URL=http://127.0.0.1:3000 npx tsx examples/suggestions.ts
 *
 * Ce qui est vérifié, et pas seulement affiché :
 *   - une marque connue se résout (CARREFOUR → un SIREN de 9 chiffres) ;
 *   - la correspondance par MOT ENTIER fonctionne (« agricole » → CRÉDIT
 *     AGRICOLE), donc le deuxième étage de recherche est bien branché ;
 *   - un SIREN collé est accepté tel quel ;
 *   - le plafond de 5 est tenu ;
 *   - la route est bien GRATUITE (jamais de 402, aucun en-tête de paiement) ;
 *   - une saisie trop courte rend 400 et ne parle pas de paiement ;
 *   - AUCUNE réponse ne contient de champ signature/provenance : le gratuit ne
 *     prétend pas être une donnée signée.
 */
import { mkdirSync, writeFileSync } from "node:fs";

const api = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `/home/ubuntu/sirenic-examples/resultats/suggestions-${horodatage}`;
mkdirSync(dossier, { recursive: true });

interface Suggestion {
  siren: string;
  denomination: string | null;
  code_postal: string | null;
  commune: string | null;
  code_naf: string | null;
  actif: boolean | null;
}
interface Reponse {
  suggestions: Suggestion[];
  gratuit?: boolean;
  limite?: number;
  source?: string;
}

const echecs: string[] = [];
const verifier = (condition: boolean, quoi: string): void => {
  console.log(`${condition ? "  ok  " : " ÉCHEC"} ${quoi}`);
  if (!condition) echecs.push(quoi);
};

async function suggerer(q: string): Promise<{ statut: number; corps: unknown; entetes: Headers }> {
  const r = await fetch(`${api}/v1/suggestions?q=${encodeURIComponent(q)}`);
  const brut = await r.text();
  writeFileSync(
    `${dossier}/${q.replace(/[^a-z0-9]+/gi, "-")}.json`,
    `HTTP ${r.status}\n${brut}\n`,
  );
  let corps: unknown = brut;
  try {
    corps = JSON.parse(brut);
  } catch {
    /* réponse non-JSON conservée telle quelle dans le fichier */
  }
  return { statut: r.status, corps, entetes: r.headers };
}

// --- 1. une marque connue -------------------------------------------------
const carrefour = await suggerer("carrefour");
console.log(`GET /v1/suggestions?q=carrefour → HTTP ${carrefour.statut}`);
verifier(carrefour.statut === 200, "HTTP 200 sans aucun paiement");
verifier(
  ((carrefour.corps as Reponse).suggestions ?? []).some((s) => s.siren === "652014051"),
  "le VRAI Carrefour (652014051, grande entreprise) est dans la liste",
);
verifier(carrefour.statut !== 402, "la route n'exige JAMAIS de paiement");
verifier(
  carrefour.entetes.get("payment-required") === null,
  "aucun en-tête PAYMENT-REQUIRED (route hors grille tarifaire)",
);
const c = carrefour.corps as Reponse;
verifier(c.gratuit === true, "la réponse s'annonce `gratuit: true`");
verifier(Array.isArray(c.suggestions) && c.suggestions.length > 0, "au moins une suggestion");
verifier(
  (c.suggestions ?? []).every((s) => /^\d{9}$/.test(s.siren)),
  "chaque suggestion porte un SIREN de 9 chiffres",
);
verifier((c.suggestions ?? []).length <= 5, "plafond de 5 suggestions tenu");
verifier(
  !JSON.stringify(c).includes("provenance"),
  "aucun bloc provenance (réservé aux réponses payantes)",
);
// La réponse gratuite est SIGNÉE quand même : middlewareAttestation est monté
// sur tout /v1, pas seulement sur le payant. C'est une propriété, pas un
// accident — une suggestion gratuite reste vérifiable hors ligne.
verifier(
  carrefour.entetes.get("x-sirenic-signature") !== null,
  "la réponse gratuite est tout de même signée Ed25519 (en-têtes)",
);
console.log(
  (c.suggestions ?? [])
    .map((s) => `      ${s.siren}  ${s.denomination} — ${s.commune ?? "?"} (${s.code_naf ?? "?"})`)
    .join("\n"),
);

// --- 2. un mot commun rend quelque chose ---------------------------------
// NB : sur la base réelle, « agricole » est déjà le DÉBUT de dizaines de
// dénominations (« AGRICOLE 33 »…), donc l'étage préfixe suffit à remplir les
// cinq places et l'étage plein texte ne tourne même pas. Ce contrôle vérifie
// donc la réponse, pas l'étage — c'est le test unitaire du dépôt (fixture
// « CREDIT AGRICOLE SA », qu'aucun préfixe ne peut atteindre) qui prouve le
// second étage.
const agricole = await suggerer("agricole");
const a = agricole.corps as Reponse;
verifier(
  agricole.statut === 200 && (a.suggestions ?? []).length > 0,
  "un mot commun (« agricole ») rend des résultats",
);

// --- 3. un SIREN collé dans le champ -------------------------------------
const parSiren = await suggerer("552032534");
const s = parSiren.corps as Reponse;
verifier(
  parSiren.statut === 200 && s.suggestions?.[0]?.siren === "552032534",
  "un SIREN collé est résolu directement (DANONE)",
);

// --- 4. saisie trop courte -----------------------------------------------
const courte = await suggerer("ab");
verifier(courte.statut === 400, "une saisie de 2 caractères rend 400");
verifier(
  !JSON.stringify(courte.corps).toLowerCase().includes("paiement"),
  "le 400 ne parle pas de paiement (rien n'est facturé ici)",
);

// --- 5. ce que le gratuit ne fait PAS ------------------------------------
// La tolérance aux fautes de frappe reste vendue sur /v1/recherche : « danonne »
// ne doit rien rendre ici. C'est la frontière produit, elle se vérifie.
const faute = await suggerer("danonne");
const f = faute.corps as Reponse;
verifier(
  faute.statut === 200 && (f.suggestions ?? []).length === 0,
  "une faute de frappe ne rend rien (le flou reste vendu sur /v1/recherche)",
);

writeFileSync(
  `${dossier}/recap.txt`,
  [
    `Vérification GRATUITE de /v1/suggestions — ${new Date().toISOString()}`,
    `API : ${api}`,
    `Contrôles : ${5 + 11 - echecs.length} ok, ${echecs.length} en échec`,
    ...echecs.map((e) => `ÉCHEC : ${e}`),
    "",
    "Aucun paiement : cette route est hors grille tarifaire.",
  ].join("\n"),
);

console.log(`\nRésultats conservés dans ${dossier}`);
if (echecs.length > 0) {
  console.error(`${echecs.length} contrôle(s) en échec`);
  process.exit(1);
}
console.log("Tout est vert.");
