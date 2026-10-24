import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  CMC_API_BASE,
  CMC_BATCH_SIZE,
  cmcApiKey,
  cmcErrorText,
  cmcInfoUrl,
  cmcMatchFor,
  cmcQuotesUrl,
  fetchCmcContracts,
  mergeContractStatus,
  parseCmcInfo,
  parseCmcQuotes,
  sameTicker,
} from "../src/lib/coinmarketcap";
import { enrichTokenTrust, filterScanBalances } from "../src/lib/wallet-trust";

const USDT_ETH = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const FAKE = "0x1111111111111111111111111111111111111111";
/**
 * A contract the local official table has never heard of — the long tail CMC
 * exists to verify. (Aerodrome's real address *is* in the table, so it would be
 * `official` without CMC and prove nothing.)
 */
const LONGTAIL = "0x3333333333333333333333333333333333333333";

/** A `cryptocurrency/info` answer, the way CMC sends it (address → array). */
function infoPayload(rows: Record<string, unknown>) {
  return { status: { error_code: 0, error_message: null }, data: rows };
}

function listed(id: number, name: string, symbol: string, contract: string, slug = "") {
  return { id, name, symbol, slug: slug || symbol.toLowerCase(), contract_address: contract };
}

/** A `quotes/latest` answer. */
function quotesPayload(prices: Record<string, number>) {
  const data: Record<string, unknown> = {};
  for (const [id, price] of Object.entries(prices)) {
    data[id] = { id: Number(id), quote: { USD: { price } } };
  }
  return { status: { error_code: 0 }, data };
}

test("the URLs are CoinMarketCap's contract lookup and quotes endpoints", () => {
  assert.equal(CMC_API_BASE, "https://pro-api.coinmarketcap.com");

  const url = cmcInfoUrl([USDT_ETH, "0xABC0000000000000000000000000000000000002"]);
  assert.ok(url.startsWith(`${CMC_API_BASE}/v2/cryptocurrency/info?`));
  // Lower-cased, comma-separated, and invalid addresses dropped so one bad row
  // cannot fail the whole batch.
  assert.ok(url.includes(encodeURIComponent(`${USDT_ETH},0xabc0000000000000000000000000000000000002`)));
  assert.ok(url.includes("skip_invalid=true"));

  assert.ok(cmcQuotesUrl([825, 1027]).includes("id=825,1027"));
});

test("the key is read from either variable it goes by", () => {
  assert.equal(cmcApiKey({ CMC_PRO_API_KEY: " abc " }), "abc");
  assert.equal(cmcApiKey({ COINMARKETCAP_API_KEY: "xyz" }), "xyz");
  assert.equal(cmcApiKey({}), "");
});

test("an info answer becomes address → coin, in either shape CMC sends", () => {
  const keyed = parseCmcInfo(
    infoPayload({
      [USDT_ETH]: [listed(825, "Tether USDt", "USDT", USDT_ETH)],
      [LONGTAIL]: listed(29210, "Pendle", "PENDLE", LONGTAIL),
    }),
  );
  assert.equal(keyed.size, 2);
  assert.equal(keyed.get(USDT_ETH)?.id, 825);
  assert.equal(keyed.get(USDT_ETH)?.symbol, "USDT");
  assert.equal(keyed.get(LONGTAIL)?.name, "Pendle");
  assert.equal(keyed.get(LONGTAIL)?.contractAddress, LONGTAIL);

  // An address that maps to several listings: the one whose own contract matches wins.
  const ambiguous = parseCmcInfo(
    infoPayload({
      [FAKE]: [
        listed(1, "Something Else", "OTHER", "0x2222222222222222222222222222222222222222"),
        listed(2, "Honest Token", "HON", FAKE),
      ],
    }),
  );
  assert.equal(ambiguous.get(FAKE)?.id, 2);

  // Junk rows are ignored, never invented.
  assert.equal(parseCmcInfo(infoPayload({ [FAKE]: [{ symbol: "" }, null, 42] })).size, 0);
  assert.equal(parseCmcInfo(null).size, 0);
});

