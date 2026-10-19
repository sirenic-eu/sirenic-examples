/**
 * Rotation simulée des clés de signature (ticket 325 de kopko13/sirenic).
 *
 * Le jour où Sirenic change de clé, une réponse signée avant doit toujours se
 * vérifier : `/.well-known/sirenic-signing-key` garde chaque clé qui a jamais
 * signé dans `keys`, avec ses jours d'usage. Ce test joue les MÊMES vecteurs sur
 * les trois copies de la recette de la vitrine : examples/verify-signature.ts et
 * examples/verify-invoice-file.ts, lancés tels quels contre un faux serveur
 * local (test/faux-sirenic.mjs), et la fonction `verifierLivraison` de
 * examples/verifier-livraison-webhook.mjs, importée sans rien exécuter.
 *
 * Aucun réseau, aucun paiement : le faux serveur écoute sur 127.0.0.1 et ne sert
 * jamais de 402 ; la clé de portefeuille passée aux exemples est tirée au hasard
 * et jamais financée ; le test exige qu'aucune requête ne porte un en-tête de
 * paiement. Les clés Ed25519 sont tirées au lancement, jamais une constante.
 *
 * Le fuseau est UTC+14 : un exemple qui lirait le jour d'un horodatage en heure
 * locale se tromperait de jour sur les bornes, et le test le verrait.
 *
 * Lancer : npm test
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { demarrerFauxSirenic, documentDesCles, nouvelleCle, signer } from "./faux-sirenic.mjs";

process.env.TZ = "Pacific/Kiritimati";
const FUSEAU = "Pacific/Kiritimati";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const TSX = join(RACINE, "node_modules", ".bin", "tsx");
const TIRET_LONG = String.fromCharCode(0x2014);
const FICHIERS = [
  "examples/verify-signature.ts",
  "examples/verify-invoice-file.ts",
  "examples/verifier-livraison-webhook.mjs",
  "test/faux-sirenic.mjs",
  "test/rotation-cles.test.mjs",
];

// --- Les clés et les documents --------------------------------------------
const ANCIENNE = nouvelleCle();
const NEUVE = nouvelleCle();
const INCONNUE = nouvelleCle();

const entree = (cle, valid_from, valid_until) => ({ kid: cle.kid, public_key: cle.public_key, valid_from, valid_until });

/** Après la rotation : l'ancienne clé a signé du 20/07 au 03/10, la neuve depuis le 03/10 et sert la racine. */
const APRES_ROTATION = documentDesCles({
  racine: NEUVE,
  keys: [entree(ANCIENNE, "2026-07-20", "2026-10-03"), entree(NEUVE, "2026-10-03", null)],
});
/** Le document d'aujourd'hui : une seule clé, ouverte, en racine. */
const UNE_CLE = documentDesCles({ racine: ANCIENNE, keys: [entree(ANCIENNE, "2026-07-20", null)] });
/** Un document archivé d'avant le 02/10/2026 : la racine seule, sans `keys`. */
const SANS_KEYS = documentDesCles({ racine: ANCIENNE, keys: null });
/** `keys` présent mais vide : c'est un document AVEC keys, la racine n'y sert jamais. */
const KEYS_VIDE = documentDesCles({ racine: NEUVE, keys: [] });

// --- Les corps (forme réelle des exemples de réponse) ----------------------
const lireReponse = (fichier) => JSON.parse(readFileSync(join(RACINE, "examples/responses", fichier), "utf8")).response;
const CORPS_SANCTIONS = Buffer.from(
  JSON.stringify({
    ...lireReponse("sanctions-check.json"),
    provenance: [
      {
        bloc: "sanctions",
        source_code: "ue_fsf",
        registre: "Liste consolidée des sanctions financières de l'UE (FSF)",
        mode: "stock",
        as_of: "2026-07-28",
        precision_as_of: "publication_officielle",
      },
    ],
  }),
  "utf8",
);
const CORPS_FACTURATION = Buffer.from(JSON.stringify(lireReponse("facturation-dossier.json")), "utf8");
const CORPS_LIVRAISON = Buffer.from(
  JSON.stringify({ evenements: [{ siren: "552032534", type: "changement_adresse", date: "2026-09-05" }] }),
  "utf8",
);

