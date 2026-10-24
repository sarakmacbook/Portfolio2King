import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  MAX_MORALIS_TOKENS,
  MORALIS_API_BASE,
  MORALIS_CHAINS,
  MORALIS_NEEDS_KEY_MESSAGE,
  fetchMoralisBalances,
  moralisChainSlug,
  moralisChainsFor,
  moralisTokensUrl,
  parseMoralisTokens,
  readMoralisAnswer,
} from "../src/lib/moralis";

const ETH = { chain: "ethereum", label: "Ethereum" };

/** A row shaped like Moralis' `/wallets/{address}/tokens` result. */
function token(overrides: Record<string, unknown> = {}) {
  return {
    token_address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    symbol: "USDT",
    name: "Tether USD",
    logo: "https://cdn.moralis.io/eth/usdt.png",
    decimals: 6,
    balance: "1250500000",
    balance_formatted: "1250.5",
    possible_spam: false,
    verified_contract: true,
    usd_price: 1.0001,
    usd_value: 1250.63,
    ...overrides,
  };
}

test("the request is Moralis' one wallet-tokens endpoint", () => {
  assert.equal(MORALIS_API_BASE, "https://deep-index.moralis.io/api/v2.2");
  const url = moralisTokensUrl("0xAbC0000000000000000000000000000000000001", "base");
  assert.ok(url.startsWith(`${MORALIS_API_BASE}/wallets/0xAbC0000000000000000000000000000000000001/tokens?`));
  assert.ok(url.includes("chain=base"));
  assert.ok(url.includes("limit=100"));
  // Spam is never excluded server-side: the app marks and counts what it hides.
  assert.ok(url.includes("exclude_spam=false"));
});

test("the chain table maps the app's chains to Moralis slugs", () => {
  assert.equal(moralisChainSlug("ethereum"), "eth");
  assert.equal(moralisChainSlug("eth"), "eth");
  assert.equal(moralisChainSlug("bsc"), "bsc");
  assert.equal(moralisChainSlug("base"), "base");
  assert.equal(moralisChainSlug("solana"), null);
  assert.ok(MORALIS_CHAINS.every((spec) => spec.slug && spec.chain && spec.nativeSymbol));

  assert.equal(moralisChainsFor("auto").length, MORALIS_CHAINS.length);
  assert.deepEqual(moralisChainsFor("arbitrum").map((spec) => spec.chain), ["arbitrum"]);
  assert.deepEqual(moralisChainsFor("bitcoin"), []);
});

test("balances come from balance_formatted, with price, value and logo", () => {
  const balances = parseMoralisTokens(
    {
      result: [
        token(),
        token({
          token_address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          symbol: "USDC",
          name: "USD Coin",
          decimals: 6,
          balance: "5000000",
          balance_formatted: "5",
          usd_price: 1,
          usd_value: 5,
        }),
        // A raw balance with no formatted figure falls back to decimals.
        token({
          token_address: "0x1111111111111111111111111111111111111111",
          symbol: "RAW",
          decimals: 18,
          balance: "2000000000000000000",
          balance_formatted: undefined,
          usd_price: 2,
          usd_value: 4,
        }),
        // Nothing held, and a row with no symbol.
        token({ balance_formatted: "0", balance: "0" }),
        token({ symbol: "" }),
      ],
    },
    ETH,
  );

  const usdt = balances.find((b) => b.symbol === "USDT")!;
  assert.equal(usdt.quantity, 1250.5);
  assert.equal(usdt.price, 1.0001);
  assert.equal(usdt.valueUsd, 1250.63);
  assert.equal(usdt.chain, "ethereum");
  assert.equal(usdt.chainLabel, "Ethereum");
  assert.equal(usdt.contract, "0xdAC17F958D2ee523a2206206994597C13D831ec7");
  assert.equal(usdt.category, "stablecoin");
  assert.equal(usdt.logoUrl, "https://cdn.moralis.io/eth/usdt.png");
  assert.equal(usdt.spam, undefined, "a clean token carries no spam flag");

  const raw = balances.find((b) => b.symbol === "RAW")!;
  assert.equal(raw.quantity, 2);
  assert.equal(raw.valueUsd, 4);
});

test("the native coin has no contract address", () => {
  const [native] = parseMoralisTokens(
    {
      result: [
        token({
          token_address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          symbol: "ETH",
          name: "Ether",
          decimals: 18,
          balance: "1709495362615127",
          balance_formatted: "0.001709495362615127",
          native_token: true,
          usd_price: 3074.27,
          usd_value: 5.25,
        }),
      ],
    },
    ETH,
  );
  assert.equal(native.symbol, "ETH");
  assert.equal(native.contract, null);
  assert.equal(native.quantity, 0.0017095);
});

test("a token Moralis flags as spam is marked, never dropped", () => {
  const balances = parseMoralisTokens(
    {
      result: [
        token(),
        token({
          token_address: "0x2222222222222222222222222222222222222222",
          symbol: "USDC",
          name: "USD Coin",
          possible_spam: true,
          verified_contract: false,
          // A scam token "worth" a fortune: this is exactly what a dust cut-off misses.
          balance_formatted: "40000",
          usd_price: 1,
          usd_value: 40000,
        }),
      ],
    },
    ETH,
  );
  assert.equal(balances.length, 2, "the spam token is still in the answer");
  const flagged = balances.find((b) => b.contract === "0x2222222222222222222222222222222222222222")!;
  assert.equal(flagged.spam, true);
  assert.equal(flagged.valueUsd, 40000);
});

