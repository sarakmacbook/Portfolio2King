import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  MAX_RECENT_ADDRESSES,
  RECENT_ADDRESSES_KEY,
  addressKindHint,
  addressKindLabel,
  evmChecksumStatus,
  forgetAddress,
  keccak256Hex,
  parseAddressInput,
  parseRecentAddresses,
  parseWalletAddress,
  rememberAddress,
  type RecentAddress,
} from "../src/lib/wallet-address";

/** Vitalik's address, checksummed. */
const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const SOLANA = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const BTC = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const TRON = "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7";

test("keccak-256 matches the published vectors", () => {
  // The hash every EIP-55 checksum is built from.
  assert.equal(keccak256Hex(""), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(keccak256Hex("abc"), "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  assert.equal(
    keccak256Hex("The quick brown fox jumps over the lazy dog"),
    "4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15",
  );
});

test("a mixed-case EVM address is checked against its own checksum", () => {
  // Correctly checksummed: the casing is the one EIP-55 asks for.
  assert.equal(evmChecksumStatus(VITALIK), "ok");
  // All lower / all upper is legal but makes no claim, so nothing is checked.
  assert.equal(evmChecksumStatus(VITALIK.toLowerCase()), "unknown");
  assert.equal(evmChecksumStatus(`0x${VITALIK.slice(2).toUpperCase()}`), "unknown");
  // One character different in the casing: the address as typed is not the one
  // its checksum spells, which in practice means a mistyped character.
  assert.equal(evmChecksumStatus("0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045"), "invalid");
  assert.equal(evmChecksumStatus("nonsense"), "unknown");
});

test("a link or a line of text is reduced to the address inside it", () => {
  assert.equal(parseAddressInput(VITALIK).address, VITALIK);
  assert.equal(parseAddressInput(VITALIK).source, "clean");
  assert.equal(parseAddressInput(`  ${SOLANA}\n`).address, SOLANA);

  const link = parseAddressInput(`https://etherscan.io/address/${VITALIK}#tokentxns`);
  assert.equal(link.address, VITALIK);
  assert.equal(link.source, "link");
  assert.match(link.note ?? "", /out of that link/);

  const solscan = parseAddressInput(`https://solscan.io/account/${SOLANA}?cluster=mainnet`);
  assert.equal(solscan.address, SOLANA);
  assert.equal(solscan.source, "link");

  const tronscan = parseAddressInput(`https://tronscan.org/#/address/${TRON}`);
  assert.equal(tronscan.address, TRON);

  const btc = parseAddressInput(`https://mempool.space/address/${BTC}`);
  assert.equal(btc.address, BTC);

  const chatty = parseAddressInput(`here you go: ${VITALIK} thanks`);
  assert.equal(chatty.address, VITALIK);
  assert.equal(chatty.source, "text");

  // Nothing address-shaped: the text comes back so the UI can explain itself.
  assert.equal(parseAddressInput("hello").address, "hello");
  assert.deepEqual(parseAddressInput("   "), { address: "", source: "empty" });
});

test("the scan box knows what it is looking at, and what is wrong", () => {
  const empty = parseWalletAddress("   ");
  assert.equal(empty.status, "empty");
  assert.equal(empty.error, false);

  const evm = parseWalletAddress(VITALIK);
  assert.equal(evm.status, "valid");
  assert.equal(evm.kind, "evm");
  assert.equal(evm.kindLabel, "EVM");
  assert.equal(evm.short, "0xd8dA…6045");
  assert.equal(evm.error, false);
  assert.equal(evm.message, undefined, "a clean paste needs no note");

  // A link says where the address came from.
  const fromLink = parseWalletAddress(`https://basescan.org/address/${VITALIK}`);
  assert.equal(fromLink.status, "valid");
  assert.equal(fromLink.source, "link");
  assert.match(fromLink.message ?? "", /out of that link/);

  // A bad checksum is scanned but flagged: usually it is one wrong character.
  const typo = parseWalletAddress("0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  assert.equal(typo.status, "valid");
  assert.equal(typo.checksumFailed, true);
  assert.equal(typo.error, true);
  assert.match(typo.message ?? "", /checksum/);

  // The other three families are recognised, and each says what will happen.
  for (const [address, kind, label] of [
    [SOLANA, "solana", "Solana"],
    [BTC, "bitcoin", "Bitcoin"],
    [TRON, "tron", "Tron"],
  ] as const) {
    const parsed = parseWalletAddress(address);
    assert.equal(parsed.status, "valid", address);
    assert.equal(parsed.kind, kind);
    assert.equal(parsed.kindLabel, label);
    assert.match(addressKindHint(kind), /source menu/);
    assert.equal(addressKindLabel(kind), label);
  }
  assert.match(addressKindHint("evm"), /EVM chain/);

  // A wrong-shaped value is an error, with the four formats named.
  const bad = parseWalletAddress("0x1234");
  assert.equal(bad.status, "invalid");
  assert.equal(bad.error, true);
  assert.match(bad.message ?? "", /Solana base58/);
  const badLink = parseWalletAddress("https://etherscan.io/tx/0xdeadbeef");
  assert.match(badLink.message ?? "", /did not contain an address/);
});

test("scanned addresses are remembered, refreshed, and capped", () => {
  assert.deepEqual(parseRecentAddresses(null), []);
  assert.deepEqual(parseRecentAddresses("not json"), []);
  assert.deepEqual(parseRecentAddresses('{"a":1}'), []);

  const at = "2026-01-02T03:04:05.000Z";
  let recent = rememberAddress([], VITALIK, { at });
  assert.deepEqual(recent, [{ address: VITALIK, scannedAt: at }]);

  // A label can be added, and re-scanning moves the address to the front.
  recent = rememberAddress(recent, VITALIK, { label: "Ledger", at });
  assert.equal(recent[0].label, "Ledger");
  recent = rememberAddress(recent, SOLANA, { at });
  assert.deepEqual(recent.map((item) => item.address), [SOLANA, VITALIK]);
  recent = rememberAddress(recent, VITALIK, { at });
  assert.deepEqual(recent.map((item) => item.address), [VITALIK, SOLANA]);
  assert.equal(recent[0].label, "Ledger", "the label survives the move");
  assert.equal(recent.length, 2);

  // Junk is refused rather than stored.
  assert.deepEqual(rememberAddress(recent, "hello"), recent);
  assert.deepEqual(rememberAddress(recent, "   "), recent);

  // The list is capped at the handful of wallets anyone owns.
  let many: RecentAddress[] = [];
  for (let index = 0; index < MAX_RECENT_ADDRESSES + 3; index += 1) {
    many = rememberAddress(many, `0x${String(index).padStart(40, "0")}`, { at });
  }
  assert.equal(many.length, MAX_RECENT_ADDRESSES);

  // Storage is re-read defensively: bad rows dropped, duplicates removed.
  const stored = parseRecentAddresses(
    JSON.stringify([
      { address: VITALIK, label: "Ledger", scannedAt: at },
      { address: VITALIK, scannedAt: at },
      { address: "nonsense", scannedAt: at },
      { address: SOLANA, scannedAt: "not a date" },
      { address: SOLANA },
      "string",
      null,
    ]),
  );
  assert.deepEqual(stored.map((item) => item.address), [VITALIK, SOLANA]);
  assert.equal(stored[0].label, "Ledger");
  assert.equal(stored[1].scannedAt, new Date(0).toISOString(), "an unreadable date sorts last, not out");

  assert.deepEqual(forgetAddress(stored, VITALIK).map((item) => item.address), [SOLANA]);
  assert.equal(forgetAddress(stored, VITALIK).length, 1);
});

test("the scan box uses the address helpers", () => {
  const dialog = readFileSync(resolve(__dirname, "../src/components/AddAssetDialog.tsx"), "utf8");

  assert.ok(dialog.includes("parseWalletAddress("), "the box parses what was pasted");
  assert.ok(dialog.includes("rememberAddress("), "a scan is remembered on the device");
  assert.ok(dialog.includes("RECENT_ADDRESSES_KEY"), "under its own storage key");
  assert.ok(dialog.includes("forgetAddress("), "and can be forgotten");
  assert.ok(dialog.includes("walletAddressParsed.kindLabel"), "the kind is shown as a badge");
  assert.ok(dialog.includes("checksumFailed"), "a bad checksum is called out");
  assert.ok(
    dialog.includes('aria-label="Recently scanned wallet addresses"'),
    "there is a recent-addresses list",
  );
  assert.ok(
    dialog.includes('disabled={scanningWallet || walletAddressParsed.status !== "valid"}'),
    "Scan is disabled until the address is one the scanner knows",
  );
});
