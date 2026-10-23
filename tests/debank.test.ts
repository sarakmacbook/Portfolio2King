import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEBANK_CHAIN_IDS,
  MAX_DEBANK_TOKENS,
  debankChainIdFor,
  debankRequests,
  debankTokenItems,
  fetchDebankBalances,
  parseDebankTokens,
  walletChainFromDebankId,
} from "../src/lib/debank";

/** A DeBank `all_token_list` entry, shaped like the real API's response. */
function token(overrides: Record<string, unknown> = {}) {
  return {
    id: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    chain: "eth",
    name: "Tether USD",
    symbol: "USDT",
    decimals: 6,
    amount: 1250.5,
    price: 1,
    value_usd: 1250.5,
    is_core: true,
    logo_url: "https://static.debank.com/usdt.png",
    ...overrides,
  };
}

test("DeBank chain ids map both ways", () => {
  assert.equal(DEBANK_CHAIN_IDS.eth, "ethereum");
  assert.equal(DEBANK_CHAIN_IDS.arb, "arbitrum");
  assert.equal(walletChainFromDebankId("arb"), "arbitrum");
  assert.equal(walletChainFromDebankId("BSC"), "bsc");
  assert.equal(walletChainFromDebankId("unknown-chain"), null);
  assert.equal(walletChainFromDebankId(42), null);
  assert.equal(debankChainIdFor("ethereum"), "eth");
  assert.equal(debankChainIdFor("arbitrum"), "arb");
  assert.equal(debankChainIdFor("solana"), "solana");
  // "auto" means "every chain", so no chain id is sent.
  assert.equal(debankChainIdFor("auto"), null);
});

test("debankTokenItems accepts both API shapes and rejects error bodies", () => {
  assert.deepEqual(debankTokenItems([{ symbol: "ETH" }]), [{ symbol: "ETH" }]);
  assert.deepEqual(debankTokenItems({ data: [{ symbol: "ETH" }] }), [{ symbol: "ETH" }]);
  assert.deepEqual(debankTokenItems({ tokens: [{ symbol: "ETH" }] }), [{ symbol: "ETH" }]);
  assert.deepEqual(debankTokenItems({ data: { tokens: [{ symbol: "ETH" }] } }), [{ symbol: "ETH" }]);
  // A non-zero error_code means the array next to it is not a token list.
  assert.deepEqual(debankTokenItems({ error_code: 1, data: [{ symbol: "SCAM" }] }), []);
  assert.deepEqual(debankTokenItems(null), []);
  assert.deepEqual(debankTokenItems("nope"), []);
});

test("parseDebankTokens shapes balances, keeps chain, price, logo and category", () => {
  const balances = parseDebankTokens([
    token(),
    token({
      id: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
      symbol: "WBTC",
      name: "Wrapped BTC",
      chain: "arb",
      decimals: 8,
      amount: 0.25,
      price: 61000,
      value_usd: 15250,
    }),
  ]);

  // Sorted by USD value, biggest first.
  assert.deepEqual(balances.map((b) => b.symbol), ["WBTC", "USDT"]);
  const btc = balances[0];
  assert.equal(btc.chain, "arbitrum");
  assert.equal(btc.chainLabel, "Arbitrum");
  assert.equal(btc.quantity, 0.25);
  assert.equal(btc.valueUsd, 15250);
  assert.equal(btc.contract, "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599");
  assert.equal(btc.logoUrl, "https://static.debank.com/usdt.png");
  assert.equal(btc.category, "volatile");
  // A USD-pegged ticker is a stablecoin, which the Holdings tabs split on.
  assert.equal(balances[1].category, "stablecoin");
});

test("parseDebankTokens drops empty, spam and duplicate tokens", () => {
  const balances = parseDebankTokens([
    token({ amount: 0 }),
    // Unpriced airdrop that DeBank does not recognise: noise, not a holding.
    token({ id: "0x0000000000000000000000000000000000000001", symbol: "SCAMAIR", price: 0, value_usd: 0, is_core: false }),
    // Unpriced but recognised by DeBank: still worth showing.
    token({ id: "0x0000000000000000000000000000000000000002", symbol: "NEW", price: 0, value_usd: 0, is_core: true }),
    // Same token twice (e.g. a staked + native view of one balance).
    token(),
    token({ symbol: "USDT" }),
    // DeBank only indexes EVM chains.
    token({ id: "solana-token", chain: "sol", symbol: "SOL", price: 178, value_usd: 178 }),
  ]);

  assert.deepEqual(balances.map((b) => b.symbol).sort(), ["NEW", "USDT"]);
  assert.equal(balances.filter((b) => b.symbol === "USDT").length, 1);
});

test("parseDebankTokens honours a chain filter and the token cap", () => {
  const payload = [
    token(),
    token({ id: "0x00000000000000000000000000000000000000aa", chain: "bsc", symbol: "BNB", price: 620, value_usd: 620 }),
  ];
  assert.deepEqual(parseDebankTokens(payload, { chainFilter: "bsc" }).map((b) => b.symbol), ["BNB"]);
  assert.deepEqual(parseDebankTokens(payload, { chainFilter: "base" }), []);

  const many = Array.from({ length: 12 }, (_, index) =>
    token({
      id: `0x${index.toString(16).padStart(40, "0")}`,
      symbol: `T${index}`,
      value_usd: 100 - index,
      price: 1,
    }),
  );
  assert.equal(parseDebankTokens(many, { maxItems: 5 }).length, 5);
  assert.ok(parseDebankTokens(many).length <= MAX_DEBANK_TOKENS);
});

test("parseDebankTokens accepts string numbers and raw amounts", () => {
  const [balance] = parseDebankTokens([
    token({ amount: undefined, raw_amount: "1250500000", decimals: 6, price: "1", value_usd: "1250.5" }),
  ]);
  assert.equal(balance.quantity, 1250.5);
  assert.equal(balance.price, 1);
  assert.equal(balance.valueUsd, 1250.5);
});

test("debankRequests uses the Open API with a key and the public endpoints without", () => {
  const keyed = debankRequests("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "auto", "secret-key");
  assert.equal(keyed.length, 1);
  assert.match(keyed[0].url, /pro-openapi\.debank\.com\/v1\/user\/all_token_list/);
  assert.equal(keyed[0].headers.AccessKey, "secret-key");

  const keyedChain = debankRequests("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "arbitrum", "secret-key");
  assert.match(keyedChain[0].url, /chain_id=arb/);
  assert.match(keyedChain[0].url, /id=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045/);

  const open = debankRequests("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "auto", "");
  assert.equal(open.length, 2);
  for (const request of open) {
    assert.match(request.url, /api\.debank\.com/);
    assert.equal(request.headers.AccessKey, undefined);
    assert.equal(request.headers.Referer, "https://debank.com/");
  }
});

test("fetchDebankBalances returns balances, then reports failure instead of throwing", async () => {
  const ok = await fetchDebankBalances(
    "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    "auto",
    (async () =>
      new Response(JSON.stringify([token()]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch,
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.balances.length, 1);
  assert.equal(ok.balances[0].symbol, "USDT");
  assert.ok(ok.endpoint?.includes("debank.com"));

  const blocked = await fetchDebankBalances(
    "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    "auto",
    (async () => new Response("Forbidden", { status: 403 })) as unknown as typeof fetch,
  );
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.balances, []);
  assert.match(String(blocked.error), /403/);

  const offline = await fetchDebankBalances(
    "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    "auto",
    (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch,
  );
  assert.equal(offline.ok, false);
  assert.match(String(offline.error), /DeBank could not be reached \(network down\)/);
});
