import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  isSpamToken,
  spamReasonOf,
  spamReasonsOf,
  splitSpam,
} from "../src/lib/wallet-spam";

test("real tokens are never flagged as spam", () => {
  const real = [
    { name: "Bitcoin", symbol: "BTC" },
    { name: "Ethereum", symbol: "ETH" },
    { name: "Ethena USDe", symbol: "USDe" },
    { name: "Wrapped liquid staked Ether 2.0", symbol: "wstETH" },
    { name: "Renzo Restaked ETH", symbol: "ezETH" },
    { name: "First Digital USD", symbol: "FDUSD" },
    { name: "Bonk", symbol: "BONK" },
    { name: "Aave", symbol: "AAVE" },
    { name: "Convex CRV", symbol: "cvxCRV" },
    { name: "Juno", symbol: "JUNO" },
    { name: "LayerZero", symbol: "ZRO" },
    { name: "Coinbase Wrapped BTC", symbol: "cbBTC" },
    { name: "Ethereum Name Service", symbol: "ENS" },
  ];
  for (const token of real) {
    assert.deepEqual(spamReasonsOf(token), [], `${token.symbol} should read as a normal token`);
    assert.equal(isSpamToken(token), false);
  }
});

test("a web address in the name is spam", () => {
  const token = { name: "Visit usdt-claim.io to claim 5,000 USDT", symbol: "USDT" };
  assert.equal(isSpamToken(token), true);
  assert.ok(spamReasonsOf(token).includes("contains a web address"));
  // Chat invites are the same trick.
  assert.equal(isSpamToken({ name: "t.me/freebies", symbol: "FREE" }), true);
  assert.equal(isSpamToken({ name: "Telegram giveaway", symbol: "GIFT" }), true);
  assert.equal(isSpamToken({ name: "admin @support_team", symbol: "HELP" }), true);
  assert.equal(isSpamToken({ name: "https://example.com", symbol: "URL" }), true);
});

test("airdrop wording alone is enough", () => {
  assert.equal(isSpamToken({ name: "Claim your airdrop", symbol: "SCAM" }), true);
  assert.equal(spamReasonOf({ name: "🐸 PEPE AIRDROP", symbol: "PEPE2" }), "airdrop wording");
  assert.equal(isSpamToken({ name: "Claim", symbol: "CLAIM" }), true);
  assert.equal(isSpamToken({ name: "Voucher 1000", symbol: "VCHR" }), true);
});

test("impossible names and indexer flags are caught too", () => {
  // Zero-width / bidi characters, used to make a fake ticker look real.
  assert.equal(isSpamToken({ name: "USDC\u200B", symbol: "USDC" }), true);
  assert.equal(spamReasonOf({ name: "USDC\u202E", symbol: "USDC" }), "hidden characters");
  // A name that is really a sentence.
  const long = { name: "Congratulations! You have received a reward of 10,000 USDT from the Tether Team", symbol: "RWD" };
  assert.equal(isSpamToken(long), true);
  // The symbol can carry the whole advert.
  assert.equal(isSpamToken({ name: "Token", symbol: "VISIT-SITE-NOW-TO-CLAIM" }), true);
  // Whatever the chain itself said.
  assert.equal(spamReasonOf({ name: "Mystery", symbol: "MYS", spam: true }), "flagged by the chain");
  assert.equal(isSpamToken({ name: "Mystery", symbol: "MYS", isSpam: true }), true);
  // A clean token with a flag left undefined stays clean.
  assert.equal(isSpamToken({ name: "Bitcoin", symbol: "BTC", spam: false }), false);
});

test("splitSpam hides nothing when the filter is off", () => {
  const rows = [
    { name: "Ethereum", symbol: "ETH" },
    { name: "Claim your airdrop", symbol: "SCAM" },
  ];
  const off = splitSpam(rows, false);
  assert.deepEqual(off.kept.map((r) => r.symbol), ["ETH", "SCAM"]);
  assert.equal(off.spamCount, 0);
  assert.deepEqual(off.spam, []);

  const on = splitSpam(rows, true);
  assert.deepEqual(on.kept.map((r) => r.symbol), ["ETH"]);
  assert.deepEqual(on.spam.map((r) => r.symbol), ["SCAM"]);
  assert.equal(on.spamCount, 1);
});

test("a token worth real money is still spam — value is not the test", () => {
  // Scam tokens carry made-up prices, so a dust cut-off cannot catch them.
  const worthLots = {
    name: "Visit claim-rewards.io",
    symbol: "USDT",
    valueUsd: 48_000,
    value: 48_000,
  };
  assert.equal(isSpamToken(worthLots), true);
  assert.deepEqual(splitSpam([worthLots], true).kept, []);
});

const read = (path: string) => readFileSync(resolve(__dirname, "../src", path), "utf8");

test("the wallet importer hides spam and says what it hid", () => {
  const dialog = read("components/AddAssetDialog.tsx");
  assert.ok(dialog.includes("splitSpam("), "the picker uses the shared rule");
  assert.ok(dialog.includes("Hide spam tokens"), "the control exists");
  assert.ok(dialog.includes("walletHideSpam"), "it can be switched off");
  assert.ok(dialog.includes("skipSpam: walletHideSpam"), "the server is told about it");
  assert.ok(dialog.includes("skippedSpam"), "the import message reports it");
  assert.ok(dialog.includes("Spam is hidden, not dropped"), "it can be revealed");
  assert.ok(dialog.includes("balances: walletVisibleBalances"), "spam never reaches Import all");
});

test("the server re-applies the spam rule so a stale page cannot import junk", () => {
  const actions = read("app/actions.ts");
  const body = actions.slice(actions.indexOf("export async function importWalletBalances"));
  assert.ok(body.includes("skipSpam"), "the action accepts the switch");
  assert.ok(body.includes("isSpamToken("), "spam is skipped while importing");
  assert.ok(body.includes("skippedSpam"), "the caller is told how many were skipped");
});

test("the holdings table filters spam, and spam is never counted in the totals", () => {
  const table = read("components/HoldingsTable.tsx");
  assert.ok(table.includes("splitSpam("), "the table uses the shared rule");
  assert.ok(table.includes("Hide spam"), "the switch exists");
  assert.ok(table.includes("Show them"), "hidden holdings can be revealed");
  assert.ok(table.includes("hideSpam && !arranging"), "arrange mode still shows them");
  assert.ok(table.includes("spam: boolean") || table.includes("spam?:"), "rows carry the flag");

  const page = read("app/page.tsx");
  assert.ok(page.includes("isSpamToken("), "the dashboard marks spam");
  assert.ok(page.includes("spam,"), "rows are tagged for the table");
  assert.ok(page.includes("list.filter((asset) => !isSpamToken(asset))"), "totals skip spam");

  const portfolio = read("lib/portfolio.ts");
  const totals = portfolio.slice(portfolio.indexOf("export function computeTotals"));
  assert.ok(totals.includes("isSpamToken("), "the snapshot and alert totals skip it too");
});
