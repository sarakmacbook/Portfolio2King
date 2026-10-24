import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { GET as walletScanGET } from "../src/app/api/wallet/scan/route";
import {
  detectWalletAddressKind,
  encodeBalanceOfCall,
  formatUnitsFromHex,
  scanWalletAddress,
  shortWalletAddress,
  normaliseWalletChain,
} from "../src/lib/wallet-scanner";

test("detectWalletAddressKind identifies EVM, Solana, Bitcoin, and Tron addresses", () => {
  assert.equal(
    detectWalletAddressKind("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"),
    "evm",
  );
  assert.equal(
    detectWalletAddressKind("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"),
    "bitcoin",
  );
  assert.equal(
    detectWalletAddressKind("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"),
    "bitcoin",
  );
  assert.equal(
    detectWalletAddressKind("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"),
    "tron",
  );
  assert.equal(
    detectWalletAddressKind("7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV"),
    "solana",
  );
  assert.equal(detectWalletAddressKind(""), null);
  assert.equal(detectWalletAddressKind("not-an-address"), null);
});

test("formatUnitsFromHex and encodeBalanceOfCall handle ERC-20 balance payloads", () => {
  // 2.5 ETH = 2.5 * 10^18 = 2500000000000000000 = 0x22b1c8c1227a0000
  assert.equal(formatUnitsFromHex("0x22b1c8c1227a0000", 18), 2.5);
  // 1250.5 USDT (6 decimals) = 1250500000 = 0x4a891da0
  assert.equal(formatUnitsFromHex("0x4a891da0", 6), 1250.5);
  assert.equal(formatUnitsFromHex("0x0", 18), 0);

  assert.equal(
    encodeBalanceOfCall("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"),
    "0x70a08231000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045",
  );
});

