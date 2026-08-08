/**
 * Smoke PAYANT — AUDIT FONCTIONNEL COMPLET (2026-08-07, GO CDU explicite).
 *
 * But : acheter UNE FOIS chaque route de la grille (paramètres = contrats
 * d'exemples publiés, chaînage réel pour les routes à référence), PUIS juger la
 * qualité des scores sur un panel de 8 profils contrastés. Tout est conservé
 * dans resultats/audit-fonctionnel-<horodatage>/ (règle CDU du 24/07).
 *
 * Attendus connus AVANT le run (à confirmer, pas à découvrir) :
 *  - /capital et /sante : 503 (crédit Anthropic épuisé), paiement annulé ;
 *  - un 400 payé-signé ne débite jamais ; HEAD sur /v1 = 405.
 *
 *   cd /home/ubuntu/sirenic-examples
 *   node --env-file=.env.wallet-test --import tsx examples/smoke-audit-fonctionnel-2026-08-07.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { base } from "viem/chains";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
// Vérité du code de prod : la grille et les contrats publiés, pas une copie.
import { CONTRATS } from "/home/ubuntu/apps/sirenic/src/contrats/exemples.ts";
import { GRILLE_TARIFAIRE } from "/home/ubuntu/apps/sirenic/src/pricing.ts";

const api = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const cle = process.env.TEST_WALLET_KEY;
if (!cle?.startsWith("0x")) {
  console.error("TEST_WALLET_KEY manquante (--env-file=.env.wallet-test)");
  process.exit(1);
}
const compte = privateKeyToAccount(cle as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: compte });
const payer = wrapFetchWithPayment(fetch, client) as typeof fetch;

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const rpc = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const solde = async (): Promise<bigint | null> => {
  try {
    return await rpc.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [compte.address] });
  } catch { return null; }
};

const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
const dossier = `resultats/audit-fonctionnel-${horodatage}`;
mkdirSync(dossier, { recursive: true });

type Ligne = {
  ordre: number; route: string; url: string; prix_grille: string;
  statut: number | string; ms: number; recu: boolean; type_contenu: string;
  octets: number; fichier: string; note: string;
};
const lignes: Ligne[] = [];
let ordre = 0;

const slug = (s: string) => s.replace(/^GET /, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

/** Cherche récursivement la première valeur d'une clé dans un objet JSON. */
function chercher(obj: unknown, cible: string): unknown {
  if (obj === null || typeof obj !== "object") return undefined;
  if (Array.isArray(obj)) {
    for (const el of obj) { const v = chercher(el, cible); if (v !== undefined) return v; }
    return undefined;
  }
  const o = obj as Record<string, unknown>;
  if (cible in o && o[cible] !== null && o[cible] !== undefined) return o[cible];
  for (const k of Object.keys(o)) { const v = chercher(o[k], cible); if (v !== undefined) return v; }
  return undefined;
}

