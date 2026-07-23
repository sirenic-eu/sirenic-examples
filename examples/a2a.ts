/**
 * A2A (Agent2Agent) surface — get an x402 quote, then pay on the same task.
 *
 * Sirenic is an A2A 1.0 agent (Linux Foundation spec) with the a2a-x402
 * payment extension: skills are paid HTTP resources, quotes arrive as task
 * metadata, and the signed PaymentPayload goes back on the same task.
 *
 * Run the free part (quote) with no wallet at all:
 *   npx tsx examples/a2a.ts
 * Add TEST_WALLET_KEY (your client test wallet, Base mainnet USDC) to pay:
 *   TEST_WALLET_KEY=0x... npx tsx examples/a2a.ts
 *
 * Agent card: https://api.sirenic.eu/.well-known/agent-card.json
 * Extension spec: https://github.com/google-agentic-commerce/a2a-x402 (v0.1)
 */
import { privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const BASE = process.env.SIRENIC_URL ?? "https://api.sirenic.eu";
const X402_EXT = "https://github.com/google-a2a/a2a-x402/v0.1";

async function rpc(method: string, params: unknown): Promise<any> {
  const res = await fetch(`${BASE}/a2a`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "A2A-Version": "1.0",
      "A2A-Extensions": X402_EXT, // required: every skill is paid
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`A2A error ${body.error.code}: ${body.error.message}`);
  return body.result;
}

// 1. Ask for a company profile — no payment yet: the task comes back
//    `input-required` with the x402 quote in its status-message metadata.
const first = await rpc("SendMessage", {
  message: {
    messageId: crypto.randomUUID(),
    role: "ROLE_USER",
    parts: [{ data: { path: "/v1/entreprise/552032534" } }],
    // Same thing, template style:
    // parts: [{ data: { skill: "/v1/entreprise/{siren}", params: { siren: "552032534" } } }],
  },
});
const task = first.task;
const quote = task.status.message.metadata["x402.payment.required"];
console.log("Task", task.id, "state:", task.status.state);
console.log("Quote:", JSON.stringify(quote.accepts[0], null, 2));

// 2. Optional: settle the quote and get the data on the same task.
if (!process.env.TEST_WALLET_KEY) {
  console.log("\nSet TEST_WALLET_KEY to pay the quote and fetch the profile.");
  process.exit(0);
}
const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(process.env.TEST_WALLET_KEY as `0x${string}`) });
const payload = await client.createPaymentPayload(quote);

const second = await rpc("SendMessage", {
  message: {
    messageId: crypto.randomUUID(),
    taskId: task.id, // same task: that's where the quote lives
    role: "ROLE_USER",
    parts: [],
    metadata: {
      "x402.payment.status": "payment-submitted",
      "x402.payment.payload": payload,
    },
  },
});
const done = second.task;
console.log("State:", done.status.state); // TASK_STATE_COMPLETED
console.log("Receipt:", JSON.stringify(done.status.message.metadata["x402.payment.receipts"]?.[0]));
console.log("Profile:", JSON.stringify(done.artifacts[0].parts[0].data).slice(0, 300), "…");
