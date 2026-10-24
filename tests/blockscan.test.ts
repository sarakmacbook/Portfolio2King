import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  BLOCKSCAN_API_BASE,
  BLOCKSCAN_CHAINS,
  BLOCKSCAN_PACE_MS,
  BLOCKSCAN_TOTAL_BUDGET_MS,
  MAX_BLOCKSCAN_TOKENS,
  blockscanChainId,
  blockscanChainsFor,
  blockscanErrorText,
  blockscanNativeUrl,
  blockscanTokenUrl,
  fetchBlockscanBalances,
  parseBlockscanNativeBalance,
  parseBlockscanTokenBalances,
  readBlockscanAnswer,
} from "../src/lib/blockscan";
import { scanWalletAddress } from "../src/lib/wallet-scanner";

const ETH = { chain: "ethereum", label: "Ethereum" };
const BASE = { chain: "base", label: "Base" };

/** A row shaped like `addresstokenbalance` sends it. */
function token(overrides: Record<string, unknown> = {}) {
  return {
    TokenAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    TokenName: "Tether USD",
    TokenSymbol: "USDT",
    TokenQuantity: "1250500000",
    TokenDivisor: "6",
    TokenPriceUSD: "1.0001",
    ...overrides,
  };
}

test("the URLs point at Etherscan V2 — the API behind blockscan.com", () => {
  assert.equal(BLOCKSCAN_API_BASE, "https://api.etherscan.io/v2/api");

  const tokenUrl = blockscanTokenUrl(42161, "0xAbC0000000000000000000000000000000000001", "KEY 1");
  assert.ok(tokenUrl.startsWith(`${BLOCKSCAN_API_BASE}?`));
  assert.ok(tokenUrl.includes("chainid=42161"));
  assert.ok(tokenUrl.includes("module=account"));
  assert.ok(tokenUrl.includes("action=addresstokenbalance"));
  assert.ok(tokenUrl.includes("address=0xAbC0000000000000000000000000000000000001"));
  assert.ok(tokenUrl.includes("page=1"));
  assert.ok(tokenUrl.includes("offset=100"));
  // The key is encoded, never trusted raw.
  assert.ok(tokenUrl.includes("apikey=KEY%201"));

  const nativeUrl = blockscanNativeUrl(8453, "0xAbC0000000000000000000000000000000000001", "KEY");
  assert.ok(nativeUrl.includes("chainid=8453"));
  assert.ok(nativeUrl.includes("action=balance"));
});

test("the chain list is real Etherscan chain ids and respects the dialog filter", () => {
  const ids = new Map(BLOCKSCAN_CHAINS.map((spec) => [spec.chain, spec.id]));
  assert.equal(ids.get("ethereum"), 1);
  assert.equal(ids.get("bsc"), 56);
  assert.equal(ids.get("polygon"), 137);
  assert.equal(ids.get("optimism"), 10);
  assert.equal(ids.get("arbitrum"), 42161);
  assert.equal(ids.get("base"), 8453);
  assert.equal(ids.get("avalanche"), 43114);
  assert.ok(BLOCKSCAN_CHAINS.every((spec) => Number.isInteger(spec.id) && spec.id > 0));

  assert.equal(blockscanChainsFor("auto").length, BLOCKSCAN_CHAINS.length);
  assert.deepEqual(blockscanChainsFor("base").map((spec) => spec.chain), ["base"]);
  // Aliases are the app's own, so "eth" is Ethereum.
  assert.deepEqual(blockscanChainsFor("eth").map((spec) => spec.chain), ["ethereum"]);
  // A chain Etherscan supports but this sweep does not cover asks for nothing.
  assert.deepEqual(blockscanChainsFor("solana"), []);
  assert.equal(blockscanChainId("base"), 8453);
  assert.equal(blockscanChainId("nonsense"), null);
});

test("token balances are shaped from TokenQuantity / TokenDivisor", () => {
  const balances = parseBlockscanTokenBalances(
    {
      status: "1",
      message: "OK",
      result: [
        token(),
        token({
          TokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          TokenName: "USD Coin",
          TokenSymbol: "USDC",
          TokenQuantity: "1000000",
          TokenDivisor: "6",
          TokenPriceUSD: "1",
        }),
        // Junk rows: no contract, no symbol, zero quantity.
        token({ TokenAddress: "", TokenSymbol: "GHOST" }),
        token({ TokenAddress: "0xdead", TokenSymbol: "BAD" }),
        token({ TokenQuantity: "0" }),
        token({ TokenSymbol: "" }),
      ],
    },
    BASE,
  );

  assert.deepEqual(balances.map((b) => b.symbol).sort(), ["USDC", "USDT"]);
  const usdt = balances.find((b) => b.symbol === "USDT")!;
  assert.equal(usdt.quantity, 1250.5);
  assert.equal(usdt.price, 1.0001);
  assert.equal(usdt.valueUsd, 1250.63);
  assert.equal(usdt.chain, "base");
  assert.equal(usdt.chainLabel, "Base");
  assert.equal(usdt.contract, "0xdAC17F958D2ee523a2206206994597C13D831ec7");
  assert.equal(usdt.category, "stablecoin");
  assert.ok(usdt.id.startsWith("blockscan:base:0xdac17f"));
});