async function acheter(route: string, url: string, prixGrille: string, opts: { timeoutMs?: number; note?: string } = {}): Promise<{ statut: number | string; corps: unknown; brut?: Buffer }> {
  ordre += 1;
  const nom = `${String(ordre).padStart(2, "0")}-${slug(route)}`;
  const ctl = new AbortController();
  const minuterie = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 60_000);
  const debut = Date.now();
  let statut: number | string = "EXCEPTION";
  let recu = false; let typeContenu = ""; let octets = 0; let corps: unknown = null; let brut: Buffer | undefined;
  let fichier = "";
  try {
    const r = await payer(`${api}${url}`, { signal: ctl.signal });
    statut = r.status;
    recu = Boolean(r.headers.get("payment-response") ?? r.headers.get("x-payment-response"));
    typeContenu = r.headers.get("content-type") ?? "";
    if (typeContenu.includes("pdf") || typeContenu.includes("octet")) {
      const ab = await r.arrayBuffer(); brut = Buffer.from(ab); octets = brut.length;
      fichier = `${nom}.pdf`; writeFileSync(`${dossier}/${fichier}`, brut);
    } else {
      const texte = await r.text(); octets = Buffer.byteLength(texte);
      fichier = `${nom}.json`;
      try { corps = JSON.parse(texte); } catch { corps = texte; }
      writeFileSync(`${dossier}/${fichier}`, typeof corps === "string" ? corps : JSON.stringify({ _meta: { route, url, statut, recu, prix_grille: prixGrille } , reponse: corps }, null, 2));
    }
  } catch (e) {
    corps = String(e); fichier = `${nom}.erreur.txt`;
    writeFileSync(`${dossier}/${fichier}`, String(e));
  } finally { clearTimeout(minuterie); }
  const ms = Date.now() - debut;
  lignes.push({ ordre, route, url, prix_grille: prixGrille, statut, ms, recu, type_contenu: typeContenu.split(";")[0], octets, fichier, note: opts.note ?? "" });
  console.log(`  ${String(statut).padStart(3)} ${recu ? "$" : " "} ${Math.round(ms / 100) / 10}s ${route} ${opts.note ?? ""}`);
  return { statut, corps, brut };
}

// Grille motif ":param" -> clé de contrat "{param}"
const versContrat = (motif: string) => motif.replace(/^GET /, "").replace(/:([a-zA-Z_]+)/g, "{$1}");
const construireUrl = (cheminContrat: string, pathParams?: Record<string, string>, query?: Record<string, string>) => {
  let chemin = cheminContrat;
  for (const [k, v] of Object.entries(pathParams ?? {})) chemin = chemin.replace(`{${k}}`, encodeURIComponent(v));
  const q = new URLSearchParams(query ?? {}).toString();
  return q ? `${chemin}?${q}` : chemin;
};

// Routes traitées HORS boucle générique (chaînage ou nettoyage nécessaires)
const SPECIALES = new Set([
  "GET /v1/surveillance/creer",
  "GET /v1/surveillance/:jeton/renouveler",
  "GET /v1/documents/:type/:id",
  "GET /v1/eu/entreprise/DK/:id/comptes/:reference",
  "GET /v1/eu/entreprise/SK/:id/comptes/:reference",
  "GET /v1/eu/entreprise/GB/:company_number/comptes/:date_cloture",
  "GET /v1/eu/entreprise/:pays/:id/comptes/:reference",
]);

console.log(`Payeur : ${compte.address}`);
const avant = await solde();
console.log(`Solde USDC avant : ${avant === null ? "RPC indisponible" : formatUnits(avant, 6)}`);

/* ============ 0. Contrats gratuits (0,00 $) ============ */
console.log("\n=== 0. Contrats gratuits ===");
const libre: Array<[string, string, (r: Response) => Promise<string>]> = [
  ["healthz", "/healthz", async r => `HTTP ${r.status} ${(await r.text()).slice(0, 120)}`],
  ["openapi-taille", "/openapi.json", async r => `HTTP ${r.status} ${(await r.text()).length} octets`],
  ["head-405", "/v1/entreprise/552032534", async r => `HTTP ${r.status} Allow=${r.headers.get("allow")}`],
];
const gratuits: Record<string, string> = {};
for (const [nom, chemin, lire] of libre) {
  const r = await fetch(`${api}${chemin}`, nom === "head-405" ? { method: "HEAD" } : undefined);
  gratuits[nom] = await lire(r);
  console.log(`  ${nom}: ${gratuits[nom].slice(0, 100)}`);
}
// Un 400 payé-signé ne débite rien (route payante appelée sans paramètre requis)
{
  const r = await payer(`${api}/v1/regulateurs/fr/alertes`);
  const recu = Boolean(r.headers.get("payment-response") ?? r.headers.get("x-payment-response"));
  await r.text();
  gratuits["400-non-debite"] = `HTTP ${r.status}, reçu=${recu}`;
  console.log(`  400-non-debite: ${gratuits["400-non-debite"]} (attendu 400, reçu=false)`);
}

