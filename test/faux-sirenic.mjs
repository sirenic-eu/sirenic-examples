/**
 * Faux serveur Sirenic, local et sans réseau, pour jouer les exemples de
 * vérification de signature sur une rotation de clés simulée (ticket 325 de
 * kopko13/sirenic). Aucun 402 n'est servi : un exemple qui paie par x402 reçoit
 * directement sa réponse en 200, rien n'est signé ni réglé côté portefeuille.
 *
 * Il sert, sur 127.0.0.1 et un port libre :
 *   - /.well-known/sirenic-signing-key : les octets du document des clés donné ;
 *   - toute route de `reponses` (chemin sans requête) : son corps et ses en-têtes ;
 *   - /verifier/<numéro> : le reçu de `recus`, sinon un 404 « inconnue » comme l'API.
 * Chaque requête reçue est journalisée (`requetes`), pour vérifier qu'aucune ne
 * porte un en-tête de paiement.
 *
 * Réutilisable hors du test : une preuve peut servir des corps conservés, avec
 * leurs en-têtes d'origine, derrière un document des clés après rotation.
 */
import { createServer } from "node:http";
import { createHash, generateKeyPairSync, sign } from "node:crypto";

const SCOPE =
  "Every 2xx /v1 response. Hash the raw response body bytes (sha256, base64), rebuild the signed message with the kid and timestamp headers, then verify the Ed25519 signature header against the public_key of the entry of keys whose kid is the key id header (kid and public_key above are the key signing today).";
const SCOPE_SANS_KEYS =
  "Every 2xx /v1 response. Hash the raw response body bytes (sha256, base64), rebuild the signed message with the kid and timestamp headers, then verify the Ed25519 signature header against this public key.";
const KEYS_POLICY =
  "keys lists every key that has ever signed a response, and an entry is never removed: a response signed months or years ago verifies with the entry of its kid. valid_from and valid_until are UTC days bounding, inclusively, when the key may have signed (valid_from is a lower bound); valid_until is null while the key may still sign.";

/** Le kid d'une clé publique : les 16 premiers hexadécimaux du SHA-256 de sa forme SPKI DER (recette publiée). */
export function kidDe(spkiDer) {
  return createHash("sha256").update(spkiDer).digest("hex").slice(0, 16);
}

/** Une paire Ed25519 de test, tirée au hasard : `{ kid, public_key (SPKI DER en base64), privateKey }`. */
export function nouvelleCle() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { kid: kidDe(spki), public_key: spki.toString("base64"), privateKey };
}

/** Les trois en-têtes de signature d'un corps, signé par `cle` sous `kid` (par défaut le sien). */
export function signer(cle, corps, horodatage, kid = cle.kid) {
  const condensat = createHash("sha256").update(corps).digest("base64");
  const message = Buffer.from(`sirenic-v1:${kid}:${horodatage}:${condensat}`, "utf8");
  return {
    "X-Sirenic-Key-Id": kid,
    "X-Sirenic-Timestamp": horodatage,
    "X-Sirenic-Signature": sign(null, message, cle.privateKey).toString("base64"),
  };
}

/**
 * Le document des clés, en JSON compact et dans l'ordre exact des champs de l'API :
 * la racine (`kid`, `alg`, `public_key`, `public_key_format`, `signed_message`, `headers`, `scope`),
 * puis `keys` (`kid`, `alg`, `public_key`, `valid_from`, `valid_until`) et `keys_policy`.
 * `keys` à `null` : la forme d'avant le 02/10/2026, sans `keys` ni `keys_policy`.
 */
export function documentDesCles({ racine, keys }) {
  const document = {
    kid: racine.kid,
    alg: "Ed25519",
    public_key: racine.public_key,
    public_key_format: "SPKI DER, base64",
    signed_message: "sirenic-v1:{kid}:{timestamp}:{body_sha256_base64}",
    headers: { key_id: "X-Sirenic-Key-Id", timestamp: "X-Sirenic-Timestamp", signature: "X-Sirenic-Signature" },
    scope: keys === null ? SCOPE_SANS_KEYS : SCOPE,
  };
  if (keys !== null) {
    document.keys = keys.map(({ kid, public_key, valid_from, valid_until }) => ({
      kid,
      alg: "Ed25519",
      public_key,
      valid_from,
      valid_until,
    }));
    document.keys_policy = KEYS_POLICY;
  }
  return JSON.stringify(document);
}

const JSON_UTF8 = "application/json; charset=utf-8";

/**
 * Démarre le faux serveur. `document` : octets ou texte du document des clés ;
 * `reponses` : { "/v1/...": { corps, entetes, statut?, type? } } ;
 * `recus` : { "<numéro>": { corps, statut?, type? } }.
 * Rend `{ url, requetes, fermer }`.
 */
export async function demarrerFauxSirenic({ document, reponses = {}, recus = {} }) {
  const requetes = [];
  const envoyer = (res, statut, entetes, corps) => {
    res.writeHead(statut, entetes);
    res.end(corps);
  };
  const serveur = createServer((req, res) => {
    const chemin = new URL(req.url ?? "/", "http://faux-sirenic").pathname;
    requetes.push({ methode: req.method, chemin, entetes: { ...req.headers } });
    if (chemin === "/.well-known/sirenic-signing-key") {
      envoyer(res, 200, { "Content-Type": JSON_UTF8 }, document);
      return;
    }
    if (chemin.startsWith("/verifier/")) {
      const recu = recus[decodeURIComponent(chemin.slice("/verifier/".length))];
      if (!recu) {
        envoyer(res, 404, { "Content-Type": JSON_UTF8 }, JSON.stringify({ verdict: "inconnue", numero: null }));
        return;
      }
      const corps = typeof recu.corps === "string" ? recu.corps : JSON.stringify(recu.corps);
      envoyer(res, recu.statut ?? 200, { "Content-Type": recu.type ?? JSON_UTF8 }, corps);
      return;
    }
    const reponse = reponses[chemin];
    if (reponse) {
      envoyer(res, reponse.statut ?? 200, { "Content-Type": reponse.type ?? JSON_UTF8, ...reponse.entetes }, reponse.corps);
      return;
    }
    envoyer(res, 404, { "Content-Type": JSON_UTF8 }, JSON.stringify({ error: "not_found" }));
  });
  await new Promise((pret) => serveur.listen(0, "127.0.0.1", pret));
  const adresse = serveur.address();
  const port = typeof adresse === "object" && adresse ? adresse.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    requetes,
    fermer: () =>
      new Promise((fini) => {
        serveur.closeAllConnections();
        serveur.close(() => fini());
      }),
  };
}