// --- Les vecteurs, joués sur chaque copie ----------------------------------
// attendu : valide | racine (valide par la racine d'un document sans keys) | fenetre | kid | kid-racine | signature | horodatage
const CAS = [
  { nom: "rotation : réponse signée par l'ancienne clé, dans sa fenêtre", document: APRES_ROTATION, cle: ANCIENNE, horodatage: "2026-09-05T22:02:34.793Z", attendu: "valide" },
  { nom: "rotation : premier jour de l'ancienne clé (valid_from, borne incluse)", document: APRES_ROTATION, cle: ANCIENNE, horodatage: "2026-07-20T00:00:00.000Z", attendu: "valide" },
  { nom: "rotation : dernier jour de l'ancienne clé à 23:58 UTC (valid_until, borne incluse, déjà le lendemain en UTC+14)", document: APRES_ROTATION, cle: ANCIENNE, horodatage: "2026-10-03T23:58:00.000Z", attendu: "valide" },
  { nom: "rotation : réponse de la clé neuve", document: APRES_ROTATION, cle: NEUVE, horodatage: "2026-10-19T10:00:00.000Z", attendu: "valide" },
  { nom: "veille de valid_from, signée par la bonne clé (déjà valid_from en UTC+14)", document: APRES_ROTATION, cle: ANCIENNE, horodatage: "2026-07-19T23:59:59.999Z", attendu: "fenetre" },
  { nom: "lendemain de valid_until, signée par la bonne clé", document: APRES_ROTATION, cle: ANCIENNE, horodatage: "2026-10-04T00:00:00.000Z", attendu: "fenetre" },
  { nom: "kid absent de keys", document: APRES_ROTATION, cle: INCONNUE, horodatage: "2026-09-05T22:02:34.793Z", attendu: "kid" },
  { nom: "un octet du corps changé", document: APRES_ROTATION, cle: ANCIENNE, horodatage: "2026-09-05T22:02:34.793Z", alterer: true, attendu: "signature" },
  { nom: "signature de l'autre clé sous le kid servi", document: APRES_ROTATION, cle: NEUVE, kid: ANCIENNE.kid, horodatage: "2026-09-05T22:02:34.793Z", attendu: "signature" },
  { nom: "horodatage mal formé (sans Z)", document: APRES_ROTATION, cle: ANCIENNE, horodatage: "2026-09-05T22:02:34.793", attendu: "horodatage" },
  { nom: "document du jour à une seule clé", document: UNE_CLE, cle: ANCIENNE, horodatage: "2026-10-19T08:49:24.561Z", attendu: "valide" },
  { nom: "document sans keys, kid de la racine (archive d'avant le 02/10)", document: SANS_KEYS, cle: ANCIENNE, horodatage: "2026-09-05T22:02:34.793Z", attendu: "racine" },
  { nom: "document sans keys, autre kid que la racine", document: SANS_KEYS, cle: NEUVE, horodatage: "2026-09-05T22:02:34.793Z", attendu: "kid-racine" },
  { nom: "keys présent mais vide : jamais la racine", document: KEYS_VIDE, cle: NEUVE, horodatage: "2026-10-19T10:00:00.000Z", attendu: "kid" },
];

/** Les en-têtes et le corps servis pour un cas : signé comme dit, puis altéré d'un octet s'il le faut. */
function servi(cas, corps) {
  const entetes = signer(cas.cle, corps, cas.horodatage, cas.kid);
  if (!cas.alterer) return { corps, entetes };
  const altere = Buffer.from(corps);
  const i = Math.floor(altere.length / 2);
  altere[i] = altere[i] === 0x41 ? 0x42 : 0x41;
  return { corps: altere, entetes };
}

