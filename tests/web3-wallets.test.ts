import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  WEB3_WALLETS,
  detectWeb3Wallet,
  getWeb3Wallet,
  isWeb3WalletId,
  parseWeb3WalletId,
} from "../src/lib/web3-wallets";
import { parseWalletLogosMap } from "../src/lib/web3-wallets-db";

test("WEB3_WALLETS includes MetaMask, Phantom, and OKX Web3 with unique ids and colors", () => {
  const ids = new Set<string>();
  for (const wallet of WEB3_WALLETS) {
    assert.ok(wallet.id.length > 0);
    assert.ok(wallet.name.length > 0);
    assert.match(wallet.color, /^#[0-9a-fA-F]{6}$/);
    assert.ok(!ids.has(wallet.id), `Duplicate wallet id: ${wallet.id}`);
    ids.add(wallet.id);
    assert.equal(isWeb3WalletId(wallet.id), true);
  }

  assert.equal(getWeb3Wallet("metamask")?.name, "MetaMask");
  assert.equal(getWeb3Wallet("phantom")?.name, "Phantom");
  assert.equal(getWeb3Wallet("okx-web3")?.name, "OKX Web3");
  assert.equal(parseWeb3WalletId("  PHANTOM "), "phantom");
  assert.equal(parseWeb3WalletId("unknown-wallet"), "");
});

test("detectWeb3Wallet resolves explicit wallet ids and wallet names/keywords", () => {
  assert.equal(detectWeb3Wallet("Bitcoin", "BTC", "metamask")?.id, "metamask");
  assert.equal(detectWeb3Wallet("Solana", "SOL", "phantom")?.id, "phantom");
  assert.equal(detectWeb3Wallet("USDT", "USDT", "okx-web3")?.id, "okx-web3");

  assert.equal(detectWeb3Wallet("MetaMask", "ETH")?.id, "metamask");
  assert.equal(detectWeb3Wallet("ETH (MetaMask)", "ETH")?.id, "metamask");
  assert.equal(detectWeb3Wallet("Phantom Wallet", "SOL")?.id, "phantom");
  assert.equal(detectWeb3Wallet("OKX Web3", "USDT")?.id, "okx-web3");
  assert.equal(detectWeb3Wallet("Trust Wallet", "BNB")?.id, "trust-wallet");
  assert.equal(detectWeb3Wallet("Bitcoin", "BTC"), undefined);
});

test("parseWalletLogosMap validates asset ids and wallet ids", () => {
  const parsed = parseWalletLogosMap(
    JSON.stringify({
      "1": "metamask",
      "2": "phantom",
      "3": "okx-web3",
      "4": "invalid-wallet",
      "-1": "metamask",
    }),
  );
  assert.deepEqual(parsed, {
    1: "metamask",
    2: "phantom",
    3: "okx-web3",
  });
  assert.deepEqual(parseWalletLogosMap("not-json"), {});
});

test("AddAssetDialog and EditAssetForm expose Web3 wallet logo picker under Crypto", () => {
  const addDialog = readFileSync(
    resolve(__dirname, "../src/components/AddAssetDialog.tsx"),
    "utf8",
  );
  assert.ok(addDialog.includes("Logo / Web3 wallet"));
  assert.ok(addDialog.includes("WEB3_WALLETS.map"));
  assert.ok(addDialog.includes('name="walletLogo"'));

  const editForms = readFileSync(
    resolve(__dirname, "../src/components/AssetForms.tsx"),
    "utf8",
  );
  assert.ok(editForms.includes("Logo / Web3 wallet"));
  assert.ok(editForms.includes('name="walletLogo"'));
});
