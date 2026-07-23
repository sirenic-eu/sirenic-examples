/**
 * Sirenic core client for agent frameworks.
 *
 * Wraps fetch with x402 payment (USDC or EURC on Base) and a HARD price cap:
 * any quote above `maxPriceUsd` is refused before signing — the tool then
 * returns the quote instead of paying. Without a wallet key, every tool
 * still works and returns the x402 quote (nice for discovery and dry runs).
 *
 * The server never sees your key: payments are EIP-3009 authorizations
 * signed locally and settled by the x402 facilitator.
 */
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import type { PaymentRequirements } from "@x402/core/types";

export interface SirenicOptions {
  /** EVM private key of YOUR paying wallet (0x…). Omit for quote-only mode. */
  walletKey?: string;
  /** Default: https://api.sirenic.eu */
  baseUrl?: string;
  /**
   * Hard per-call price cap in USD (default 1.0 — the most expensive Sirenic
   * call). Quotes above the cap are never signed.
   */
  maxPriceUsd?: number;
}

const USDC_DECIMALS = 6;

/** x402 client policy: drop any payment option above the cap (v1 and v2
 *  field names both handled). An empty result = nothing gets signed. */
export function pricecapPolicy(maxPriceUsd: number) {
  const maxAtomic = BigInt(Math.round(maxPriceUsd * 10 ** USDC_DECIMALS));
  return (_version: number, requirements: PaymentRequirements[]): PaymentRequirements[] =>
    requirements.filter((r) => {
      const brut =
        (r as { amount?: string }).amount ??
        (r as { maxAmountRequired?: string }).maxAmountRequired ??
        "0";
      try {
        return BigInt(brut) <= maxAtomic;
      } catch {
        return false;
      }
    });
}

export class Sirenic {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SirenicOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "https://api.sirenic.eu").replace(/\/$/, "");
    if (options.walletKey) {
      const client = new x402Client().registerPolicy(pricecapPolicy(options.maxPriceUsd ?? 1.0));
      registerExactEvmScheme(client, {
        signer: privateKeyToAccount(options.walletKey as `0x${string}`),
      });
      this.fetchImpl = wrapFetchWithPayment(fetch, client) as typeof fetch;
    } else {
      this.fetchImpl = fetch; // quote-only mode: 402s are returned as data
    }
  }

  /**
   * GET a Sirenic path (e.g. "/v1/recherche?q=danone"), paying if needed.
   * Returns a JSON-stringified result in every case:
   *  - 200 → the data;
   *  - 402 → { payment_required, price hint, quote } (cap exceeded or no wallet);
   *  - other → { error, status, body }.
   */
  async get(path: string): Promise<string> {
    if (!/^\/(v1|preview)\//.test(path)) {
      return JSON.stringify({ error: "invalid_path", message: "Only /v1/... and /preview/... paths are served." });
    }
    let reponse: Response;
    try {
      reponse = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(120_000),
      });
    } catch (erreur) {
      // The x402 client throws when no payment option passes the price cap.
      return JSON.stringify({
        error: "payment_refused_or_network",
        message: String(erreur).slice(0, 300),
        hint: "If this is a price-cap refusal, raise maxPriceUsd or call a cheaper endpoint.",
      });
    }
    const corps: unknown = await reponse.json().catch(() => ({}));
    if (reponse.status === 402) {
      return JSON.stringify({
        payment_required: true,
        hint: "No wallet configured (or quote above your price cap). Provide walletKey to pay automatically.",
        quote: corps,
      });
    }
    if (!reponse.ok) {
      return JSON.stringify({ error: "http_error", status: reponse.status, body: corps });
    }
    return JSON.stringify(corps);
  }
}
