/**
 * Smoke PAYANT du 21/08/2026 — le CLUSTER (3 processus HTTP) vu par un client.
 *
 * Activé le matin même (WORKERS=3). Ce smoke n'éprouve pas la vitesse : il
 * éprouve les chemins qu'un cluster CASSE quand l'état reste en mémoire de
 * processus. Chaque appel peut tomber sur n'importe lequel des 3 workers.
 *
 *   1. A2A en DEUX temps (devis puis paiement sur la MÊME tâche) — la tâche
 *      doit être retrouvée par le worker qui reçoit le 2e appel. Répété 3
 *      fois : avec 3 workers, la probabilité de rester sur le même à chaque
 *      fois est faible.
 *   2. A2A GetTask sur une tâche déjà réglée — troisième aller-retour.
 *   3. Surveillance : créer (payé) → relire avec le jeton (gratuit) →
 *      arrêter. Le jeton est un porteur : il doit valoir sur tout worker.
 *   4. Lot KYB de 2 SIREN : borne de concurrence + fenêtre d'autorisation
 *      élargie à 300 s (lot B) lue dans le devis signé.
 *   5. Compteur de débit PARTAGÉ : la limite annoncée est-elle celle
 *      appliquée ? (le vrai risque du cluster)
 *
 * Dépense attendue : ~0,28 $ (3 × 0,005 A2A + 0,05 surveillance + 0,21 lot).
 *
 *   cd /home/ubuntu/sirenic-examples
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-cluster-2026-08-21.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { decodePaymentRequiredHeader } from "@x402/core/http";

const api = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const X402_EXT = "https://github.com/google-a2a/a2a-x402/v0.1";
const cle = process.env.TEST_WALLET_KEY;
if (!cle?.startsWith("0x")) { console.error("TEST_WALLET_KEY manquante"); process.exit(1); }
const compte = privateKeyToAccount(cle as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: compte });
const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;

const dossier = `resultats/${new Date().toISOString().replace(/[:.]/g, "-")}-cluster`;
mkdirSync(dossier, { recursive: true });
const epreuves: Array<Record<string, unknown>> = [];
let vert = true;
const noter = (nom: string, ok: boolean, detail: Record<string, unknown>) => {
  vert &&= ok;
  epreuves.push({ epreuve: nom, ok, ...detail });
  console.log(`${ok ? "✔" : "✗"} ${nom} — ${JSON.stringify(detail).slice(0, 220)}`);
};

async function rpc(methode: string, params: unknown): Promise<any> {
  const r = await fetch(`${api}/a2a`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "A2A-Version": "1.0", "A2A-Extensions": X402_EXT },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: methode, params }),
    signal: AbortSignal.timeout(120_000),
  });
  const corps = await r.json();
  if (corps.error) throw new Error(`A2A ${corps.error.code}: ${corps.error.message}`);
  return corps.result;
}

// ── 1. A2A en deux temps, 3 fois ────────────────────────────────────────────
const idsTaches: string[] = [];
for (const tour of [1, 2, 3]) {
  try {
    const premier = await rpc("SendMessage", {
      message: { messageId: crypto.randomUUID(), role: "ROLE_USER", parts: [{ data: { path: "/v1/entreprise/552032534" } }] },
    });
    const tache = premier.task;
    const devis = tache.status.message.metadata["x402.payment.required"];
    const charge = await client.createPaymentPayload(devis);
    // 2e appel : SEULE la tâche stockée permet de retrouver le devis. En Map
    // de processus, ce SendMessage échouerait dès qu'il tombe sur un autre worker.
    const second = await rpc("SendMessage", {
      message: {
        messageId: crypto.randomUUID(), taskId: tache.id, role: "ROLE_USER", parts: [],
        metadata: { "x402.payment.status": "payment-submitted", "x402.payment.payload": charge },
      },
    });
    const fini = second.task;
    const recu = fini.status?.message?.metadata?.["x402.payment.receipts"]?.[0];
    const fiche = fini.artifacts?.[0]?.parts?.[0]?.data as { siren?: string; denomination?: string } | undefined;
    idsTaches.push(tache.id);
    noter(`1.${tour} A2A payé en deux temps (tâche retrouvée d'un appel à l'autre)`,
      String(fini.status?.state).includes("COMPLETED") && fiche?.siren === "552032534" && Boolean(recu),
      { tache: tache.id.slice(0, 8), etat: fini.status?.state, siren: fiche?.siren, denomination: fiche?.denomination, recu: Boolean(recu) });
  } catch (e) {
    noter(`1.${tour} A2A payé en deux temps`, false, { erreur: String(e).slice(0, 160) });
  }
}

// ── 2. GetTask sur une tâche déjà réglée ────────────────────────────────────
if (idsTaches[0]) {
  try {
    // Format A2A 1.0 : { id, tenant } — PAS { name: "tasks/<id>" }, qui rend
    // « Task not found » alors que la tâche est bien en base (vécu au premier
    // passage de ce smoke : le harnais était faux, pas le service).
    const relue = await rpc("GetTask", { id: idsTaches[0], tenant: "" });
    const t = relue.task ?? relue;
    const artefact = t?.artifacts?.[0]?.parts?.[0]?.data as { siren?: string } | undefined;
    noter("2. A2A GetTask : une tâche réglée reste lisible AVEC son artefact (3e aller-retour)",
      t?.id === idsTaches[0] && artefact?.siren === "552032534",
      { tache: idsTaches[0].slice(0, 8), etat: t?.status?.state, siren_artefact: artefact?.siren });
  } catch (e) {
    noter("2. A2A GetTask", false, { erreur: String(e).slice(0, 160) });
  }
}

// ── 3. Surveillance : jeton porteur à travers les workers ───────────────────
{
  let jeton: string | null = null;
  try {
    const r = await payer(`${api}/v1/surveillance/creer?cibles=552032534&duree=30`, { signal: AbortSignal.timeout(120_000) });
    const corps = (await r.json()) as { surveillance_id?: string; cibles?: number };
    jeton = corps.surveillance_id ?? null;
    writeFileSync(`${dossier}/3-surveillance-creee.json`, JSON.stringify(corps, null, 1));
    noter("3.a surveillance créée (payée)", r.ok && Boolean(jeton) && corps.cibles === 1,
      { http: r.status, cibles: corps.cibles, jeton: jeton?.slice(0, 12) });
  } catch (e) {
    noter("3.a surveillance créée", false, { erreur: String(e).slice(0, 160) });
  }
  if (jeton) {
    // Relecture GRATUITE avec le jeton porteur : sur un autre worker, il doit
    // valoir autant (le jeton est signé, l'état vit en base).
    let relues = 0;
    for (const _ of [1, 2, 3]) {
      const r = await fetch(`${api}/v1/surveillance/${encodeURIComponent(jeton)}`);
      if (r.ok) relues += 1;
    }
    noter("3.b le jeton porteur vaut sur les 3 workers (3 relectures gratuites)", relues === 3, { relectures_ok: relues });
    const arret = await fetch(`${api}/v1/surveillance/${encodeURIComponent(jeton)}/arreter`);
    noter("3.c surveillance de test arrêtée (ménage)", arret.ok, { http: arret.status });
  }
}

// ── 4. Lot KYB : bornes + fenêtre 300 s ─────────────────────────────────────
{
  const nu = await fetch(`${api}/v1/kyb/batch?sirens=552032534,542065479`);
  const devis = decodePaymentRequiredHeader(nu.headers.get("payment-required") as string) as {
    accepts: Array<{ amount: string; maxTimeoutSeconds: number }>;
  };
  const t0 = Date.now();
  const r = await payer(`${api}/v1/kyb/batch?sirens=552032534,542065479`, { signal: AbortSignal.timeout(300_000) });
  const corps = (await r.json()) as { nombre_trouve?: number; entreprises?: Array<{ trouve: boolean; siren?: string }> };
  writeFileSync(`${dossier}/4-kyb-batch.json`, JSON.stringify(corps, null, 1));
  noter("4. lot KYB de 2 : livré, devis 210000 atomiques, fenêtre 300 s",
    r.ok && corps.nombre_trouve === 2 && devis.accepts[0]?.amount === "210000" && devis.accepts[0]?.maxTimeoutSeconds === 300,
    { http: r.status, ms: Date.now() - t0, trouves: corps.nombre_trouve, montant: devis.accepts[0]?.amount, fenetre: devis.accepts[0]?.maxTimeoutSeconds });
}

// ── 5. Compteur de débit partagé (gratuit) ──────────────────────────────────
{
  // 25 appels sur la surface MCP (seau 60/min) : les compteurs doivent
  // s'additionner ENTRE workers, donc décroître de façon monotone.
  let precedent = Infinity;
  let monotone = true;
  let dernier = 0;
  for (let i = 0; i < 25; i += 1) {
    const r = await fetch(`${api}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const restant = Number(r.headers.get("ratelimit-remaining") ?? "-1");
    if (restant >= 0) {
      if (restant > precedent) monotone = false; // un compteur par worker remonterait
      precedent = restant;
      dernier = restant;
    }
  }
  noter("5. compteur de débit PARTAGÉ : 25 appels décomptent sans jamais remonter", monotone,
    { restant_final: dernier, monotone });
}

writeFileSync(`${dossier}/RESUME.json`, JSON.stringify({ horodatage: new Date().toISOString(), api, epreuves }, null, 1));
console.log(`\nréponses conservées : ${dossier}`);
console.log(vert ? "TOUT VERT — le cluster se comporte comme un service unique" : "ROUGE");
process.exit(vert ? 0 : 1);