// Motifs des deux exemples en anglais.
const MOTIFS_TS = {
  fenetre: /outside the validity window/,
  kid: /not published in keys/,
  "kid-racine": /not the root key/,
  signature: /INVALID signature/,
  horodatage: /malformed timestamp/,
};
// Motifs du script webhook, en français.
const MOTIFS_WEBHOOK = {
  fenetre: /hors de la fenêtre/,
  kid: /non publié dans keys/,
  "kid-racine": /racine/,
  signature: /signature invalide/,
  horodatage: /mal formé/,
};

/** Lance un exemple .ts contre le faux serveur, sans autre environnement que le nécessaire. */
function lancer(script, env) {
  return new Promise((fini) => {
    execFile(
      TSX,
      [script],
      {
        cwd: RACINE,
        timeout: 60_000,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TZ: FUSEAU,
          NO_COLOR: "1",
          // Jamais financée : le faux serveur ne sert aucun 402, rien n'est signé ni réglé.
          TEST_WALLET_KEY: `0x${randomBytes(32).toString("hex")}`,
          ...env,
        },
      },
      (erreur, stdout, stderr) => {
        const code = erreur ? (typeof erreur.code === "number" ? erreur.code : -1) : 0;
        fini({ code, sortie: `${stdout}\n${stderr}`, tue: Boolean(erreur?.killed) });
      },
    );
  });
}

/** Aucune requête reçue par le faux ne porte un en-tête de paiement x402. */
function sansPaiement(requetes) {
  for (const r of requetes) {
    for (const nom of ["x-payment", "payment-signature"]) {
      assert.equal(r.entetes[nom], undefined, `en-tête de paiement ${nom} envoyé sur ${r.chemin}`);
    }
  }
}

/** Juge la sortie d'un exemple .ts selon l'attendu du cas. */
function jugerSortieTs(cas, { code, sortie, tue }) {
  assert.equal(tue, false, `exemple coupé par le délai :\n${sortie}`);
  if (cas.attendu === "valide" || cas.attendu === "racine") {
    assert.match(sortie, /signature valid/, sortie);
    if (cas.attendu === "racine") {
      assert.match(sortie, /root key/, sortie);
      assert.match(sortie, /no validity window/, sortie);
    }
    return;
  }
  assert.notEqual(code, 0, `refus attendu (${cas.attendu}), sortie 0 :\n${sortie}`);
  assert.doesNotMatch(sortie, /signature valid/, sortie);
  assert.match(sortie, MOTIFS_TS[cas.attendu], sortie);
}

const dossiersTemporaires = [];
after(() => {
  for (const d of dossiersTemporaires) rmSync(d, { recursive: true, force: true });
});
const dossierTemporaire = () => {
  const d = mkdtempSync(join(tmpdir(), "sirenic-t325-"));
  dossiersTemporaires.push(d);
  return d;
};

// --- examples/verify-signature.ts ------------------------------------------
describe("examples/verify-signature.ts : rotation simulée", { concurrency: 4 }, () => {
  for (const cas of CAS) {
    test(cas.nom, async () => {
      const { corps, entetes } = servi(cas, CORPS_SANCTIONS);
      const faux = await demarrerFauxSirenic({ document: cas.document, reponses: { "/v1/sanctions/check": { corps, entetes } } });
      try {
        const resultat = await lancer("examples/verify-signature.ts", { SIRENIC_URL: faux.url });
        jugerSortieTs(cas, resultat);
        if (cas.attendu === "valide" || cas.attendu === "racine") assert.equal(resultat.code, 0, resultat.sortie);
        sansPaiement(faux.requetes);
      } finally {
        await faux.fermer();
      }
    });
  }
});

