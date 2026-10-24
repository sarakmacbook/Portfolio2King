import { NextResponse } from "next/server";
import {
  normaliseWalletChain,
  scanWalletAddress,
  type WalletScanSource,
} from "@/lib/wallet-scanner";
import { enrichTokenTrust } from "@/lib/wallet-trust";

export const dynamic = "force-dynamic";

/**
 * GET /api/wallet/scan?address=0x...&chain=auto&source=auto
 *
 * Returns the tokens a wallet holds. EVM addresses are read through DeBank
 * (every chain it indexes, prices included) when available, and through the
 * public RPCs and block explorers otherwise; Solana, Bitcoin and Tron always use
 * the direct read. `chain` may be `auto` (every chain) or any chain id DeBank
 * knows — the filter is alias-aware, so `ethereum` and `eth` are the same.
 * `source=blockscan` swaps the index for Etherscan V2 — the API behind
 * blockscan.com — and `source=moralis` for Moralis, whose token list carries a
 * `possible_spam` verdict per token. Both merge the direct read in, so a missing
 * key or a paid-plan endpoint still answers with whatever the chains themselves
 * say. The response carries `source: "debank" | "blockscan" | "moralis" |
 * "onchain"` so the dialog can say where the numbers came from. Each balance is then matched against the
 * official contract table and looked up for organic trading volume
 * (`wallet-trust`) — best-effort, so a slow or rate-limited lookup leaves the
 * token "unknown" rather than hidden. Read-only — no keys or signatures.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const address = (params.get("address") ?? "").trim();
  const chain = normaliseWalletChain(params.get("chain"));
  const requestedSource = params.get("source");
  const source: WalletScanSource =
    requestedSource === "blockscan" || requestedSource === "moralis" ? requestedSource : "auto";

  if (!address) {
    return NextResponse.json(
      { error: "Paste a wallet address first." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await scanWalletAddress(address, chain, { source });
    // Contract match + market depth, so the picker can rank real tokens above
    // look-alikes and tokens nobody trades. Never throws, never drops a balance.
    const balances = await enrichTokenTrust(result.balances);
    return NextResponse.json(
      { ok: true, ...result, balances },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not scan that wallet address.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
