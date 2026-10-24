import { NextResponse } from "next/server";
import {
  normaliseWalletChain,
  scanWalletAddress,
  type WalletScanSource,
} from "@/lib/wallet-scanner";
import { getScannerKeys } from "@/lib/scanner-keys";
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
 * token "unknown" rather than hidden.
 *
 * API keys are read from the app settings (added in the scan dialog) and fall
 * back to `DEBANK_ACCESS_KEY` / `ETHERSCAN_API_KEY` / `MORALIS_API_KEY`, plus
 * `CMC_PRO_API_KEY` for the CoinMarketCap contract lookup. Read-only — no wallet
 * keys or signatures.
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
    /**
     * API keys: the ones saved in the app first, the environment otherwise. A
     * missing key is not an error — the scan simply reads fewer sources — but
     * the response flags it so the dialog can offer the settings panel.
     */
    const keys = await getScannerKeys();
    const result = await scanWalletAddress(address, chain, { source, keys });
    // Contract match (local table + CoinMarketCap) and market depth, so the
    // picker can rank real tokens above look-alikes and tokens nobody trades.
    // Never throws, never drops a balance.
    /**
     * Whether CoinMarketCap actually answered is reported back with the scan.
     * "Not listed" and "never asked" look identical on a balance, and the
     * picker's *only listed on CoinMarketCap* filter must switch itself off when
     * nothing was asked — a missing key must never empty the list.
     */
    let cmcLookup = { ok: false, asked: 0, listed: 0 };
    const balances = await enrichTokenTrust(result.balances, fetch, {
      cmcApiKey: keys.coinmarketcap,
      onCmcLookup: (report) => {
        cmcLookup = report;
      },
    });
    return NextResponse.json(
      {
        ok: true,
        ...result,
        balances,
        cmcChecked: cmcLookup.ok,
        cmcListed: cmcLookup.listed,
      },
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
