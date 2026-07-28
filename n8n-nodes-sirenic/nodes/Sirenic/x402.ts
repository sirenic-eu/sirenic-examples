/**
 * x402 payment layer.
 *
 * Sirenic answers `402 Payment Required` with a signable quote in the
 * `PAYMENT-REQUIRED` header. We sign one option of that quote with the user's
 * Base wallet and replay the request carrying `PAYMENT-SIGNATURE`.
 *
 * SAFETY MODEL — the reason this node exists rather than a generic x402 node:
 * every quote is checked BEFORE signing, against constraints the user set in
 * the credential. Two independent gates, on purpose:
 *
 *   1. a pre-flight check that reads the quote and refuses anything unexpected;
 *   2. a client policy that filters requirements a second time at signing time,
 *      so a server that changed its answer between the two calls still cannot
 *      get a different payment signed.
 *
 * This mirrors the belt-and-braces policy in Sirenic's own release tooling. A
 * node that can sign payments is only as trustworthy as its refusals.
 *
 * NOTE ON LANGUAGE: this package is written in English, unlike the rest of the
 * Sirenic codebase. n8n's verification guidelines require it — "Both the node
 * interface and all documentation must be in English only."
 */
import { privateKeyToAccount } from 'viem/accounts';
import { wrapFetchWithPayment } from '@x402/fetch';
import { x402Client } from '@x402/core/client';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { decodePaymentRequiredHeader } from '@x402/core/http';

/** Base mainnet, CAIP-2. Sirenic settles nowhere else. */
export const NETWORK = 'eip155:8453';

/** Circle's official USDC contract on Base mainnet. */
export const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** USDC has 6 decimals; quotes are expressed in atomic units. */
const DECIMALS = 1_000_000;

export interface PaymentSettings {
	privateKey: string;
	baseUrl: string;
	payTo: string;
	maxPerCall: number;
	maxPerExecution: number;
}

export interface CallResult {
	status: number;
	body: unknown;
	/** What was actually paid, in USD. Zero for a free endpoint. */
	paid: number;
}

interface QuoteOption {
	scheme: string;
	network: string;
	asset: string;
	payTo: string;
	amount: string;
}

export function toAtomic(usd: number): bigint {
	// Round rather than truncate: 0.105 in binary floating point is slightly
	// under, and truncating would put the ceiling one atomic unit below the
	// price the user typed — rejecting a payment they explicitly allowed.
	return BigInt(Math.round(usd * DECIMALS));
}

export function fromAtomic(atomic: bigint): number {
	return Number(atomic) / DECIMALS;
}

/**
 * Picks the USDC option of a quote and proves it is safe to sign.
 * Exported so it can be tested without touching the network.
 */
export function checkQuote(
	options: readonly QuoteOption[],
	settings: { payTo: string; maxPerCall: number },
	spentSoFar: bigint,
	maxPerExecution: number,
): { amount: bigint } {
	const usdc = options.find(
		(o) =>
			o.scheme === 'exact' &&
			o.network === NETWORK &&
			o.asset.toLowerCase() === USDC.toLowerCase(),
	);
	if (!usdc) {
		throw new Error(
			`No USDC-on-Base option in the payment quote. Sirenic only settles USDC on Base (${NETWORK}); refusing to pay.`,
		);
	}
	if (usdc.payTo.toLowerCase() !== settings.payTo.toLowerCase()) {
		throw new Error(
			`Payment address mismatch: the quote asks to pay ${usdc.payTo}, but the credential expects ${settings.payTo}. Refusing to sign — check the API Base URL.`,
		);
	}

	const amount = BigInt(usdc.amount);
	const perCall = toAtomic(settings.maxPerCall);
	if (amount > perCall) {
		throw new Error(
			`Quote is $${fromAtomic(amount).toFixed(6)} but "Max Amount Per Call" is $${settings.maxPerCall}. Raise the cap in the credential if this price is expected.`,
		);
	}

	const perExecution = toAtomic(maxPerExecution);
	if (spentSoFar + amount > perExecution) {
		throw new Error(
			`This call would bring the execution total to $${fromAtomic(spentSoFar + amount).toFixed(6)}, above the "Max Amount Per Execution" cap of $${maxPerExecution}. Stopping before spending more.`,
		);
	}
	return { amount };
}

/**
 * A payer bound to one workflow execution, so the per-execution cap is
 * enforced across every item the node processes.
 */
export class SirenicPayer {
	private spent = 0n;

	private authorised: bigint | null = null;

	private readonly paidFetch: typeof fetch;

	constructor(private readonly settings: PaymentSettings) {
		const account = privateKeyToAccount(settings.privateKey as `0x${string}`);
		const client = new x402Client();
		registerExactEvmScheme(client, { signer: account });
		// Second gate: even if the pre-flight passed, nothing gets signed unless
		// it matches the exact requirement we authorised a moment ago.
		client.registerPolicy((_version, requirements) =>
			requirements.filter(
				(r) =>
					r.scheme === 'exact' &&
					r.network === NETWORK &&
					r.asset.toLowerCase() === USDC.toLowerCase() &&
					r.payTo.toLowerCase() === settings.payTo.toLowerCase() &&
					this.authorised !== null &&
					BigInt(r.amount) === this.authorised,
			),
		);
		this.paidFetch = wrapFetchWithPayment(fetch, client);
	}

	/** Total spent so far in this execution, in USD. */
	get totalPaid(): number {
		return fromAtomic(this.spent);
	}

	async call(path: string, timeoutMs: number, dryRun: boolean): Promise<CallResult> {
		const url = `${this.settings.baseUrl.replace(/\/+$/, '')}${path}`;

		// Pre-flight: unpaid request. A free endpoint answers 200 straight away
		// and costs nothing.
		const preflight = await fetch(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(30_000),
		});
		if (preflight.status !== 402) {
			return { status: preflight.status, body: await readBody(preflight), paid: 0 };
		}

		const header = preflight.headers.get('payment-required');
		if (!header) {
			throw new Error(
				'The endpoint asked for payment but returned no signable quote (missing PAYMENT-REQUIRED header).',
			);
		}
		const quote = decodePaymentRequiredHeader(header) as { accepts: QuoteOption[] };
		const { amount } = checkQuote(
			quote.accepts ?? [],
			this.settings,
			this.spent,
			this.settings.maxPerExecution,
		);

		if (dryRun) {
			return {
				status: 402,
				body: {
					dry_run: true,
					would_pay_usd: fromAtomic(amount),
					pay_to: this.settings.payTo,
					network: NETWORK,
					resource: url,
					message: 'Dry run: the quote passed every check but no payment was signed.',
				},
				paid: 0,
			};
		}

		this.authorised = amount;
		const response = await this.paidFetch(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(timeoutMs),
		});
		this.authorised = null;

		const body = await readBody(response);
		if (response.status >= 400) {
			// Sirenic cancels the payment on 404/503, so nothing was charged.
			return { status: response.status, body, paid: 0 };
		}
		this.spent += amount;
		return { status: response.status, body, paid: fromAtomic(amount) };
	}
}

async function readBody(response: Response): Promise<unknown> {
	const type = response.headers.get('content-type') ?? '';
	if (type.includes('application/json')) {
		return response.json().catch(() => ({}));
	}
	// Rate limits and header-size errors answer in plain text; parsing them as
	// JSON would turn a real error into a silent empty object.
	return { message: await response.text().catch(() => '') };
}