// --- Le reçu public GET /verifier/<numéro> dans verify-signature.ts ---------
describe("examples/verify-signature.ts : le reçu public", { concurrency: 4 }, () => {
  const HORODATAGE = "2026-10-19T10:00:00.000Z";
  const NUMERO = "0f1e2d3c4b5a6978";
  const entetes = { ...signer(NEUVE, CORPS_SANCTIONS, HORODATAGE), "X-Sirenic-Verification-Id": NUMERO };
  const condensat = createHash("sha256").update(CORPS_SANCTIONS).digest("base64");
  const AUTRE_CONDENSAT = createHash("sha256").update("autre").digest("base64");
  /** Un reçu `valide` ; `ecarts` remplace un seul champ de sa signature, pour juger chaque comparaison seule. */
  const recuValide = (ecarts = {}) => ({
    verdict: "valide",
    numero: NUMERO,
    emise_le: HORODATAGE,
    route: "/v1/sanctions/check",
    sujet: null,
    signature: {
      kid: NEUVE.kid,
      corps_sha256: condensat,
      valeur: entetes["X-Sirenic-Signature"],
      message_signe: `sirenic-v1:${NEUVE.kid}:${HORODATAGE}:${condensat}`,
      cle: { kid: NEUVE.kid, etat: "en_service", valid_from: "2026-10-03", valid_until: null },
      ...ecarts,
    },
  });
  const RECUS = [
    { nom: "reçu valide, même empreinte, même kid, même message : sortie 0", entetes, recus: { [NUMERO]: { corps: recuValide() } }, code: 0, motif: /receipt verdict: valide/ },
    { nom: "reçu valide d'une autre réponse (empreinte et message différents) : sortie 1, la signature reste valide", entetes, recus: { [NUMERO]: { corps: recuValide({ corps_sha256: AUTRE_CONDENSAT, message_signe: `sirenic-v1:${NEUVE.kid}:${HORODATAGE}:${AUTRE_CONDENSAT}` }) } }, code: 1, motif: /describes another response/ },
    { nom: "reçu valide dont seule l'empreinte diffère : sortie 1", entetes, recus: { [NUMERO]: { corps: recuValide({ corps_sha256: AUTRE_CONDENSAT }) } }, code: 1, motif: /describes another response/ },
    { nom: "reçu valide dont seul le kid diffère : sortie 1", entetes, recus: { [NUMERO]: { corps: recuValide({ kid: ANCIENNE.kid }) } }, code: 1, motif: /describes another response/ },
    { nom: "reçu valide dont seul le message signé diffère : sortie 1", entetes, recus: { [NUMERO]: { corps: recuValide({ message_signe: `sirenic-v1:${NEUVE.kid}:2026-10-19T10:00:00.001Z:${condensat}` }) } }, code: 1, motif: /describes another response/ },
    { nom: "reçu inconnu (404) : dit, sortie 0", entetes, recus: {}, code: 0, motif: /inconnue/ },
    { nom: "reçu en panne (500, corps illisible) : dit, sortie 0", entetes, recus: { [NUMERO]: { statut: 500, type: "text/plain", corps: "boom" } }, code: 0, motif: /receipt not readable|HTTP 500/ },
    { nom: "aucun numéro de vérification : dit, sortie 0", entetes: signer(NEUVE, CORPS_SANCTIONS, HORODATAGE), recus: {}, code: 0, motif: /No X-Sirenic-Verification-Id/ },
  ];
  for (const cas of RECUS) {
    test(cas.nom, async () => {
      const faux = await demarrerFauxSirenic({
        document: APRES_ROTATION,
        reponses: { "/v1/sanctions/check": { corps: CORPS_SANCTIONS, entetes: cas.entetes } },
        recus: cas.recus,
      });
      try {
        const { code, sortie } = await lancer("examples/verify-signature.ts", { SIRENIC_URL: faux.url });
        assert.match(sortie, /signature valid/, sortie);
        assert.match(sortie, cas.motif, sortie);
        assert.equal(code, cas.code, sortie);
        if (cas.entetes["X-Sirenic-Verification-Id"]) assert.match(sortie, new RegExp(`/verifier/${NUMERO}`), sortie);
        sansPaiement(faux.requetes);
      } finally {
        await faux.fermer();
      }
    });
  }
});