test("answers are capped, biggest first", () => {
  const flood = Array.from({ length: 300 }, (_, index) =>
    token({
      token_address: `0x${(index + 1).toString(16).padStart(40, "0")}`,
      symbol: `T${index}`,
      balance_formatted: String(100 + index),
      usd_price: 1,
      usd_value: 100 + index,
    }),
  );
  const capped = parseMoralisTokens({ result: flood }, ETH);
  assert.equal(capped.length, MAX_MORALIS_TOKENS);
  assert.ok(capped[0].valueUsd >= capped[capped.length - 1].valueUsd);
});

test("a rejection is named, and an empty list is an answer", () => {
  const badKey = readMoralisAnswer(
    { message: "Authorization failed. Please check your API key." },
    ETH,
  );
  assert.equal(badKey.ok, false);
  assert.equal(badKey.needsKey, true);

  const otherError = readMoralisAnswer({ message: "Too many requests" }, ETH);
  assert.equal(otherError.ok, false);
  assert.equal(otherError.needsKey, undefined);
  assert.ok(otherError.error?.includes("Too many requests"));

  const empty = readMoralisAnswer({ result: [], cursor: null }, ETH);
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.balances, []);

  assert.equal(readMoralisAnswer(null, ETH).ok, false);
});

/** A fetch stub that answers per chain slug and counts calls. */
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
  const { impl, calls } = stubFetch(() => ({ result: [] }));
  const scan = await fetchMoralisBalances("0x0000000000000000000000000000000000000001", {
    apiKey: "",
    fetchImpl: impl,
  });
  assert.equal(scan.ok, false);
  assert.equal(scan.needsKey, true);
  assert.equal(scan.error, MORALIS_NEEDS_KEY_MESSAGE);
  assert.equal(calls.length, 0, "no request is made without a key");
  assert.equal(scan.skippedChains.length, MORALIS_CHAINS.length);
});

test("a sweep asks once per chain and merges the answers", async () => {
  const { impl, calls } = stubFetch((url) => {
    if (url.includes("chain=eth")) return { result: [token()] };
    if (url.includes("chain=base")) {
      return {
        result: [
          token({
            token_address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            symbol: "USDC",
            name: "USD Coin",
            balance_formatted: "25",
            usd_price: 1,
            usd_value: 25,
          }),
        ],
      };
    }
    return { result: [] };
  });

  const scan = await fetchMoralisBalances("0x0000000000000000000000000000000000000001", {
    apiKey: "KEY",
    fetchImpl: impl,
  });

  assert.equal(scan.ok, true);
  assert.equal(scan.answeredChains, MORALIS_CHAINS.length);
  assert.deepEqual(scan.skippedChains, []);
  assert.equal(calls.length, MORALIS_CHAINS.length, "one request per chain");
  assert.deepEqual(scan.balances.map((b) => b.symbol).sort(), ["USDC", "USDT"]);
  assert.equal(scan.balances[0].symbol, "USDT", "sorted by value, USDT first");
});

test("a chain that refuses does not stop the sweep", async () => {
  const { impl } = stubFetch((url) => {
    if (url.includes("chain=bsc")) return { message: "Too many requests" };
    return { result: [token({ token_address: `0x${"a".repeat(40)}`, symbol: "ONE" })] };
  });
  const scan = await fetchMoralisBalances("0x0000000000000000000000000000000000000001", {
    apiKey: "KEY",
    fetchImpl: impl,
  });
  assert.equal(scan.ok, true);
  assert.ok(scan.answeredChains >= MORALIS_CHAINS.length - 1);
  assert.ok(scan.balances.length >= 1);
});

test("every chain failing is an error, not an empty wallet", async () => {
  const { impl } = stubFetch(() => ({ message: "Authorization failed" }));
  const scan = await fetchMoralisBalances("0x0000000000000000000000000000000000000001", {
    apiKey: "BAD",
    fetchImpl: impl,
  });
  assert.equal(scan.ok, false);
  assert.equal(scan.needsKey, true);
  assert.ok(scan.error?.includes("MORALIS_API_KEY"));
});

test("the time budget leaves the rest of the chains out and says so", async () => {
  let clock = 0;
  const { impl } = stubFetch(() => ({ result: [] }));
  const scan = await fetchMoralisBalances("0x0000000000000000000000000000000000000001", {
    apiKey: "KEY",
    fetchImpl: impl,
    budgetMs: 10_000,
    concurrency: 1,
    now: () => (clock += 6_000),
  });
  assert.equal(scan.skippedChains.length, MORALIS_CHAINS.length - 1);
});

const read = (path: string) => readFileSync(resolve(__dirname, "../src", path), "utf8");

test("Moralis is selectable in the picker, and it is preferred when a key is set", () => {
  const dialog = read("components/AddAssetDialog.tsx");
  assert.ok(dialog.includes("Scan via Moralis"), "the picker offers it");
  assert.ok(dialog.includes("via Moralis"), "the result says it was used");
  assert.ok(dialog.includes("MORALIS_API_KEY"), "and the key requirement is explained");

  const route = read("app/api/wallet/scan/route.ts");
  assert.ok(route.includes('"moralis"'), "the route accepts the source");

  const scanner = read("lib/wallet-scanner.ts");
  assert.ok(scanner.includes("fetchMoralisBalances("), "the scanner can read Moralis");
  assert.ok(scanner.includes('source: "moralis"'), "the result says where it came from");
  assert.ok(
    scanner.includes('if (moralisKey !== "")'),
    "a default scan falls back to Moralis when DeBank cannot answer",
  );
  // One source answers: a scan is not a merge of an index and the chains.
  assert.equal(scanner.includes("mergeWithDirect("), false, "no merged second opinion");
  assert.ok(
    scanner.includes("const readDirect = ()"),
    "the direct read is the fallback, and only runs when it is needed",
  );
});