/* ============ 1. Passage complet de la grille ============ */
console.log(`\n=== 1. Grille complète (${GRILLE_TARIFAIRE.length} routes) ===`);
const memoire: Record<string, unknown> = {}; // réponses utiles au chaînage
for (const r of GRILLE_TARIFAIRE) {
  if (SPECIALES.has(r.motif)) continue;
  const cheminContrat = versContrat(r.motif);
  const contrat = (CONTRATS as Record<string, { pathParams?: Record<string, string>; query?: Record<string, string> }>)[cheminContrat];
  if (!contrat) {
    lignes.push({ ordre: (ordre += 1), route: r.motif, url: "", prix_grille: r.prix, statut: "SANS CONTRAT", ms: 0, recu: false, type_contenu: "", octets: 0, fichier: "", note: "aucun contrat d'exemple publié" });
    console.log(`  --- SANS CONTRAT : ${r.motif}`);
    continue;
  }
  const url = construireUrl(cheminContrat, contrat.pathParams, contrat.query);
  const lent = /intelligence|rapport|capital|sante|comptes\/|documents/.test(r.motif);
  const res = await acheter(r.motif, url, r.prix, { timeoutMs: lent ? 150_000 : 60_000 });
  memoire[r.motif] = res.corps;
  await new Promise(t => setTimeout(t, 150));
}

