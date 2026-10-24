import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  MAX_SCANNER_KEY_LENGTH,
  MIN_SCANNER_KEY_LENGTH,
  SCANNER_KEY_SPECS,
  SCANNER_PROVIDERS,
  ScannerKeyError,
  buildScannerKeyStatuses,
  getScannerKeys,
  isScannerProvider,
  maskScannerKey,
  normaliseScannerKey,
  resolveScannerKey,
  scannerKeyFromEnv,
  scannerKeySpec,
} from "../src/lib/scanner-keys";

const ETH_KEY = "A1B2C3D4E5F60718293A4B5C6D7E8F9012"; // 34 chars, Etherscan-shaped

test("there is one spec per scan source, with a setting and an env var", () => {
  assert.deepEqual(SCANNER_PROVIDERS, ["debank", "etherscan", "moralis", "coinmarketcap"]);
  assert.equal(SCANNER_KEY_SPECS.length, 4);
  for (const spec of SCANNER_KEY_SPECS) {
    assert.ok(spec.envVars.length > 0, `${spec.id} needs an env var`);
    assert.ok(spec.setting.startsWith("scanner.key."));
    assert.ok(spec.docsUrl.startsWith("https://"));
    assert.ok(spec.usedFor.length > 20);
  }
  // Both spellings of the Etherscan and Moralis variables are accepted.
  assert.deepEqual(scannerKeySpec("etherscan").envVars, ["ETHERSCAN_API_KEY", "BLOCKSCAN_API_KEY"]);
  assert.deepEqual(scannerKeySpec("moralis").envVars, ["MORALIS_API_KEY", "MORALIS_APIKEY"]);
  assert.equal(scannerKeySpec("debank").envVars[0], "DEBANK_ACCESS_KEY");
  // CoinMarketCap keys the contract lookup that runs *after* a scan.
  assert.deepEqual(scannerKeySpec("coinmarketcap").envVars, [
    "CMC_PRO_API_KEY",
    "COINMARKETCAP_API_KEY",
  ]);
  assert.equal(scannerKeySpec("coinmarketcap").setting, "scanner.key.coinmarketcap");

  assert.ok(isScannerProvider("moralis"));
  assert.ok(!isScannerProvider("coingecko"));
  assert.ok(!isScannerProvider(null));
});

test("a key is read from the environment, the first matching variable winning", () => {
  const spec = scannerKeySpec("etherscan");
  assert.equal(scannerKeyFromEnv(spec, { ETHERSCAN_API_KEY: ` ${ETH_KEY} ` }), ETH_KEY);
  assert.equal(scannerKeyFromEnv(spec, { BLOCKSCAN_API_KEY: "alias-key" }), "alias-key");
  assert.equal(
    scannerKeyFromEnv(spec, { ETHERSCAN_API_KEY: "", BLOCKSCAN_API_KEY: "alias-key" }),
    "alias-key",
  );
  assert.equal(scannerKeyFromEnv(spec, {}), "");
  assert.equal(scannerKeyFromEnv(spec, { ETHERSCAN_API_KEY: "   " }), "");
});

test("pasted keys are trimmed and obvious mistakes are rejected", () => {
  const spec = scannerKeySpec("debank");
  assert.equal(normaliseScannerKey(` "${ETH_KEY}" `), ETH_KEY);
  assert.equal(normaliseScannerKey("`" + ETH_KEY + "`"), ETH_KEY);
  assert.equal(normaliseScannerKey("key_with-dots.and_underscores"), "key_with-dots.and_underscores");

  const rejects = [
    "",
    "   ",
    "short",
    `${ETH_KEY} ${ETH_KEY}`,
    "https://etherscan.io/myapikey",
    "key with a space",
    "key,with,commas",
    "x".repeat(MAX_SCANNER_KEY_LENGTH + 1),
  ];
  for (const value of rejects) {
    assert.throws(() => normaliseScannerKey(value), ScannerKeyError, `expected ${JSON.stringify(value)} to be rejected`);
  }
  // The shortest accepted key is exactly the documented minimum.
  assert.equal(normaliseScannerKey("a".repeat(MIN_SCANNER_KEY_LENGTH)).length, MIN_SCANNER_KEY_LENGTH);
});

test("a masked key never leaks more than its last four characters", () => {
  const masked = maskScannerKey(ETH_KEY);
  assert.equal(masked, "••••••••F9012".replace("F9012", ETH_KEY.slice(-4)));
  assert.ok(masked.endsWith(ETH_KEY.slice(-4)));
  assert.ok(!masked.includes(ETH_KEY.slice(0, 10)));
  assert.equal(maskScannerKey("abc"), "••••");
});

