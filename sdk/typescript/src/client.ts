/**
 * Sirenic core client for agent frameworks.
 *
 * Three ways to call a paid route, one per client:
 *  - an API key (`apiKey`, or the `SIRENIC_API_KEY` environment variable when
 *    no wallet is given): sent in the `X-Api-Key` header, paid with the
 *    account's prepaid credits (1 credit = 1 EUR), never above `maxCredits`;
 *  - a wallet (`walletKey`): each call is paid via x402 in USDC or EURC on
 *    Base, signed locally by the official `@x402/*` packages, never above
 *    `maxPriceUsd`;
 *  - neither: every paid route returns its x402 quote (discovery, dry runs).
 *
 * Every call returns a JSON string: the data, the quote, or the error. The
 * client stores nothing and sends the key and the payment headers to
 * `baseUrl` only: it takes a path, never a full URL, and follows a redirect
 * only within the origin of `baseUrl`.
 */
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";

export const VERSION = "0.3.0";
export const DEFAULT_BASE_URL = "https://api.sirenic.eu";
export const ENV_API_KEY = "SIRENIC_API_KEY";
const USER_AGENT = `sirenic-agents-js/${VERSION}`;

/** Which rail pays the calls of a client. */
export type Rail = "api_key" | "x402" | "quote";

export interface SirenicOptions {
  /**
   * Sirenic API key (`srn_live_...`), paid with prepaid credits. When neither
   * `apiKey` nor `walletKey` is given, `SIRENIC_API_KEY` is read from the
   * environment.
   */
  apiKey?: string;
  /** EVM private key (0x...) of YOUR paying wallet, for x402. It never leaves this process. */
  walletKey?: string;
  /**
   * Hard per-call cap of the wallet rail in USD (default 1.0), compared with
   * the quoted amount. A quote above it is never signed: the tool returns the
   * quote. Watchlists and batches are priced per target and can cost more
   * than 1.0: raise the cap for them.
   */
  maxPriceUsd?: number;
  /**
   * Hard per-call cap of the API key rail, in credits (1 credit = 1 EUR, the
   * figure of the quote; default 1.0). Each call first asks the free quote of
   * the same request, sent without the key; above the cap the paid call is
   * not made and the tool returns the price and the quote. `null` removes the
   * cap and that extra request: your balance then bounds the spend. The quote
   * request counts against the per-IP rate limit of calls without a key
   * (120 requests per minute): for heavy traffic or a shared IP address,
   * pass `null`.
   */
  maxCredits?: number | null;
  /** Default https://api.sirenic.eu (plain http only on localhost or 127.0.0.1, for tests). */
  baseUrl?: string;
  /** Milliseconds per HTTP request (default 120000). */
  timeoutMs?: number;
  /** HTTP transport (default: the global fetch). Proxies, logging, tests. */
  fetch?: typeof fetch;
}

