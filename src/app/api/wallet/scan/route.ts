import { NextResponse } from "next/server";
import {
  isValidWalletChain,
  scanWalletAddress,
  type WalletChain,
} from "@/lib/wallet-scanner";

export const dynamic = "force-dynamic";

/**
 * GET /api/wallet/scan?address=0x...&chain=auto
 *
 * Scans public blockchain RPCs / explorers for native and token balances held by
 * the given wallet address (EVM, Solana, Bitcoin, or Tron). Read-only — no keys
 * or signatures required.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const address = (params.get("address") ?? "").trim();
  const rawChain = (params.get("chain") ?? "auto").trim().toLowerCase();
  const chain: WalletChain = isValidWalletChain(rawChain) ? rawChain : "auto";

  if (!address) {
    return NextResponse.json(
      { error: "Paste a wallet address first." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await scanWalletAddress(address, chain);
    return NextResponse.json(
      { ok: true, ...result },
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