test("an unreadable answer is not a wallet with no tokens", () => {
  assert.deepEqual(parseBlockscanTokenBalances(null, ETH), []);
  assert.deepEqual(parseBlockscanTokenBalances({ result: "NOTOK" }, ETH), []);
  // Still capped, biggest first, so a spam-flooded chain cannot swamp the picker.
  const flood = Array.from({ length: 300 }, (_, index) =>
    token({
      TokenAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
      TokenSymbol: `T${index}`,
      TokenQuantity: String(1000 + index),
      TokenPriceUSD: "1",
    }),
  );
  const capped = parseBlockscanTokenBalances({ result: flood }, ETH);
  assert.equal(capped.length, MAX_BLOCKSCAN_TOKENS);
  assert.equal(capped[0].valueUsd >= capped[capped.length - 1].valueUsd, true);
});

test("a refusal is named — missing key, free plan, rate limit, empty", () => {
  // A wallet holding nothing on that chain is an answer.
  const empty = readBlockscanAnswer(
    { status: "0", message: "No tokens found", result: [] },
    ETH,
  );
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.balances, []);

  const badKey = readBlockscanAnswer(
    { status: "0", message: "NOTOK", result: "Invalid API Key" },
    ETH,
  );
  assert.equal(badKey.ok, false);
  assert.equal(badKey.needsKey, true);

  const plan = readBlockscanAnswer(
    {
      status: "0",
      message: "NOTOK",
      result: "This endpoint is not available on your plan, please upgrade your account",
    },
    ETH,
  );
  assert.equal(plan.ok, false);
  assert.equal(plan.proOnly, true);

  const limited = readBlockscanAnswer(
    { status: "0", message: "NOTOK", result: "Max calls per sec rate limit reached (2/sec)" },
    ETH,
  );
  assert.equal(limited.ok, false);
  assert.equal(limited.needsKey, undefined);
  assert.ok(limited.error?.includes("rate limit"));

  // The reason is always readable, without the "NOTOK —" prefix.
  assert.equal(
    blockscanErrorText({ status: "0", message: "NOTOK", result: "Query timeout" }),
    "Query timeout",
  );
});

test("the native coin comes back in wei", () => {
  assert.equal(parseBlockscanNativeBalance({ result: "1500000000000000000" }), 1.5);
  assert.equal(parseBlockscanNativeBalance({ result: "0" }), 0);
  assert.equal(parseBlockscanNativeBalance({ result: "NOTOK" }), 0);
  assert.equal(parseBlockscanNativeBalance(null), 0);
});

