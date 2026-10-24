import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_BLOCKSCOUT_TOKENS,
  blockscoutBaseUrl,
  blockscoutQuantity,
  blockscoutTokenBalancesUrl,
  blockscoutTokenListUrl,
  fetchBlockscoutTokens,
  parseBlockscoutTokenBalances,
  parseBlockscoutTokenList,
} from "../src/lib/blockscout";

/** A Blockscout v1 `tokenlist` entry. */
function v1Token(overrides: Record<string, unknown> = {}) {
  return {
    contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    tokenName: "Tether USD",
    symbol: "USDT",
    decimals: "6",
    balance: "1250000000",
    type: "ERC-20",
    ...overrides,
  };
}

test("blockscout URLs point at the public instance for the chain", () => {
  assert.equal(blockscoutBaseUrl("ethereum"), "https://eth.blockscout.com");
  assert.equal(blockscoutBaseUrl("Ethereum"), "https://eth.blockscout.com");
  assert.equal(blockscoutBaseUrl("bsc"), null, "no public instance for BNB Chain");

  assert.equal(
    blockscoutTokenListUrl("https://eth.blockscout.com/", "0xAbC0000000000000000000000000000000000001"),
    "https://eth.blockscout.com/api?module=account&action=tokenlist&address=0xAbC0000000000000000000000000000000000001",
  );
  assert.equal(
    blockscoutTokenBalancesUrl("https://eth.blockscout.com", "0xAbC0000000000000000000000000000000000001"),
    "https://eth.blockscout.com/api/v2/addresses/0xAbC0000000000000000000000000000000000001/token-balances",
  );
});

test("parseBlockscoutTokenList shapes every ERC-20 a wallet holds", () => {
  const tokens = parseBlockscoutTokenList({
    status: "1",
    message: "OK",
    result: [
      v1Token(),
      v1Token({
        contractAddress: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
        tokenName: "Wrapped BTC",
        symbol: "wbtc",
        decimals: "8",
        balance: "150000000",
      }),
      // NFTs are not holdings with a quantity.
      v1Token({ contractAddress: "0x00000000000000000000000000000000000000aa", type: "ERC-721", symbol: "NFT", decimals: "0" }),
      // Zero balance, junk address, duplicate contract.
      v1Token({ contractAddress: "0x00000000000000000000000000000000000000bb", balance: "0" }),
      v1Token({ contractAddress: "not-an-address", balance: "5" }),
      v1Token({ balance: "99" }),
    ],
  });

  assert.deepEqual(tokens.map((token) => token.symbol), ["USDT", "WBTC"]);
  assert.equal(tokens[0].quantity, 1250);
  assert.equal(tokens[0].name, "Tether USD");
  assert.equal(tokens[0].stablecoin, true);
  assert.equal(tokens[1].quantity, 1.5);
  assert.equal(tokens[1].symbol, "WBTC", "symbols are upper-cased for display");
  assert.equal(tokens[1].decimals, 8);
});

test("an empty Blockscout answer is an empty wallet, not a crash", () => {
  assert.deepEqual(parseBlockscoutTokenList({ status: "0", message: "No tokens found", result: [] }), []);
  assert.deepEqual(parseBlockscoutTokenList({ status: "0", message: "No tokens found" }), []);
  assert.deepEqual(parseBlockscoutTokenList(null), []);
  assert.deepEqual(parseBlockscoutTokenList("nope"), []);
});

test("parseBlockscoutTokenBalances reads the v2 shape and drops spam", () => {
  const tokens = parseBlockscoutTokenBalances([
    {
      token: {
        address_hash: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        name: "USD Coin",
        symbol: "USDC",
        decimals: "6",
        type: "ERC-20",
        reputation: "ok",
      },
      value: "2500000",
    },
    {
      token: {
        address_hash: "0x00000000000000000000000000000000000000cc",
        name: "Claim your airdrop",
        symbol: "SCAM",
        decimals: "18",
        type: "ERC-20",
        reputation: "spam",
      },
      value: "1000000000000000000000",
    },
  ]);

  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].symbol, "USDC");
  assert.equal(tokens[0].quantity, 2.5);
});

test("blockscoutQuantity handles raw integers, hex and decimals", () => {
  assert.equal(blockscoutQuantity("1500000000000000000", 18), 1.5);
  assert.equal(blockscoutQuantity("0xde0b6b3a7640000", 18), 1);
  assert.equal(blockscoutQuantity(5, 0), 5);
  assert.equal(blockscoutQuantity("0", 18), 0);
  assert.equal(blockscoutQuantity("nope", 18), 0);
  assert.equal(blockscoutQuantity("-5", 18), 0);
});

test("the token cap keeps the most valuable tokens", () => {
  const many = Array.from({ length: MAX_BLOCKSCOUT_TOKENS + 10 }, (_, index) =>
    v1Token({
      contractAddress: `0x${index.toString(16).padStart(40, "0")}`,
      symbol: `T${index}`,
      balance: String(index + 1),
    }),
  );
  const tokens = parseBlockscoutTokenList({ result: many });
  assert.equal(tokens.length, MAX_BLOCKSCOUT_TOKENS);
  assert.equal(tokens[0].symbol, `T${MAX_BLOCKSCOUT_TOKENS + 9}`, "biggest holding first");
});

test("fetchBlockscoutTokens falls back to v2 and never throws", async () => {
  const seen: string[] = [];
  const tokens = await fetchBlockscoutTokens(
    "ethereum",
    "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    (async (url: string) => {
      seen.push(String(url));
      if (String(url).includes("/api/v2/")) {
        return new Response(
          JSON.stringify([
            {
              token: { address_hash: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", symbol: "UNI", name: "Uniswap", decimals: "18", type: "ERC-20" },
              value: "3000000000000000000",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch,
  );
  assert.equal(seen.length, 2, "v1 was tried first, then v2");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].symbol, "UNI");
  assert.equal(tokens[0].quantity, 3);

  // Offline, blocked, or a chain with no instance: no tokens, no exception.
  const offline = await fetchBlockscoutTokens(
    "ethereum",
    "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch,
  );
  assert.deepEqual(offline, []);

  const unsupported = await fetchBlockscoutTokens("bsc", "0xAbC0000000000000000000000000000000000001");
  assert.deepEqual(unsupported, []);
});