/* ============ 2. Routes chaînées ============ */
console.log("\n=== 2. Routes chaînées (référence tirée d'un achat réel) ===");
// 2a. Surveillance : créer -> renouveler -> arrêter (gratuit, nettoyage)
{
  const contratCreer = (CONTRATS as Record<string, { query?: Record<string, string> }>)["/v1/surveillance/creer"];
  const resCreer = await acheter("GET /v1/surveillance/creer", construireUrl("/v1/surveillance/creer", undefined, contratCreer?.query), "$0.05");
  const jeton = chercher(resCreer.corps, "jeton") ?? chercher(resCreer.corps, "token");
  if (typeof jeton === "string" && jeton.length > 3) {
    await acheter("GET /v1/surveillance/:jeton/renouveler", `/v1/surveillance/${encodeURIComponent(jeton)}/renouveler`, "$0.05");
    const stop = await fetch(`${api}/v1/surveillance/${encodeURIComponent(jeton)}/arreter`);
    console.log(`  nettoyage arreter (gratuit) : HTTP ${stop.status}`);
    gratuits["surveillance-arreter"] = `HTTP ${stop.status}`;
  } else {
    console.log("  !! pas de jeton dans la réponse de création — renouveler NON testé");
  }
}
// 2b. Document réel : liste déjà achetée en passe 1 -> premier document
{
  const liste = memoire["GET /v1/entreprise/:siren/documents"];
  const docs = (chercher(liste, "documents") ?? chercher(liste, "actes")) as Array<Record<string, unknown>> | undefined;
  const premier = Array.isArray(docs) ? docs.find(d => d && (d.type ?? d.categorie) && (d.id ?? d.identifiant)) : undefined;
  const type = premier ? String(premier.type ?? premier.categorie) : undefined;
  const id = premier ? String(premier.id ?? premier.identifiant) : undefined;
  const contratDoc = (CONTRATS as Record<string, { pathParams?: Record<string, string> }>)["/v1/documents/{type}/{id}"];
  const t = type ?? contratDoc?.pathParams?.type; const i = id ?? contratDoc?.pathParams?.id;
  if (t && i) {
    await acheter("GET /v1/documents/:type/:id", `/v1/documents/${encodeURIComponent(t)}/${encodeURIComponent(i)}`, "$0.10", { timeoutMs: 150_000, note: type ? "chaîné depuis la liste" : "contrat publié (repli)" });
  } else console.log("  !! aucun document exploitable — /v1/documents/:type/:id NON testé");
}
// 2c/2d/2e/2f. Comptes à référence : DK, SK, GB, générique (BE)
const chaines: Array<{ liste: string; routeRef: string; cleRef: string; construire: (ref: string) => string; prix: string }> = [
  { liste: "GET /v1/eu/entreprise/DK/:id/comptes", routeRef: "GET /v1/eu/entreprise/DK/:id/comptes/:reference", cleRef: "reference", construire: ref => `/comptes/${encodeURIComponent(ref)}`, prix: "$0.05" },
  { liste: "GET /v1/eu/entreprise/SK/:id/comptes", routeRef: "GET /v1/eu/entreprise/SK/:id/comptes/:reference", cleRef: "reference", construire: ref => `/comptes/${encodeURIComponent(ref)}`, prix: "$0.03" },
  { liste: "GET /v1/eu/entreprise/GB/:company_number/comptes", routeRef: "GET /v1/eu/entreprise/GB/:company_number/comptes/:date_cloture", cleRef: "date_cloture", construire: ref => `/comptes/${encodeURIComponent(ref)}`, prix: "$0.05" },
  { liste: "GET /v1/eu/entreprise/:pays/:id/comptes", routeRef: "GET /v1/eu/entreprise/:pays/:id/comptes/:reference", cleRef: "reference", construire: ref => `/comptes/${encodeURIComponent(ref)}`, prix: "$0.15" },
];
for (const c of chaines) {
  const liste = memoire[c.liste];
  const ref = chercher(liste, c.cleRef);
  const contratListe = (CONTRATS as Record<string, { pathParams?: Record<string, string> }>)[versContrat(c.liste.replace(/^GET /, ""))];
  if (typeof ref === "string" && ref.length > 0 && contratListe?.pathParams) {
    const base_ = construireUrl(versContrat(c.liste.replace(/^GET /, "")), contratListe.pathParams);
    await acheter(c.routeRef, `${base_}${c.construire(ref)}`, c.prix, { timeoutMs: 150_000, note: "chaîné" });
  } else {
    // Repli : contrat publié de la route référence elle-même, s'il existe
    const contratRef = (CONTRATS as Record<string, { pathParams?: Record<string, string> }>)[versContrat(c.routeRef.replace(/^GET /, ""))];
    if (contratRef?.pathParams) {
      await acheter(c.routeRef, construireUrl(versContrat(c.routeRef.replace(/^GET /, "")), contratRef.pathParams), c.prix, { timeoutMs: 150_000, note: "contrat publié (repli, réf. non chaînable)" });
    } else {
      lignes.push({ ordre: (ordre += 1), route: c.routeRef, url: "", prix_grille: c.prix, statut: "NON TESTE", ms: 0, recu: false, type_contenu: "", octets: 0, fichier: "", note: `liste sans ${c.cleRef} exploitable` });
      console.log(`  --- NON TESTÉ : ${c.routeRef} (pas de ${c.cleRef} dans la liste)`);
    }
  }
}