// --- examples/verify-invoice-file.ts, archive et LISEZ-MOI compris ----------
/** Les blocs ```bash du LISEZ-MOI écrit dans l'archive. */
function blocsBash(lisezMoi) {
  return [...lisezMoi.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
}
function executerBash(script, cwd) {
  return new Promise((fini) => {
    execFile("bash", ["-c", script], { cwd, timeout: 30_000, env: { PATH: process.env.PATH, TZ: FUSEAU } }, (erreur, stdout, stderr) =>
      fini({ code: erreur ? (typeof erreur.code === "number" ? erreur.code : -1) : 0, sortie: `${stdout}\n${stderr}` }),
    );
  });
}
let opensslPresent = false;
before(async () => {
  opensslPresent = (await executerBash("command -v openssl", RACINE)).code === 0;
});

describe("examples/verify-invoice-file.ts : rotation simulée", { concurrency: 4 }, () => {
  for (const cas of CAS) {
    test(cas.nom, async (t) => {
      const { corps, entetes } = servi(cas, CORPS_FACTURATION);
      const faux = await demarrerFauxSirenic({ document: cas.document, reponses: { "/v1/facturation/dossier": { corps, entetes } } });
      const sortieArchives = dossierTemporaire();
      try {
        const resultat = await lancer("examples/verify-invoice-file.ts", { SIRENIC_URL: faux.url, OUT_DIR: sortieArchives });
        jugerSortieTs(cas, resultat);
        sansPaiement(faux.requetes);
        if (cas.attendu !== "valide" && cas.attendu !== "racine") return;
        assert.equal(resultat.code, 0, resultat.sortie);
        assert.match(resultat.sortie, /archive re-verified/, resultat.sortie);

        // L'archive se revérifie seule, par les deux recettes de son LISEZ-MOI.
        const [archive] = readdirSync(sortieArchives);
        assert.ok(archive, "aucune archive écrite");
        const dossier = join(sortieArchives, archive);
        assert.deepEqual(readFileSync(join(dossier, "cle-publique.json")), Buffer.from(cas.document), "cle-publique.json doit garder les octets servis");
        const lisezMoi = readFileSync(join(dossier, "LISEZ-MOI.md"), "utf8");
        assert.equal(lisezMoi.split(TIRET_LONG).length - 1, 0, "tiret long dans le LISEZ-MOI généré");
        const [recetteNode, recetteOpenssl] = blocsBash(lisezMoi);
        assert.ok(recetteNode && recetteOpenssl, "le LISEZ-MOI doit porter une recette node et une recette openssl");
        const parNode = await executerBash(recetteNode, dossier);
        assert.match(parNode.sortie, /signature VALIDE/, parNode.sortie);
        assert.equal(parNode.code, 0, parNode.sortie);
        if (!opensslPresent) {
          t.diagnostic("openssl absent : recette openssl non jouée");
          return;
        }
        const parOpenssl = await executerBash(recetteOpenssl, dossier);
        assert.match(parOpenssl.sortie, /Signature Verified Successfully/, parOpenssl.sortie);
      } finally {
        await faux.fermer();
      }
    });
  }

  test("l'archive écrite avant une rotation se revérifie après, par ses fichiers seuls", async () => {
    // Achat le 05/09 : l'ancienne clé signe et sert la racine. Le dossier archivé garde ce document-là.
    const cas = { document: UNE_CLE, cle: ANCIENNE, horodatage: "2026-09-05T22:02:34.793Z" };
    const { corps, entetes } = servi(cas, CORPS_FACTURATION);
    const faux = await demarrerFauxSirenic({ document: cas.document, reponses: { "/v1/facturation/dossier": { corps, entetes } } });
    const sortieArchives = dossierTemporaire();
    try {
      const resultat = await lancer("examples/verify-invoice-file.ts", { SIRENIC_URL: faux.url, OUT_DIR: sortieArchives });
      assert.equal(resultat.code, 0, resultat.sortie);
    } finally {
      await faux.fermer();
    }
    // Après la rotation, l'auditeur relit le dossier avec une copie plus récente du document des clés (racine sur
    // la clé neuve, l'entrée de l'ancienne clé toujours là) : les deux recettes prennent la clé de son kid.
    const dossier = join(sortieArchives, readdirSync(sortieArchives)[0]);
    const lisezMoi = readFileSync(join(dossier, "LISEZ-MOI.md"), "utf8");
    const [recetteNode, recetteOpenssl] = blocsBash(lisezMoi);
    writeFileSync(join(dossier, "cle-publique.json"), APRES_ROTATION);
    const parNode = await executerBash(recetteNode, dossier);
    assert.match(parNode.sortie, /signature VALIDE/, parNode.sortie);
    if (opensslPresent) {
      const parOpenssl = await executerBash(recetteOpenssl, dossier);
      assert.match(parOpenssl.sortie, /Signature Verified Successfully/, parOpenssl.sortie);
    }

    // La recette node refuse aussi : la clé de l'achat close la veille (2026-09-04), ou absente du document.
    writeFileSync(
      join(dossier, "cle-publique.json"),
      documentDesCles({ racine: NEUVE, keys: [entree(ANCIENNE, "2026-07-20", "2026-09-04"), entree(NEUVE, "2026-09-04", null)] }),
    );
    const horsFenetre = await executerBash(recetteNode, dossier);
    assert.match(horsFenetre.sortie, /signature INVALIDE : jour 2026-09-05 hors de la fenêtre/, horsFenetre.sortie);
    assert.notEqual(horsFenetre.code, 0, horsFenetre.sortie);
    writeFileSync(join(dossier, "cle-publique.json"), documentDesCles({ racine: NEUVE, keys: [entree(NEUVE, "2026-10-03", null)] }));
    const absente = await executerBash(recetteNode, dossier);
    assert.match(absente.sortie, /signature INVALIDE : kid [0-9a-f]{16} absent de keys/, absente.sortie);
    assert.notEqual(absente.code, 0, absente.sortie);
    if (opensslPresent) {
      const parOpensslAbsente = await executerBash(recetteOpenssl, dossier);
      assert.doesNotMatch(parOpensslAbsente.sortie, /Signature Verified Successfully/, parOpensslAbsente.sortie);
    }
  });
});

// --- examples/verifier-livraison-webhook.mjs ---------------------------------
describe("examples/verifier-livraison-webhook.mjs : rotation simulée", () => {
  let webhook;
  before(async () => {
    // L'import ne doit rien exécuter : ni appel réseau, ni sortie du processus.
    const fetchReel = globalThis.fetch;
    const sortieReelle = process.exit;
    globalThis.fetch = () => {
      throw new Error("l'import du script webhook a lancé un appel réseau");
    };
    process.exit = (code) => {
      throw new Error(`l'import du script webhook a appelé process.exit(${code})`);
    };
    try {
      webhook = await import("../examples/verifier-livraison-webhook.mjs");
    } finally {
      globalThis.fetch = fetchReel;
      process.exit = sortieReelle;
    }
  });

  for (const cas of CAS) {
    test(cas.nom, () => {
      const { corps, entetes } = servi(cas, CORPS_LIVRAISON);
      const req = { headers: entetes, content: corps.toString("utf8") };
      const verdict = webhook.verifierLivraison(req, JSON.parse(cas.document));
      if (cas.attendu === "valide" || cas.attendu === "racine") {
        assert.equal(verdict.ok, true, JSON.stringify(verdict));
        if (cas.attendu === "racine") assert.match(verdict.motif ?? "", /racine.*aucune fenêtre/, JSON.stringify(verdict));
        return;
      }
      assert.equal(verdict.ok, false, JSON.stringify(verdict));
      assert.match(verdict.motif ?? "", MOTIFS_WEBHOOK[cas.attendu], JSON.stringify(verdict));
    });
  }
});

// --- Aucun tiret long dans les fichiers publiés de ce chantier ----------------
test("aucun tiret long dans les trois exemples et leur test", () => {
  for (const fichier of FICHIERS) {
    const chemin = join(RACINE, fichier);
    if (!existsSync(chemin)) continue;
    assert.equal(readFileSync(chemin, "utf8").split(TIRET_LONG).length - 1, 0, `tiret long dans ${fichier}`);
  }
});
