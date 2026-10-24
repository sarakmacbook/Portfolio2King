import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEBANK_CHAIN_IDS,
  debankChainListRequests,
  fetchDebankChainNames,
  parseDebankChainList,
  DEBANK_TOTAL_BUDGET_MS,
  MAX_DEBANK_TOKENS,
  debankChainIdFor,
  debankRequests,
  debankTokenItems,
  fetchDebankBalances,
  parseDebankTokens,
  walletChainFromDebankId,
} from "../src/lib/debank";
import {
  canonicalChainId,
  chainMatchesFilter,
  debankChainLabel,
  hasKnownChainLabel,
} from "../src/lib/wallet-chains";

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
  // An id DeBank adds after this release is kept, not dropped: new chains are
  // the whole point of asking DeBank rather than a hand-written list.
  assert.equal(walletChainFromDebankId("unknown-chain"), "unknown-chain");
  assert.equal(walletChainFromDebankId("Sonic"), "sonic");
  assert.equal(walletChainFromDebankId(""), null);
  assert.equal(walletChainFromDebankId(null), null);
  assert.equal(walletChainFromDebankId(42), null);
  assert.equal(debankChainIdFor("ethereum"), "eth");
  assert.equal(debankChainIdFor("arbitrum"), "arb");
  // DeBank is EVM-only, so a non-EVM filter sends no chain id at all.
  assert.equal(debankChainIdFor("solana"), null);
  assert.equal(debankChainIdFor("bitcoin"), null);
  // Any chain id beyond the built-in list is passed through as DeBank's own id.
  assert.equal(debankChainIdFor("sonic"), "sonic");
  assert.equal(debankChainIdFor("Sonic"), "sonic");
  assert.equal(debankChainIdFor("ethereum"), "eth");
  // "auto" means "every chain", so no chain id is sent.
  assert.equal(debankChainIdFor("auto"), null);
});

