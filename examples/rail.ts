/**
 * How the proof scripts pay: an API key, or the x402 test wallet. One rule, written once, read by
 * examples/smoke-test.ts and scripts/payer-un-endpoint.ts.
 *
 *   SIRENIC_API_KEY  an API key (header X-Api-Key, debited in credits, no on-chain settlement). It wins
 *                    when both are set: content checks go through the key, and only the payment path
 *                    itself needs x402 (rule of 24/09/2026, kopko13/sirenic ticket 166: each x402
 *                    settlement above the facilitator's free tier costs money).
 *   TEST_WALLET_KEY  private key of a DEDICATED throwaway wallet, for x402 on Base. On this rail every
 *                    request also declares x-sirenic-motif: smoke-paye, so the ledger records why the
 *                    settlement exists (the server ignores it for any payer other than its test wallet).
 *
 * The key is never printed. Under the key, a 402 is a failure to report, never a payment.
 */

export const ENTETE_CLE = "X-Api-Key";
export const ENTETE_MOTIF = "x-sirenic-motif";
export const MOTIF_SMOKE = "smoke-paye";
export const ENTETE_CREDITS = "x-credits-charged";

export type Rail =
  | { type: "cle"; cle: string; walletIgnore: boolean }
  | { type: "x402"; cleWallet: `0x${string}` };

/** The rail chosen from the environment, or the reason why nothing can pay. */
export function choisirRail(env: NodeJS.ProcessEnv = process.env): Rail | { erreur: string } {
  const cle = env.SIRENIC_API_KEY?.trim();
  const wallet = env.TEST_WALLET_KEY?.trim();
  if (cle) return { type: "cle", cle, walletIgnore: Boolean(wallet) };
  if (wallet?.startsWith("0x")) return { type: "x402", cleWallet: wallet as `0x${string}` };
  return { erreur: "Set SIRENIC_API_KEY=<API key> (content checks) or TEST_WALLET_KEY=0x<private key of a DEDICATED test wallet> (x402)" };
}

/** The headers every request of this rail carries. */
export function entetesRail(rail: Rail): Record<string, string> {
  return rail.type === "cle" ? { [ENTETE_CLE]: rail.cle } : { [ENTETE_MOTIF]: MOTIF_SMOKE };
}

/** One line for the top of the output, without the key. */
export function ligneRail(rail: Rail): string {
  return rail.type === "cle"
    ? `Rail: API key (${ENTETE_CLE}, debited in credits, no on-chain settlement)${rail.walletIgnore ? "; TEST_WALLET_KEY ignored" : ""}`
    : `Rail: x402 (test wallet, ${ENTETE_MOTIF}: ${MOTIF_SMOKE})`;
}

/** A fetch that adds the rail headers to every request. On the x402 rail, wrap THIS fetch with
 *  wrapFetchWithPayment, so the paid retry carries them too. */
export function fetchAvecRail(rail: Rail, base: typeof fetch = fetch): typeof fetch {
  const ajout = entetesRail(rail);
  return (entree, init) => {
    const entetes = new Headers(init?.headers ?? (entree instanceof Request ? entree.headers : undefined));
    for (const [nom, valeur] of Object.entries(ajout)) entetes.set(nom, valeur);
    return base(entree, { ...init, headers: entetes });
  };
}

/** Credits debited for one response (header x-credits-charged, in dollars), or null when absent. */
export function creditsDebites(r: Response): number | null {
  const brut = r.headers.get(ENTETE_CREDITS);
  if (brut === null || brut.trim() === "") return null;
  const n = Number(brut);
  return Number.isFinite(n) ? n : null;
}