/* ============ 3. Panel scores — 8 profils contrastés ============ */
console.log("\n=== 3. Panel scores (8 profils) ===");
const PANEL: Array<{ siren: string; nom: string; attendu: string }> = [
  { siren: "552032534", nom: "DANONE", attendu: "GE tête de groupe 70.10Z — référence (30/vigilance au 07/08)" },
  { siren: "490586708", nom: "AIRVANCE GROUP", attendu: "holding CDU — le faux « fragile » de juillet ne doit PAS revenir" },
  { siren: "399364751", nom: "NETMEDIA GROUP", attendu: "holding en PERTE NETTE 11,5 M€ — ne doit PAS être « sain » (garde v1.4)" },
  { siren: "380129866", nom: "ORANGE", attendu: "GE non-holding — accord score/comparer" },
  { siren: "885113613", nom: "ALKA MARINE SOLUTIONS", attendu: "PME saine, clôture 12/2025 — « sain » + confiance forte attendus" },
  { siren: "016980062", nom: "POCHET DU COURVAL", attendu: "derniers comptes 12/2021 (~56 mois) — confiance FAIBLE attendue (v1.3), classe inchangée" },
  { siren: "100000025", nom: "ZAKADO", attendu: "créée 01/2026, aucun compte — réponse honnête attendue (pas de faux score)" },
  { siren: "880233713", nom: "PHARMACIE ANATOLE FRANCE", attendu: "liquidation judiciaire OUVERTE 24/07/2026 — surcharge BODACC « risque élevé » attendue" },
];
for (const p of PANEL) {
  await acheter("GET /v1/score/defaillance/:siren", `/v1/score/defaillance/${p.siren}`, "$0.10", { note: `${p.nom} — ${p.attendu.slice(0, 60)}` });
  await new Promise(t => setTimeout(t, 150));
}
// Croisements : le même SIREN via d'autres routes payantes doit s'accorder
console.log("\n=== 3bis. Croisements de cohérence ===");
await acheter("GET /v1/comparer", "/v1/comparer?sirens=552032534,380129866", "$0.24 (0.12×2)", { note: "accord score/comparer DANONE+ORANGE" });
await acheter("GET /v1/comparer", "/v1/comparer?sirens=885113613,402974653", "$0.24 (0.12×2)", { note: "2 PME réelles — utilité du verdict comparatif" });
await acheter("GET /v1/kyb/:siren", "/v1/kyb/490586708", "$0.15", { note: "KYB AIRVANCE — cohérence avec score" });
await acheter("GET /v1/intelligence/:siren", "/v1/intelligence/490586708", "$1.00", { timeoutMs: 150_000, note: "rapport 1$ AIRVANCE — le cas réel de CDU" });
await acheter("GET /v1/entreprise/:siren/finances", "/v1/entreprise/016980062/finances", "$0.01", { note: "séries POCHET — profondeur exercices servie" });
await acheter("GET /v1/entreprise/:siren/alertes", "/v1/entreprise/880233713/alertes", "$0.01", { note: "BODACC pharmacie en LJ" });

/* ============ 4. Solde final + récapitulatif ============ */
const apresImmediat = await solde();
console.log("\nAttente 35 s (règlements en cours de minage)...");
await new Promise(t => setTimeout(t, 35_000));
const apres = await solde();
const depense = avant !== null && apres !== null ? formatUnits(avant - apres, 6) : "inconnu";
console.log(`Solde USDC après : ${apres === null ? "RPC indisponible" : formatUnits(apres, 6)} (dépense réelle : ${depense} $)`);

const recap = {
  quand: horodatage, payeur: compte.address,
  solde_avant: avant === null ? null : formatUnits(avant, 6),
  solde_apres: apres === null ? null : formatUnits(apres, 6),
  solde_apres_immediat: apresImmediat === null ? null : formatUnits(apresImmediat, 6),
  depense_usdc: depense,
  controles_gratuits: gratuits,
  panel: PANEL,
  appels: lignes,
};
writeFileSync(`${dossier}/recap.json`, JSON.stringify(recap, null, 2));

const md = [
  `# Audit fonctionnel payant — ${horodatage}`, "",
  `Payeur \`${compte.address}\` — dépense réelle **${depense} USDC** (avant ${recap.solde_avant}, après ${recap.solde_apres}).`, "",
  "| # | Route | Statut | Reçu | ms | Octets | Note |", "|---|---|---|---|---|---|---|",
  ...lignes.map(l => `| ${l.ordre} | \`${l.route}\` | ${l.statut} | ${l.recu ? "💰" : "—"} | ${l.ms} | ${l.octets} | ${l.note} |`),
].join("\n");
writeFileSync(`${dossier}/RECAP.md`, md);
console.log(`\nRésultats conservés dans ${dossier}/ (${lignes.length} appels tracés)`);