test("a quotes answer becomes id → USD price", () => {
  const prices = parseCmcQuotes(quotesPayload({ "825": 1.0001, "29210": 0.75 }));
  assert.equal(prices.get(825), 1.0001);
  assert.equal(prices.get(29210), 0.75);
  assert.equal(prices.get(999), undefined);
  assert.equal(parseCmcQuotes({ data: { "1": { id: 1, quote: { USD: { price: 0 } } } } }).size, 0);
});

test("an error is readable, and a success is not an error", () => {
  assert.equal(cmcErrorText({ status: { error_code: 0, error_message: null } }), "");
  assert.equal(
    cmcErrorText({ status: { error_code: 1002, error_message: "API key missing." } }),
    "API key missing.",
  );
  assert.equal(cmcErrorText({ message: "Invalid value for address" }), "Invalid value for address");
  assert.equal(cmcErrorText(null), "");
});

test("tickers that mean the same coin are treated as the same", () => {
  assert.equal(sameTicker("USDC", "USDC"), true);
  assert.equal(sameTicker("usdc.e", "USDC"), true, "a bridge suffix is the same coin");
  assert.equal(sameTicker("WSTETH", "STETH"), true, "a wrapper prefix is the same coin");
  assert.equal(sameTicker("RNDR", "RENDER"), false, "a rename is a different ticker");
  assert.equal(sameTicker("USDT", "PEPE"), false);
  assert.equal(sameTicker("", "USDT"), false);
});

test("a listed contract whose ticker agrees is official; a rename is only a note", () => {
  const info = parseCmcInfo(
    infoPayload({
      [LONGTAIL]: [listed(29210, "Pendle", "PENDLE", LONGTAIL)],
      [FAKE]: [listed(7, "Tether USD", "USDT", FAKE)],
    }),
  );

  const matched = cmcMatchFor({ symbol: "PENDLE", contract: LONGTAIL }, info);
  assert.equal(matched?.status, "official");
  assert.equal(matched?.token?.name, "Pendle");
  assert.equal(matched?.symbolMismatch, undefined);

  // The scan says one thing, CMC lists another: reported, never "hide me".
  const renamed = cmcMatchFor({ symbol: "RNDR", contract: FAKE }, info);
  assert.equal(renamed?.status, "unknown");
  assert.equal(renamed?.symbolMismatch, true);

  // Not listed at all, or no contract (native coins): nothing to say.
  assert.equal(cmcMatchFor({ symbol: "X", contract: "0x" + "9".repeat(40) }, info), null);
  assert.equal(cmcMatchFor({ symbol: "ETH", contract: null }, info), null);
});

test("the local table outranks CMC on a look-alike, and either can confirm", () => {
  const official = { status: "official" } as const;
  const mismatch = { status: "unknown", symbolMismatch: true } as const;
  // A known issuer's ticker at a different address stays a look-alike, whatever
  // CMC says about that address.
  assert.equal(mergeContractStatus("different", official), "different");
  assert.equal(mergeContractStatus("official", null), "official");
  // A token the table has never heard of, but CMC has: verified.
  assert.equal(mergeContractStatus("unknown", official), "official");
  // CMC silent, or only a rename: still unknown — never hidden.
  assert.equal(mergeContractStatus("unknown", null), "unknown");
  assert.equal(mergeContractStatus("unknown", mismatch), "unknown");
});