test("one scan has a total DeBank budget, so a blocked endpoint cannot stall the dialog", () => {
  // Three keyless routes at six seconds each would be 18s without this.
  assert.ok(DEBANK_TOTAL_BUDGET_MS <= 15000);
  assert.ok(DEBANK_TOTAL_BUDGET_MS >= 3000);
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

test("parseDebankTokens accepts the gateway's usd_value spelling", () => {
  const [balance] = parseDebankTokens([
    {
      id: "0x0000000000000000000000000000000000000001",
      chain: "arb",
      symbol: "ARB",
      decimals: 18,
      amount: 10,
      price: 2,
      usd_value: 20,
    },
  ]);
  assert.equal(balance.valueUsd, 20);
  assert.equal(balance.chain, "arbitrum");
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
  assert.match(keyedChain[0].url, /pro-openapi\.debank\.com\/v1\/user\/token_list/);
  assert.match(keyedChain[0].url, /chain_id=arb/);
  assert.match(keyedChain[0].url, /id=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045/);

  // Without a key three public routes are tried, best first.
  const open = debankRequests("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "auto", "");
  assert.equal(open.length, 3);
  assert.match(open[0].url, /^https:\/\/api\.debank\.com\/v1\/user\/token_list\?/);
  assert.match(open[1].url, /^https:\/\/api\.debank\.com\/token\/balance_list\?/);
  assert.match(open[2].url, /^https:\/\/api\.rabby\.io\/v1\/user\/token_list\?/);
  for (const request of open) {
    assert.equal(request.headers.AccessKey, undefined, "no key is sent to a keyless endpoint");
  }
  assert.equal(open[0].headers.Referer, "https://debank.com/");
});

test("the keyless DeBank routes use the parameters the APIs actually accept", () => {
  // Regression: the legacy web route is keyed on `user_id`; `user_addr` answers
  // 404, which is what used to surface as "DeBank answered 404".
  const [gateway, legacy, rabby] = debankRequests("0xAbC0000000000000000000000000000000000001", "auto", "");
  assert.match(legacy.url, /[?&]user_id=0xAbC0000000000000000000000000000000000001/);
  assert.ok(!legacy.url.includes("user_addr"), "user_addr is the retired parameter name");
  assert.match(gateway.url, /[?&]id=0xAbC0000000000000000000000000000000000001/);
  assert.match(rabby.url, /[?&]id=0xAbC0000000000000000000000000000000000001/);
  for (const request of [gateway, legacy, rabby]) assert.match(request.url, /is_all=false/);

  // A chain filter narrows every route to that chain.
  const [chainGateway, chainLegacy, chainRabby] = debankRequests(
    "0xAbC0000000000000000000000000000000000001",
    "base",
    "",
  );
  assert.match(chainGateway.url, /chain_id=base/);
  assert.match(chainLegacy.url, /[?&]chain=base/);
  assert.match(chainRabby.url, /chain_id=base/);
});

test("a stale endpoint does not end the scan: the next route is tried", async () => {
  const seen: string[] = [];
  const result = await fetchDebankBalances(
    "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    "auto",
    (async (url: string) => {
      seen.push(String(url));
      if (String(url).includes("token/balance_list")) {
        return new Response("not found", { status: 404 });
      }
      if (String(url).includes("api.rabby.io")) {
        return new Response(JSON.stringify([token({ chain: "base", symbol: "USDC", id: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", amount: 42, price: 1, value_usd: 42 })]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("blocked", { status: 403 });
    }) as unknown as typeof fetch,
  );

  assert.equal(seen.length, 3, "every route was attempted");
  assert.equal(result.ok, true);
  assert.equal(result.balances[0].symbol, "USDC");
  assert.equal(result.balances[0].chain, "base");
  assert.match(String(result.endpoint), /api\.rabby\.io/);
});

test("an empty answer is reported as such, not as a 404 from a stale route", async () => {
  let call = 0;
  const result = await fetchDebankBalances(
    "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    "auto",
    (async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "DeBank returned no tokens for that wallet.");
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
  assert.equal(blocked.status, 403);
  assert.match(String(blocked.error), /DEBANK_ACCESS_KEY/, "a refused key is explained");

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

test("every EVM chain DeBank reports is kept, not just the ones the app lists", () => {
  const balances = parseDebankTokens([
    token({ id: "0x1111111111111111111111111111111111111111", chain: "eth", symbol: "ETH", amount: 1, price: 2650, value_usd: 2650 }),
    token({ id: "0x2222222222222222222222222222222222222222", chain: "sonic", symbol: "S", amount: 100, price: 0.5, value_usd: 50 }),
    token({ id: "0x3333333333333333333333333333333333333333", chain: "zora", symbol: "ZORA", amount: 10, price: 2, value_usd: 20 }),
    // A native token: DeBank identifies it by the chain id, not a contract.
    token({ id: "eth", chain: "eth", name: "Ether", symbol: "ETH", amount: 1, price: 2650, value_usd: 2650 }),
    // A chain that did not exist when this code shipped.
    token({ id: "0x4444444444444444444444444444444444444444", chain: "somebrandnewchain", symbol: "NEWC", amount: 5, price: 3, value_usd: 15 }),
  ]);

  assert.deepEqual(balances.map((b) => b.chain), [
    "ethereum",
    "ethereum",
    "sonic",
    "zora",
    "somebrandnewchain",
  ]);
  assert.deepEqual(balances.map((b) => b.chainLabel), [
    "Ethereum",
    "Ethereum",
    "Sonic",
    "Zora",
    "SOMEBRANDNEWCHAIN",
  ]);
  // The native token has no contract but is still a holding.
  const native = balances.filter((b) => b.id === "debank:ethereum:ETH")[0];
  assert.ok(native, "the native token is kept");
  assert.equal(native.contract, null);
  // The id is chain-scoped, so the same contract on two chains is two holdings.
  const sameContract = parseDebankTokens([
    token({ id: "0x5555555555555555555555555555555555555555", chain: "eth", symbol: "USDC", amount: 10, price: 1, value_usd: 10 }),
    token({ id: "0x5555555555555555555555555555555555555555", chain: "base", symbol: "USDC", amount: 20, price: 1, value_usd: 20 }),
  ]);
  assert.equal(sameContract.length, 2);
  assert.notEqual(sameContract[0].id, sameContract[1].id);
});

test("chain filters are alias-aware, so \"ethereum\" matches DeBank's \"eth\"", () => {
  const payload = [
    token({ id: "0x00000000000000000000000000000000000000e1", chain: "eth", symbol: "ETH", price: 2650, value_usd: 2650 }),
    token({ id: "0x00000000000000000000000000000000000000e2", chain: "arb", symbol: "ARB", price: 0.75, value_usd: 75 }),
    token({ id: "0x00000000000000000000000000000000000000e3", chain: "sdai", symbol: "SONIC", price: 1, value_usd: 1 }),
  ];
  assert.deepEqual(parseDebankTokens(payload, { chainFilter: "ethereum" }).map((b) => b.symbol), ["ETH"]);
  assert.deepEqual(parseDebankTokens(payload, { chainFilter: "arbitrum" }).map((b) => b.symbol), ["ARB"]);
  // "auto" means every chain DeBank knows about.
  assert.equal(parseDebankTokens(payload, { chainFilter: "auto" }).length, 3);

  assert.equal(canonicalChainId("Ethereum"), "eth");
  assert.equal(canonicalChainId("eth"), "eth");
  assert.equal(canonicalChainId("arbitrum"), "arb");
  assert.equal(chainMatchesFilter("eth", "ethereum"), true);
  assert.equal(chainMatchesFilter("arb", "ethereum"), false);
  assert.equal(chainMatchesFilter("sonic", "auto"), true);
  assert.equal(chainMatchesFilter("sonic", ""), true);
  assert.equal(chainMatchesFilter("sonic", "sonic"), true);
  assert.equal(debankChainLabel("ethereum"), "Ethereum");
  assert.equal(debankChainLabel("eth"), "Ethereum");
  assert.equal(hasKnownChainLabel("eth"), true);
  assert.equal(hasKnownChainLabel("somebrandnewchain"), false);
});

test("chain names come from DeBank's own list, so new chains get a real label", async () => {
  const listPayload = [
    { id: "eth", name: "Ethereum", community_id: 1 },
    { id: "somebrandnewchain", name: "Brand New Chain", community_id: 999999 },
  ];
  assert.deepEqual([...parseDebankChainList(listPayload)], [
    ["eth", "Ethereum"],
    ["somebrandnewchain", "Brand New Chain"],
  ]);
  assert.deepEqual([...parseDebankChainList({ data: listPayload })].length, 2);
  assert.deepEqual([...parseDebankChainList("nope")], []);

  const requests = debankChainListRequests("key-123");
  assert.match(requests[0].url, /pro-openapi\.debank\.com\/v1\/chain\/list/);
  assert.equal(requests[0].headers.AccessKey, "key-123");
  const keyless = debankChainListRequests("");
  assert.match(keyless[0].url, /api\.debank\.com\/v1\/chain\/list/);
  assert.ok(keyless.some((request) => request.url.includes("api.rabby.io")), "Rabby is the last resort");

  const names = await fetchDebankChainNames(
    (async () =>
      new Response(JSON.stringify(listPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch,
  );
  assert.equal(names.get("somebrandnewchain"), "Brand New Chain");

  // A scan that meets an unknown chain labels it from that list.
  const result = await fetchDebankBalances(
    "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    "auto",
    (async () =>
      new Response(
        JSON.stringify([
          token({
            id: "0x6666666666666666666666666666666666666666",
            chain: "somebrandnewchain",
            symbol: "NEWC",
            amount: 5,
            price: 3,
            value_usd: 15,
          }),
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch,
  );
  assert.equal(result.ok, true);
  assert.equal(result.balances[0].chainLabel, "Brand New Chain");
});