/** A fetch stub that answers per action, and counts the calls. */
function stubFetch(handler: (url: string) => unknown) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return { ok: true, json: async () => handler(url) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("without a key nothing is asked, and the reason is the key", async () => {
  const { impl, calls } = stubFetch(() => ({ status: "1", result: [] }));
  const scan = await fetchBlockscanBalances("0x0000000000000000000000000000000000000001", {
    apiKey: "",
    fetchImpl: impl,
  });
  assert.equal(scan.ok, false);
  assert.equal(scan.needsKey, true);
  assert.ok(scan.error?.includes("ETHERSCAN_API_KEY"));
  assert.equal(calls.length, 0, "no request is made without a key");
  assert.equal(scan.skippedChains.length, BLOCKSCAN_CHAINS.length);
});

test("a sweep reads one token call per chain and merges what came back", async () => {
  const { impl, calls } = stubFetch((url) => {
    if (url.includes("action=addresstokenbalance")) {
      if (url.includes("chainid=1&")) return { status: "1", message: "OK", result: [token()] };
      if (url.includes("chainid=8453&")) {
        return {
          status: "1",
          message: "OK",
          result: [token({ TokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", TokenSymbol: "USDC", TokenName: "USD Coin", TokenQuantity: "5000000", TokenDivisor: "6", TokenPriceUSD: "1" })],
        };
      }
      return { status: "0", message: "No tokens found", result: [] };
    }
    return { status: "1", result: "0" };
  });

  const scan = await fetchBlockscanBalances("0x0000000000000000000000000000000000000001", {
    apiKey: "KEY",
    fetchImpl: impl,
    paceMs: 0,
  });

  assert.equal(scan.ok, true);
  assert.equal(scan.answeredChains, BLOCKSCAN_CHAINS.length);
  assert.deepEqual(scan.skippedChains, []);
  assert.deepEqual(scan.balances.map((b) => b.symbol).sort(), ["USDC", "USDT"]);
  // One call per chain on a whole-wallet sweep: native coins come from the
  // direct read, so the budget goes to tokens.
  assert.equal(calls.length, BLOCKSCAN_CHAINS.length);
  assert.ok(calls.every((url) => url.includes("action=addresstokenbalance")));
});

test("a single-chain scan also reads the native coin", async () => {
  const { impl, calls } = stubFetch((url) =>
    url.includes("action=balance")
      ? { status: "1", result: "2500000000000000000" }
      : { status: "1", message: "OK", result: [] },
  );

  const scan = await fetchBlockscanBalances("0x0000000000000000000000000000000000000001", {
    apiKey: "KEY",
    fetchImpl: impl,
    chainFilter: "base",
    paceMs: 0,
  });

  assert.equal(calls.length, 2);
  assert.equal(scan.balances.length, 1);
  assert.equal(scan.balances[0].symbol, "ETH");
  assert.equal(scan.balances[0].quantity, 2.5);
  assert.equal(scan.balances[0].chain, "base");
  // Unpriced on purpose: the scanner's market lookup fills this in.
  assert.equal(scan.balances[0].price, 0);
});

test("a free key on the paid endpoint is reported, not shown as an empty wallet", async () => {
  const { impl } = stubFetch(() => ({
    status: "0",
    message: "NOTOK",
    result: "This endpoint is not available on your plan, please upgrade your account",
  }));
  const scan = await fetchBlockscanBalances("0x0000000000000000000000000000000000000001", {
    apiKey: "FREE",
    fetchImpl: impl,
    paceMs: 0,
  });
  assert.equal(scan.ok, false);
  assert.equal(scan.proOnly, true);
  assert.ok(scan.error?.includes("paid"));
});

test("the time budget stops the sweep and reports what was left out", async () => {
  const { impl } = stubFetch(() => ({ status: "1", message: "OK", result: [] }));
  let clock = 0;
  const scan = await fetchBlockscanBalances("0x0000000000000000000000000000000000000001", {
    apiKey: "KEY",
    fetchImpl: impl,
    paceMs: 0,
    budgetMs: 10_000,
    // Every reading of the clock jumps 6 s: the first chain fits, the rest do not.
    now: () => (clock += 6_000),
  });
  assert.equal(scan.checkedChains.length, 1);
  assert.equal(scan.skippedChains.length, BLOCKSCAN_CHAINS.length - 1);
});

test("pacing keeps a sweep under Etherscan's two calls a second", async () => {
  const { impl } = stubFetch(() => ({ status: "1", message: "OK", result: [] }));
  const waits: number[] = [];
  await fetchBlockscanBalances("0x0000000000000000000000000000000000000001", {
    apiKey: "KEY",
    fetchImpl: impl,
    chains: BLOCKSCAN_CHAINS.slice(0, 3),
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  assert.deepEqual(waits, [BLOCKSCAN_PACE_MS, BLOCKSCAN_PACE_MS, BLOCKSCAN_PACE_MS]);
  assert.ok(BLOCKSCAN_PACE_MS >= 500, "550 ms is slower than the 2/sec limit");
  assert.ok(BLOCKSCAN_TOTAL_BUDGET_MS >= 10_000);
});

const read = (path: string) => readFileSync(resolve(__dirname, "../src", path), "utf8");

test("Blockscan is a source the user picks, and the scan route carries it", () => {
  const route = read("app/api/wallet/scan/route.ts");
  assert.ok(route.includes('params.get("source")'), "the route reads the source");
  assert.ok(route.includes('"blockscan"'), "and knows the Blockscan value");
  assert.ok(route.includes("{ source }"), "and passes it to the scanner");

  const scanner = read("lib/wallet-scanner.ts");
  assert.ok(scanner.includes("fetchBlockscanBalances("), "the scanner can read Blockscan");
  assert.ok(scanner.includes('source: "blockscan"'), "the result says where it came from");
  assert.ok(
    scanner.includes("source === \"blockscan\" && !isEvm"),
    "a non-EVM address gets a plain explanation instead of an empty scan",
  );

  const dialog = read("components/AddAssetDialog.tsx");
  assert.ok(dialog.includes("Scan via Blockscan"), "the picker offers it");
  assert.ok(dialog.includes("source: walletSource"), "the choice is sent with the scan");
  assert.ok(dialog.includes("via Blockscan"), "the result says it was used");
  assert.ok(dialog.includes("ETHERSCAN_API_KEY"), "and the key requirement is explained");
  // The chain filter is gone: the source menu replaced it.
  assert.equal(dialog.includes("walletChainOptions"), false, "no chain dropdown");
  assert.equal(dialog.includes("Wallet blockchain"), false, "no chain select");
});

test("Blockscan refuses a non-EVM address in words, not with an empty scan", async () => {
  await assert.rejects(
    () =>
      scanWalletAddress("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "auto", {
        source: "blockscan",
      }),
    /Blockscan only indexes EVM addresses/,
  );
});

test("an auto scan falls back to Blockscan when DeBank cannot answer", () => {
  const scanner = read("lib/wallet-scanner.ts");
  const body = scanner.slice(scanner.indexOf("if (source === \"auto\" && blockscanApiKey()"));
  assert.ok(body.includes("fetchBlockscanBalances("), "the same sweep runs as the fallback");
  assert.ok(body.includes("source: \"blockscan\""), "and the result says so");
  assert.ok(body.includes("mergeWithDirect("), "with the direct read still merged in");
});