test("scanWalletAddress and /api/wallet/scan scan EVM, Solana, and Bitcoin wallets", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("ethereum-rpc.publicnode.com")) {
        const body = JSON.parse(String(init?.body ?? "[]")) as Array<{ id: number }>;
        return new Response(
          JSON.stringify(
            body.map((req) => ({
              jsonrpc: "2.0",
              id: req.id,
              // id 0 = native ETH (1.5 ETH = 0x14d1120d7b160000), id 1 = USDT (500 USDT = 0x1dcd6500)
              result:
                req.id === 0
                  ? "0x14d1120d7b160000"
                  : req.id === 1
                    ? "0x1dcd6500"
                    : "0x0",
            })),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("solana-rpc.publicnode.com")) {
        return new Response(
          JSON.stringify([
            { jsonrpc: "2.0", id: 1, result: { value: 4_000_000_000 } }, // 4 SOL
            {
              jsonrpc: "2.0",
              id: 2,
              result: {
                value: [
                  {
                    account: {
                      data: {
                        parsed: {
                          info: {
                            mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                            tokenAmount: { uiAmount: 250 },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("mempool.space/api/address/")) {
        return new Response(
          JSON.stringify({
            chain_stats: { funded_txo_sum: 150_000_000, spent_txo_sum: 25_000_000 },
            mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("Offline", { status: 502 });
    }) as typeof fetch;

    const evmAddr = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const evmScan = await scanWalletAddress(evmAddr, "ethereum");
    assert.equal(evmScan.addressKind, "evm");
    assert.equal(evmScan.balances.length, 2);
    assert.equal(evmScan.balances[0].symbol, "ETH");
    assert.equal(evmScan.balances[0].quantity, 1.5);
    assert.equal(evmScan.balances[1].symbol, "USDT");
    assert.equal(evmScan.balances[1].quantity, 500);

    const routeRes = await walletScanGET(
      new Request(`http://app.test/api/wallet/scan?address=${evmAddr}&chain=ethereum`),
    );
    assert.equal(routeRes.status, 200);
    const routeJson = (await routeRes.json()) as {
      ok: boolean;
      balances: Array<{ symbol: string; quantity: number }>;
    };
    assert.equal(routeJson.ok, true);
    assert.equal(routeJson.balances.length, 2);

    const solScan = await scanWalletAddress(
      "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV",
      "solana",
    );
    assert.equal(solScan.addressKind, "solana");
    assert.equal(solScan.balances.length, 2);
    assert.ok(solScan.balances.some((b) => b.symbol === "SOL" && b.quantity === 4));
    assert.ok(solScan.balances.some((b) => b.symbol === "USDC" && b.quantity === 250));

    const btcScan = await scanWalletAddress(
      "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
      "bitcoin",
    );
    assert.equal(btcScan.addressKind, "bitcoin");
    assert.equal(btcScan.balances.length, 1);
    assert.equal(btcScan.balances[0].symbol, "BTC");
    assert.equal(btcScan.balances[0].quantity, 1.25);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AddAssetDialog exposes Add via wallet address under Crypto", () => {
  const dialogSource = readFileSync(
    resolve(__dirname, "../src/components/AddAssetDialog.tsx"),
    "utf8",
  );
  assert.ok(dialogSource.includes("Add via wallet address"));
  assert.ok(dialogSource.includes("/api/wallet/scan"));
  assert.ok(dialogSource.includes("Scan wallet"));
});

test("shortWalletAddress trims an address for a folder name", () => {
  assert.equal(shortWalletAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"), "0xd8dA…6045");
  // Short values are left alone, blank stays blank.
  assert.equal(shortWalletAddress("0x1234"), "0x1234");
  assert.equal(shortWalletAddress("   "), "");
  // Always inside the 28-character folder-name limit.
  assert.ok(shortWalletAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045").length <= 28);
});

test("a wallet import is filed into a folder named after the wallet", () => {
  const actions = readFileSync(resolve(__dirname, "../src/app/actions.ts"), "utf8");
  const importBody = actions.slice(actions.indexOf("export async function importWalletBalances"));
  assert.ok(importBody.includes("folderForImport("), "the import reuses or creates a folder");
  assert.ok(importBody.includes("saveHoldingFolderAssignments("), "imported holdings are filed");
  assert.ok(importBody.includes("shortWalletAddress(address)"), "the folder is named after the address");
  assert.ok(importBody.includes("folderName !== null"), "a caller can still import without a folder");

  const dialog = readFileSync(resolve(__dirname, "../src/components/AddAssetDialog.tsx"), "utf8");
  assert.ok(dialog.includes("File into a folder"), "the dialog offers the folder");
  assert.ok(dialog.includes("walletFolderName"), "the folder can be named");
  assert.ok(dialog.includes("folderName: walletFileIntoFolder"), "the choice reaches the action");
  assert.ok(
    !dialog.includes("DeBank was unavailable"),
    "the 404 notice is worded as a chain read, not a DeBank error",
  );
});

test("the chain filter accepts any chain DeBank knows, not just the built-in list", async () => {
  assert.equal(normaliseWalletChain("sonic"), "sonic");
  assert.equal(normaliseWalletChain(" Sonic "), "sonic");
  assert.equal(normaliseWalletChain("auto"), "auto");
  assert.equal(normaliseWalletChain(""), "auto");
  assert.equal(normaliseWalletChain(null), "auto");
  // Anything that is not a sane chain id is ignored rather than passed to DeBank.
  assert.equal(normaliseWalletChain("../../etc/passwd"), "auto");
  assert.equal(normaliseWalletChain("x".repeat(40)), "auto");

  // The route accepts a chain that is not in WALLET_CHAINS.
  const scan = await walletScanGET(
    new Request("http://localhost/api/wallet/scan?address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&chain=sonic"),
  );
  const body = (await scan.json()) as { chain?: string };
  assert.equal(body.chain, "sonic");
});

test("the wallet dialog offers every chain a scan found, not only the built-in ones", () => {
  const dialog = readFileSync(resolve(__dirname, "../src/components/AddAssetDialog.tsx"), "utf8");
  assert.ok(dialog.includes("walletChainOptions"), "the filter is built from the scan result");
  assert.ok(dialog.includes("canonicalChainId(item.chain)"), "chains are compared canonically");
  assert.ok(dialog.includes("walletScanChainCount"), "the result says how many chains were hit");
});