test("a key saved in the app wins over the environment; removing it falls back", () => {
  const spec = scannerKeySpec("moralis");
  const env = { MORALIS_API_KEY: "from-environment-key" };

  const saved = resolveScannerKey(spec, {
    stored: { key: "saved-in-app-key", savedAt: "2026-01-02T03:04:05.000Z" },
    env,
  });
  assert.equal(saved.key, "saved-in-app-key");
  assert.equal(saved.source, "app");
  assert.equal(saved.savedAt, "2026-01-02T03:04:05.000Z");
  assert.equal(saved.hint, maskScannerKey("saved-in-app-key"));

  const fromEnv = resolveScannerKey(spec, { stored: null, env });
  assert.equal(fromEnv.key, "from-environment-key");
  assert.equal(fromEnv.source, "env");
  assert.equal(fromEnv.savedAt, null);

  const none = resolveScannerKey(spec, { stored: null, env: {} });
  assert.deepEqual(none, { key: "", source: "none", hint: "", savedAt: null });
});

test("statuses say where each key came from and what can be removed", () => {
  const statuses = buildScannerKeyStatuses(
    { debank: { key: "debank-saved-key", savedAt: "2026-02-03T00:00:00.000Z" } },
    { env: { MORALIS_API_KEY: "moralis-env-key" }, canSave: true },
  );
  assert.equal(statuses.length, 4);

  const debank = statuses.find((status) => status.id === "debank")!;
  assert.equal(debank.configured, true);
  assert.equal(debank.source, "app");
  assert.equal(debank.removable, true);
  assert.equal(debank.hint, maskScannerKey("debank-saved-key"));
  assert.equal(debank.envVar, "DEBANK_ACCESS_KEY");

  const moralis = statuses.find((status) => status.id === "moralis")!;
  assert.equal(moralis.configured, true);
  assert.equal(moralis.source, "env");
  assert.equal(moralis.removable, false);

  const etherscan = statuses.find((status) => status.id === "etherscan")!;
  assert.equal(etherscan.configured, false);
  assert.equal(etherscan.source, "none");
  assert.equal(etherscan.hint, "");
  assert.equal(etherscan.canSave, true);

  // No key at all still reports a usable list, so the panel can offer the input.
  const empty = buildScannerKeyStatuses({}, { env: {} });
  assert.ok(empty.every((status) => !status.configured && !status.removable));
});

test("the scanner gets its keys from the environment when nothing is saved", async () => {
  const saved = { ...process.env };
  try {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    process.env.DEBANK_ACCESS_KEY = "debank-env-key";
    process.env.ETHERSCAN_API_KEY = ETH_KEY;
    process.env.MORALIS_API_KEY = "";
    process.env.MORALIS_APIKEY = "moralis-alias-key";
    process.env.CMC_PRO_API_KEY = "";
    process.env.COINMARKETCAP_API_KEY = "cmc-alias-key";

    const keys = await getScannerKeys();
    assert.deepEqual(keys, {
      debank: "debank-env-key",
      blockscan: ETH_KEY,
      moralis: "moralis-alias-key",
      coinmarketcap: "cmc-alias-key",
    });
  } finally {
    process.env = saved;
  }
});

const read = (path: string) => readFileSync(resolve(__dirname, "../src", path), "utf8");

test("the scan route, the scanner and the dialog all use the saved keys", () => {
  const route = read("app/api/wallet/scan/route.ts");
  assert.ok(route.includes("getScannerKeys()"), "the route resolves the keys first");
  assert.ok(route.includes("{ source, keys }"), "and hands them to the scanner");

  const scanner = read("lib/wallet-scanner.ts");
  assert.ok(scanner.includes("options.keys?.debank"), "a saved DeBank key is used");
  assert.ok(scanner.includes("accessKey: debankKey"), "and passed to the DeBank client");
  assert.ok(scanner.includes("apiKey: blockscanKey"), "likewise for Blockscan");
  assert.ok(scanner.includes("apiKey: moralisKey"), "and Moralis");

  const dialog = read("components/AddAssetDialog.tsx");
  assert.ok(dialog.includes("<ScannerKeys"), "the scan dialog renders the key panel");
  assert.ok(dialog.includes("key={scannerKeyPrompt"), "and reopens it when a key is missing");

  const panel = read("components/ScannerKeys.tsx");
  assert.ok(panel.includes("saveScannerKeyAction"), "a key can be saved from the panel");
  assert.ok(panel.includes("removeScannerKeyAction"), "and removed again");
  assert.ok(panel.includes('type="password"'), "the input is masked while typing");
  assert.ok(panel.includes("/api/wallet/scan/keys"), "statuses come from the masked endpoint");
});

test("the keys endpoint returns masks, never keys", () => {
  const route = read("app/api/wallet/scan/keys/route.ts");
  assert.ok(route.includes("getScannerKeyStatuses()"));
  assert.ok(!route.includes(".key"), "no raw key field is ever returned");
  // Saving happens through the server actions, not this route.
  assert.ok(!route.includes("export async function POST"));
});