const BASE_MAINNET = "eip155:8453";
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const EURC_BASE = "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42";
const ACTIFS_PAYES = new Set([`${BASE_MAINNET}|${USDC_BASE}`, `${BASE_MAINNET}|${EURC_BASE.toLowerCase()}`]);
const REDIRECTIONS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTIONS = 5;
const CHEMIN = /^\/(?:v1|preview)\/\S*$/;
const BASE = /^(?:https:\/\/[^/\s?#]+|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)(?:\/[^\s?#]*)?$/;

type Json = Record<string, unknown>;

/** A cap is a positive finite number. */
function plafondValide(nom: string, valeur: unknown): number {
  if (typeof valeur !== "number" || !Number.isFinite(valeur) || valeur <= 0) {
    throw new Error(`${nom} must be a positive finite number`);
  }
  return valeur;
}

/** An amount in atomic units (6 decimals, USDC and EURC), rounded down: never above the cap. */
function atomique(montant: number): bigint {
  const [entier, decimales = ""] = montant.toFixed(7).split(".");
  return BigInt(entier ?? "0") * 1_000_000n + BigInt(decimales.slice(0, 6).padEnd(6, "0"));
}

/** Atomic units back to a decimal figure (credits or USD). */
function figure(atomes: bigint): number {
  return Number(atomes) / 1_000_000;
}

/** Amount of a payment option in atomic units (x402 v2 `amount`, v1 `maxAmountRequired`), or null. */
function montant(option: unknown): bigint | null {
  const o = option as { amount?: unknown; maxAmountRequired?: unknown };
  const brut = o?.amount ?? o?.maxAmountRequired;
  if (typeof brut !== "string" && typeof brut !== "number") return null;
  try {
    return BigInt(brut);
  } catch {
    return null;
  }
}

/** An option this client pays: the exact scheme on Base mainnet, in USDC or EURC. */
function payable(option: unknown): boolean {
  const o = option as { scheme?: unknown; network?: unknown; asset?: unknown };
  return o?.scheme === "exact" && ACTIFS_PAYES.has(`${String(o.network)}|${String(o.asset).toLowerCase()}`);
}

function libelle(option: unknown): string {
  const o = option as { network?: unknown; asset?: unknown; extra?: { name?: unknown } };
  const nom = typeof o?.extra?.name === "string" ? o.extra.name : String(o?.asset);
  return `${nom} on ${String(o?.network)}`;
}

/**
 * x402 client policy: drop any payment option above the cap (v1 and v2 field
 * names both handled). An empty result means nothing gets signed.
 */
export function pricecapPolicy(maxPriceUsd: number) {
  const plafond = atomique(plafondValide("maxPriceUsd", maxPriceUsd));
  return (_version: number, requirements: PaymentRequirements[]): PaymentRequirements[] =>
    requirements.filter((r) => {
      const m = montant(r);
      return m !== null && m <= plafond;
    });
}

/** x402 client policy: keep the options in an asset this client pays (USDC or EURC on Base). */
function seulementPayables(_version: number, requirements: PaymentRequirements[]): PaymentRequirements[] {
  return requirements.filter(payable);
}

/**
 * Percent-encode what a URL cannot carry (a space becomes %20), keeping the
 * escapes already there, as Python's `requote_uri` does.
 */
function requote(chemin: string): string {
  return chemin.replace(
    /%(?![0-9A-Fa-f]{2})|[^A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/gu,
    (c) => encodeURIComponent(c),
  );
}

function origine(adresse: string): string {
  const u = new URL(adresse);
  const port = u.port || (u.protocol === "https:" ? "443" : u.protocol === "http:" ? "80" : "");
  return `${u.protocol}//${u.hostname.toLowerCase()}:${port}`;
}

class RedirectionRefusee extends Error {}

/** Body of a response: parsed JSON, the text, or null for a binary body. */
async function lireCorps(reponse: Response): Promise<{ json: unknown; texte: string | null; octets: number; type: string }> {
  const type = reponse.headers.get("content-type") ?? "";
  const tampon = new Uint8Array(await reponse.arrayBuffer());
  if (/json|^text\//i.test(type) || type === "") {
    const texte = new TextDecoder().decode(tampon);
    try {
      return { json: JSON.parse(texte), texte, octets: tampon.length, type };
    } catch {
      return { json: undefined, texte, octets: tampon.length, type };
    }
  }
  return { json: undefined, texte: null, octets: tampon.length, type };
}

function codeEtMessage(corps: unknown): { code: string | null; message: string | null } {
  const c = corps as { error?: unknown; message?: unknown } | null;
  return {
    code: c && typeof c === "object" && typeof c.error === "string" ? c.error : null,
    message: c && typeof c === "object" && typeof c.message === "string" ? c.message : null,
  };
}

/** The payment options of a 402: the body's `accepts`, else the PAYMENT-REQUIRED header (x402 v2). */
function optionsDuDevis(reponse: Response, corps: unknown): unknown[] {
  const accepts = (corps as { accepts?: unknown } | null)?.accepts;
  if (Array.isArray(accepts)) return accepts;
  const entete = reponse.headers.get("payment-required");
  if (entete) {
    try {
      return decodePaymentRequiredHeader(entete).accepts ?? [];
    } catch {
      return [];
    }
  }
  return [];
}

export class Sirenic {
  readonly baseUrl: string;
  readonly maxPriceUsd: number;
  readonly maxCredits: number | null;
  readonly timeoutMs: number;
  private readonly apiKey: string | null;
  private readonly x402: x402HTTPClient | null;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SirenicOptions = {}) {
    let apiKey = (options.apiKey ?? "").trim() || null;
    const walletKey = (options.walletKey ?? "").trim() || null;
    if (apiKey && walletKey) {
      throw new Error("Pass apiKey or walletKey, not both: one payment rail per client.");
    }
    if (apiKey === null && walletKey === null) {
      const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[ENV_API_KEY];
      apiKey = (env ?? "").trim() || null;
    }
    if (apiKey !== null && /\s/.test(apiKey)) {
      throw new Error("apiKey must not contain whitespace");
    }
    this.maxPriceUsd = plafondValide("maxPriceUsd", options.maxPriceUsd ?? 1.0);
    this.maxCredits = options.maxCredits === null ? null : plafondValide("maxCredits", options.maxCredits ?? 1.0);
    const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    if (!BASE.test(base)) {
      throw new Error(
        "baseUrl must be an https URL without query, e.g. https://api.sirenic.eu (plain http only on localhost or 127.0.0.1, for tests)",
      );
    }
    this.baseUrl = base;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.apiKey = apiKey;
    this.x402 = walletKey ? this.clientX402(walletKey) : null;
  }

  /** `"api_key"`, `"x402"` or `"quote"` (neither: paid routes return their quote). */
  get rail(): Rail {
    if (this.apiKey) return "api_key";
    if (this.x402) return "x402";
    return "quote";
  }

  private clientX402(walletKey: string): x402HTTPClient {
    const client = new x402Client();
    registerExactEvmScheme(client, {
      signer: privateKeyToAccount(walletKey as `0x${string}`),
      networks: [BASE_MAINNET],
    });
    client.registerPolicy(seulementPayables);
    client.registerPolicy(pricecapPolicy(this.maxPriceUsd));
    // @x402/core caps every payment at $1 by default and pays its default assets only (USDC on Base):
    // the cap becomes ours, and EURC on Base is allowed under the same cap in atomic units.
    client.setSpendControls({
      maxAmountPerPayment: `$${this.maxPriceUsd}`,
      allowedAssets: [
        { network: BASE_MAINNET, asset: EURC_BASE, maxAmountPerPayment: String(atomique(this.maxPriceUsd)) },
      ],
    });
    return new x402HTTPClient(client);
  }

  /**
   * GET a Sirenic path (e.g. "/v1/recherche?q=danone"), paying if needed.
   * A space, or any character a URL cannot carry, is percent-encoded first.
   * Returns a JSON string in every case:
   *  - 2xx: the data (or, for a binary body such as a PDF, its type and size);
   *  - not paid: `{ payment_required: true, hint, quote }`, with
   *    `price_cap_exceeded: true` when the price is above your cap, or
   *    `unsupported_asset: true` when the wallet cannot pay any offered asset;
   *  - otherwise: `{ error, status, code, message, body }`. Responses with a
   *    status of 400 or above are not charged.
   */
  async get(path: string): Promise<string> {
    let chemin: string;
    try {
      chemin = typeof path === "string" ? requote(path) : "";
    } catch {
      chemin = "";
    }
    if (!CHEMIN.test(chemin)) {
      return JSON.stringify({
        error: "invalid_path",
        message: "Only /v1/... and /preview/... paths are served, never a full URL.",
      });
    }
    try {
      return await this.appeler(this.baseUrl + chemin);
    } catch (erreur) {
      if (erreur instanceof RedirectionRefusee) {
        return JSON.stringify({ error: "redirect_refused", message: erreur.message });
      }
      return JSON.stringify({ error: "network", message: String(erreur).slice(0, 300) });
    }
  }

  private entetes(avecCle: boolean): Record<string, string> {
    const entetes: Record<string, string> = { Accept: "application/json", "User-Agent": USER_AGENT };
    if (avecCle && this.apiKey) entetes["X-Api-Key"] = this.apiKey;
    return entetes;
  }

  /** One GET. Redirects are followed here, and only within the origin of `baseUrl`. */
  private async envoyer(url: string, entetes: Record<string, string>): Promise<Response> {
    let courante = url;
    let reponse = await this.fetchImpl(courante, {
      headers: entetes,
      redirect: "manual",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    for (let i = 0; i < MAX_REDIRECTIONS; i++) {
      const cible = REDIRECTIONS.has(reponse.status) ? reponse.headers.get("location") : null;
      if (!cible) break;
      const suivante = new URL(cible, courante).toString();
      if (origine(suivante) !== origine(this.baseUrl)) {
        await reponse.body?.cancel();
        throw new RedirectionRefusee(
          `Redirect to another host not followed: ${suivante} (the API key and payment headers are only sent to ${this.baseUrl}).`,
        );
      }
      await reponse.body?.cancel();
      courante = suivante;
      reponse = await this.fetchImpl(courante, {
        headers: entetes,
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    }
    return reponse;
  }

  private async appeler(url: string): Promise<string> {
    if (this.apiKey && this.maxCredits !== null) {
      const verdict = await this.sousLePlafond(url);
      if (verdict !== null) return verdict;
    }
    const reponse = await this.envoyer(url, this.entetes(true));
    if (reponse.status === 402 && this.x402) {
      return this.payer(url, reponse);
    }
    return this.rendre(reponse);
  }

  /**
   * API key rail under `maxCredits`: the same request without the key returns
   * its free quote, and the service debits the key the amount it quotes.
   * Returns null when the paid call may be made, else the tool's answer.
   */
  private async sousLePlafond(url: string): Promise<string | null> {
    const reponse = await this.envoyer(url, this.entetes(false));
    if (reponse.status !== 402 && reponse.status !== 401) {
      // 2xx: a free route, served without the key; any other status: the same error under the key.
      return this.rendre(reponse);
    }
    const { json } = await lireCorps(reponse);
    const { code, message } = codeEtMessage(json);
    if (reponse.status === 401) {
      if (code !== "compte_requis") {
        return JSON.stringify({ error: "http_error", status: 401, code, message, body: json });
      }
      return JSON.stringify({
        payment_required: true,
        price_cap_exceeded: true,
        max_credits: this.maxCredits,
        credits: null,
        hint:
          "The price of this call is not quoted without an API key (401 compte_requis): it cannot be checked " +
          "against maxCredits, so the call was not made. Pass maxCredits: null to make it.",
        quote: json,
      });
    }
    const montants = optionsDuDevis(reponse, json)
      .map(montant)
      .filter((m): m is bigint => m !== null);
    if (montants.length === 0) {
      return JSON.stringify({
        payment_required: true,
        price_cap_exceeded: true,
        max_credits: this.maxCredits,
        credits: null,
        hint: "The quote of this call states no amount: it cannot be checked against maxCredits, so the call was not made.",
        quote: json,
      });
    }
    const prix = montants.reduce((a, b) => (a > b ? a : b));
    if (prix <= atomique(this.maxCredits as number)) return null;
    return JSON.stringify({
      payment_required: true,
      price_cap_exceeded: true,
      max_credits: this.maxCredits,
      credits: figure(prix),
      hint: `Price ${figure(prix)} credits is above maxCredits=${this.maxCredits}: the call was not made. Raise maxCredits or call a cheaper endpoint.`,
      quote: json,
    });
  }

  /** Wallet rail: check the quote against the cap and the assets, sign it locally, send the call again. */
  private async payer(url: string, reponse: Response): Promise<string> {
    const http = this.x402 as x402HTTPClient;
    const { json } = await lireCorps(reponse);
    let devis: PaymentRequired;
    try {
      devis = http.getPaymentRequiredResponse((nom) => reponse.headers.get(nom), json);
    } catch (erreur) {
      return JSON.stringify({ error: "payment_failed", status: 402, message: `Unreadable quote: ${String(erreur).slice(0, 200)}` });
    }
    const offertes = devis.accepts ?? [];
    const payables = offertes.filter(payable);
    if (payables.length === 0) {
      return JSON.stringify({
        payment_required: true,
        unsupported_asset: true,
        assets: offertes.map(libelle),
        hint: "No option of the quote is in USDC or EURC on Base, the assets this client pays: nothing was signed.",
        quote: json,
      });
    }
    const montants = payables.map(montant).filter((m): m is bigint => m !== null);
    if (montants.length === 0) {
      return JSON.stringify({ error: "payment_failed", status: 402, message: "The quote states no amount in atomic units: nothing was signed." });
    }
    if (montants.reduce((a, b) => (a < b ? a : b)) > atomique(this.maxPriceUsd)) {
      return JSON.stringify({
        payment_required: true,
        price_cap_exceeded: true,
        max_price_usd: this.maxPriceUsd,
        hint: "The quote is above maxPriceUsd: nothing was signed. Raise the cap or call a cheaper endpoint.",
        quote: json,
      });
    }
    let entetesPaiement: Record<string, string>;
    try {
      entetesPaiement = http.encodePaymentSignatureHeader(await http.createPaymentPayload(devis));
    } catch (erreur) {
      return JSON.stringify({
        error: "payment_failed",
        status: 402,
        message: `The x402 payment could not be built: ${String(erreur).slice(0, 200)}`,
      });
    }
    const payee = await this.envoyer(url, { ...this.entetes(false), ...entetesPaiement });
    if (payee.status === 402) {
      const { json: refus } = await lireCorps(payee);
      const { code, message } = codeEtMessage(refus);
      return JSON.stringify({
        error: "payment_failed",
        status: 402,
        code,
        message: `The signed payment was not accepted: ${message ?? code ?? 402}`,
      });
    }
    return this.rendre(payee);
  }

  /** The tool's answer for a response that is not paid again. */
  private async rendre(reponse: Response): Promise<string> {
    const corps = await lireCorps(reponse);
    if (reponse.status >= 200 && reponse.status < 300) {
      if (corps.json !== undefined) return JSON.stringify(corps.json);
      if (corps.texte !== null) return JSON.stringify({ content_type: corps.type || null, text: corps.texte });
      return JSON.stringify({
        content_type: corps.type || null,
        size_bytes: corps.octets,
        hint: "Binary response (for example a PDF): call the route with your own HTTP client to get the bytes.",
      });
    }
    const { code, message } = codeEtMessage(corps.json);
    if (reponse.status === 402) {
      if (this.rail === "api_key" && code === "credits_insuffisants") {
        return JSON.stringify({ error: "insufficient_credits", status: 402, code, message, body: corps.json });
      }
      const hint: Record<Rail, string> = {
        quote: "No API key or wallet configured. Provide apiKey (prepaid credits) or walletKey (x402) to pay.",
        x402: "The quote offers no option the wallet can read: nothing was signed.",
        api_key: "The service asked for an x402 payment although an API key is set: nothing was charged. Check the key.",
      };
      return JSON.stringify({ payment_required: true, hint: hint[this.rail], quote: corps.json as Json });
    }
    return JSON.stringify({
      error: "http_error",
      status: reponse.status,
      code,
      message,
      body: corps.json !== undefined ? corps.json : corps.texte,
    });
  }
}
