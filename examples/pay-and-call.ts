/**
 * Pay one request end to end with @x402/fetch.
 *
 * Usage:
 *   TEST_WALLET_KEY=0x... npm run pay-and-call
 *
 * TEST_WALLET_KEY is the private key of YOUR client test wallet (the payer)
 * — the server never holds any key. Fund it with test USDC on Base Sepolia
 * via https://faucet.circle.com. The "exact" scheme uses signed
 * authorizations: the client pays no gas.
 */
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const apiUrl = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const key = process.env.TEST_WALLET_KEY;
if (!key?.startsWith("0x")) {
  console.error("Set TEST_WALLET_KEY=0x... (your client test wallet, never the server's)");
  process.exit(1);
}

const account = privateKeyToAccount(key as `0x${string}`);
console.log(`Payer wallet: ${account.address}`);

const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const payingFetch = wrapFetchWithPayment(fetch, client);

// 1. Without payment: look at the 402 quote.
const quote = await fetch(`${apiUrl}/v1/entreprise/552032534`);
console.log(`\nWithout payment → HTTP ${quote.status}`);
console.log(JSON.stringify(await quote.json(), null, 2));

// 2. With automatic payment: @x402/fetch reads the 402, signs, retries.
console.log("\nPaying via x402…");
const res = await payingFetch(`${apiUrl}/v1/entreprise/552032534`);
console.log(`→ HTTP ${res.status}`);
console.log(JSON.stringify(await res.json(), null, 2));
console.log(
  "\nSettlement receipt (PAYMENT-RESPONSE header):",
  res.headers.get("payment-response") ?? res.headers.get("x-payment-response"),
);