/** A fetch stub for the CMC endpoints. */
function stubCmc(handler: (url: string) => unknown) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return { ok: true, json: async () => handler(url) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("without a key nothing is asked, and the reason is the key", async () => {
  const { impl, calls } = stubCmc(() => infoPayload({}));
  const lookup = await fetchCmcContracts([USDT_ETH], { apiKey: "", fetchImpl: impl });
  assert.equal(lookup.ok, false);
  assert.equal(lookup.needsKey, true);
  assert.equal(calls.length, 0);
  assert.equal(lookup.looked, 0);
});

test("contracts are looked up in batches, then priced in one more call", async () => {
  const addresses = Array.from(
    { length: CMC_BATCH_SIZE * 2 + 5 },
    (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}`,
  );
  const { impl, calls } = stubCmc((url) => {
    if (url.includes("/v1/cryptocurrency/quotes/latest")) {
      return quotesPayload({ "825": 1.0001 });
    }
    return infoPayload({ [addresses[0]]: [listed(825, "Tether USDt", "USDT", addresses[0])] });
  });

  const lookup = await fetchCmcContracts(addresses, { apiKey: "KEY", fetchImpl: impl });
  assert.equal(lookup.ok, true);
  assert.equal(lookup.looked, addresses.length);
  const infoCalls = calls.filter((url) => url.includes("/v2/cryptocurrency/info"));
  assert.equal(infoCalls.length, 3, "2×50 + 5 fits in three calls");
  assert.equal(calls.filter((url) => url.includes("quotes/latest")).length, 1);
  assert.equal(lookup.prices.get(825), 1.0001);

  const withoutPrices = await fetchCmcContracts(addresses, {
    apiKey: "KEY",
    fetchImpl: impl,
    prices: false,
  });
  assert.equal(withoutPrices.prices.size, 0);
});

test("duplicate and malformed addresses are dropped before the call", async () => {
  const { impl, calls } = stubCmc(() => infoPayload({}));
  const lookup = await fetchCmcContracts([USDT_ETH, USDT_ETH.toUpperCase(), "not-an-address", ""], {
    apiKey: "KEY",
    fetchImpl: impl,
  });
  assert.equal(lookup.looked, 1);
  assert.equal(calls.length, 1);
});

test("a rejected key is reported as a key problem", async () => {
  const { impl } = stubCmc(() => ({
    status: { error_code: 1001, error_message: "This API Key is invalid." },
  }));
  const lookup = await fetchCmcContracts([USDT_ETH], { apiKey: "BAD", fetchImpl: impl });
  assert.equal(lookup.ok, false);
  assert.equal(lookup.needsKey, true);
  assert.ok(lookup.error?.includes("invalid"));
});

test("a network failure leaves the scan unverified instead of failing it", async () => {
  const lookup = await fetchCmcContracts([USDT_ETH], {
    apiKey: "KEY",
    fetchImpl: (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch,
  });
  assert.equal(lookup.ok, false);
  assert.equal(lookup.info.size, 0);
  assert.equal(lookup.needsKey, undefined);
});

const read = (path: string) => readFileSync(resolve(__dirname, "../src", path), "utf8");

/** DexScreener that knows nothing, so the market pass stays out of the way. */
const noMarket = (async () =>
  new Response(JSON.stringify({ pairs: [] }), { status: 200 })) as unknown as typeof fetch;

test("a scanned contract is matched, verified and priced by CoinMarketCap", async () => {
  const { impl } = stubCmc((url) => {
    if (url.includes("quotes/latest")) return quotesPayload({ "29210": 0.8 });
    return infoPayload({
      [LONGTAIL]: [listed(29210, "Pendle", "PENDLE", LONGTAIL)],
      // A contract CMC lists under a different ticker than the scan reported.
      [FAKE]: [listed(7, "Promo Voucher", "VCHR", FAKE)],
    });
  });

  const balances = [
    // A long-tail token the local table does not know: CMC verifies it, and prices it.
    { symbol: "PENDLE", name: "Pendle", contract: LONGTAIL, chain: "ethereum", quantity: 100, price: 0, valueUsd: 0, priced: false },
    // Right ticker, wrong contract: the local table catches it before CMC is asked.
    { symbol: "USDT", name: "Tether USD", contract: FAKE, chain: "ethereum", quantity: 500, price: 1, valueUsd: 500, priced: true },
    // Native coins have no contract: untouched.
    { symbol: "ETH", name: "Ethereum", contract: null, chain: "base", quantity: 1, price: 3000, valueUsd: 3000, priced: true },
  ];

  const enriched = await enrichTokenTrust(balances, noMarket, {
    cmcApiKey: "KEY",
    cmcFetchImpl: impl,
  });

  const aero = enriched[0];
  assert.equal(aero.contractStatus, "official", "CMC verified a token the table cannot know");
  assert.equal(aero.cmcVerified, true);
  assert.equal(aero.cmcId, 29210);
  assert.equal(aero.cmcName, "Pendle");
  assert.equal(aero.price, 0.8, "CMC prices what nothing else could");
  assert.equal(aero.valueUsd, 80);
  assert.equal(aero.priced, true);
  assert.equal(aero.cmcPriceUsd, 0.8);

  assert.equal(enriched[1].contractStatus, "different", "a look-alike stays a look-alike");
  assert.equal(enriched[1].price, 1, "a price the scan already had is not overwritten");
  assert.equal(enriched[1].cmcSymbolMismatch, true, "and the CMC name is kept as a note");

  assert.equal(enriched[2].contractStatus, "unknown");
  assert.equal(enriched[2].cmcId, undefined);
  assert.equal(enriched[2].valueUsd, 3000);
  assert.equal(enriched.length, 3, "nothing is dropped");
});

test("without a CMC key the scan is unchanged", async () => {
  const balances = [
    { symbol: "PENDLE", name: "Pendle", contract: LONGTAIL, chain: "ethereum", quantity: 1, price: 0, valueUsd: 0, priced: false },
  ];
  const enriched = await enrichTokenTrust(balances, noMarket, { cmcApiKey: "" });
  assert.equal(enriched[0].contractStatus, "unknown");
  assert.equal(enriched[0].cmcId, undefined);
  assert.equal(enriched[0].priced, false, "an unpriced token stays unpriced, not $0-through-a-fake-price");
  assert.equal(enriched.length, 1);
});

test("the scan route and the picker both carry CoinMarketCap's verdict", () => {
  const route = read("app/api/wallet/scan/route.ts");
  assert.ok(route.includes("enrichTokenTrust("), "the route runs the trust pass");
  assert.ok(route.includes("cmcApiKey: keys.coinmarketcap"), "and hands it the CMC key");

  const keys = read("lib/scanner-keys.ts");
  assert.ok(keys.includes('"coinmarketcap"'), "the key can be saved in the app");
  assert.ok(keys.includes("CMC_PRO_API_KEY"), "and read from the environment");

  const trust = read("lib/wallet-trust.ts");
  assert.ok(trust.includes("fetchCmcContracts("), "the trust pass asks CMC");
  assert.ok(trust.includes("mergeContractStatus("), "and merges the two verdicts");
  assert.ok(trust.includes("cmcVerified"), "a CMC match is exposed to the picker");

  const dialog = read("components/AddAssetDialog.tsx");
  assert.ok(dialog.includes("cmcVerified"), "the official badge mentions CMC");
  assert.ok(dialog.includes("CMC: "), "a ticker mismatch is shown as a note");

  const env = readFileSync(resolve(__dirname, "..", ".env.example"), "utf8");
  assert.ok(env.includes("CMC_PRO_API_KEY"), "the key is documented");
});

test("only CoinMarketCap-listed contracts survive the strict filter", () => {
  const rows = [
    // Listed for this exact contract, under a ticker the scan spelled differently.
    { id: "listed", symbol: "PENDLE", name: "Pendle", contract: LONGTAIL, chain: "arbitrum", valueUsd: 400, organicVolumeUsd: 5_000_000, cmcId: 29210, cmcSymbolMismatch: true },
    // Nothing on CMC for this contract.
    { id: "unlisted", symbol: "LONGX", name: "Long Tail Token", contract: FAKE, chain: "ethereum", valueUsd: 300, organicVolumeUsd: 5_000_000 },
    // A native coin has no contract to look up, so the rule cannot hide it.
    { id: "native", symbol: "ETH", name: "Ethereum", contract: null, chain: "base", valueUsd: 3000 },
  ];

  const filtered = filterScanBalances(rows, { dustCut: 0, onlyCmc: true });
  assert.deepEqual(filtered.kept.map((r) => r.id), ["listed", "native"]);
  assert.deepEqual(filtered.unlisted.map((r) => r.id), ["unlisted"]);
  assert.equal(filtered.counts.unlisted, 1);

  // Off, and the unlisted token is back: the filter hides, it never deletes.
  const off = filterScanBalances(rows, { dustCut: 0, onlyCmc: false });
  assert.deepEqual(off.kept.map((r) => r.id), ["listed", "unlisted", "native"]);
  assert.equal(off.counts.unlisted, 0);
});

test("the trust pass reports whether CoinMarketCap actually answered", async () => {
  const { impl } = stubCmc((url) => {
    if (url.includes("quotes/latest")) return quotesPayload({ "29210": 0.8 });
    return infoPayload({ [LONGTAIL]: [listed(29210, "Pendle", "PENDLE", LONGTAIL)] });
  });

  const reports: Array<{ ok: boolean; asked: number; listed: number }> = [];
  const balances = [
    { symbol: "PENDLE", name: "Pendle", contract: LONGTAIL, chain: "ethereum", quantity: 1, price: 0, valueUsd: 0, priced: false },
    { symbol: "LONGX", name: "Long Tail Token", contract: FAKE, chain: "ethereum", quantity: 1, price: 1, valueUsd: 1, priced: true },
    { symbol: "ETH", name: "Ethereum", contract: null, chain: "base", quantity: 1, price: 3000, valueUsd: 3000, priced: true },
  ];

  const enriched = await enrichTokenTrust(balances, noMarket, {
    cmcApiKey: "KEY",
    cmcFetchImpl: impl,
    onCmcLookup: (report) => reports.push(report),
  });
  assert.deepEqual(reports, [{ ok: true, asked: 2, listed: 1 }], "only contracts are asked about");

  const selection = filterScanBalances(enriched, { dustCut: 0, onlyCmc: true });
  assert.deepEqual(selection.kept.map((row) => row.symbol), ["PENDLE", "ETH"]);
  assert.deepEqual(selection.unlisted.map((row) => row.symbol), ["LONGX"]);

  // No key at all: the lookup never ran, so the filter must not be switched on.
  const skipped: Array<{ ok: boolean; asked: number; listed: number }> = [];
  await enrichTokenTrust(balances, noMarket, {
    cmcApiKey: "",
    onCmcLookup: (report) => skipped.push(report),
  });
  assert.deepEqual(skipped, [{ ok: false, asked: 2, listed: 0 }], "a missing key is reported, not guessed");

  // A rate limit is the same story.
  const limited: Array<{ ok: boolean; asked: number; listed: number }> = [];
  await enrichTokenTrust(balances, noMarket, {
    cmcApiKey: "KEY",
    cmcFetchImpl: (async () => {
      throw new Error("429");
    }) as unknown as typeof fetch,
    onCmcLookup: (report) => limited.push(report),
  });
  assert.equal(limited[0].ok, false);
});

test("only tokens CoinMarketCap lists, applied by the page and re-applied by the server", () => {
  const route = read("app/api/wallet/scan/route.ts");
  assert.ok(route.includes("cmcChecked: cmcLookup.ok"), "the route says whether CMC answered");
  assert.ok(route.includes("cmcListed"), "and how many contracts it knew");

  const dialog = read("components/AddAssetDialog.tsx");
  assert.ok(dialog.includes("Only tokens on CoinMarketCap"), "the switch exists");
  assert.ok(
    dialog.includes("onlyCmc: walletOnlyCmc && walletCmcChecked"),
    "the filter is on by default but only once CMC has answered",
  );
  assert.ok(dialog.includes("disabled={!walletCmcChecked}"), "and it says so when it is off");
  assert.ok(dialog.includes("setWalletOnlyCmc(false)"), "Show them turns it off");
  assert.ok(dialog.includes("requireCmc: walletOnlyCmc && walletCmcChecked"), "the server is asked to re-apply it");

  const actions = read("app/actions.ts");
  const body = actions.slice(actions.indexOf("export async function importWalletBalances"));
  assert.ok(body.includes("requireCmc"), "the action accepts the rule");
  assert.ok(body.includes("skippedUnlisted"), "and reports what it skipped");
  assert.ok(body.includes("hasCmcAnswer"), "but never applies it when the scan had no CMC answer");
  assert.ok(body.includes("item.cmcId === undefined"), "a native coin has no contract and is kept");
});
