import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { CAMBODIAN_BANKS, CUSTOM_BANK } from "../src/lib/cambodian-banks";

test("CAMBODIAN_BANKS includes MB Bank and has unique, valid bank entries", () => {
  const names = new Set<string>();
  for (const bank of CAMBODIAN_BANKS) {
    assert.ok(bank.name.trim().length > 0, "bank name must not be empty");
    assert.ok(bank.short.trim().length > 0, "bank short code must not be empty");
    assert.match(bank.color, /^#[0-9a-fA-F]{6}$/);
    assert.equal(names.has(bank.name), false, `duplicate bank entry: ${bank.name}`);
    names.add(bank.name);
  }

  const mbBank = CAMBODIAN_BANKS.find((bank) => bank.name === "MB Bank");
  assert.ok(mbBank, "Expected MB Bank in CAMBODIAN_BANKS");
  assert.equal(mbBank.short, "MB");
});

test("CUSTOM_BANK is defined for custom cash bank accounts", () => {
  assert.equal(CUSTOM_BANK.name, "Custom bank");
  assert.ok(CUSTOM_BANK.short.length > 0);
  assert.match(CUSTOM_BANK.color, /^#[0-9a-fA-F]{6}$/);
});

test("AddAssetDialog cash bank picker exposes both CAMBODIAN_BANKS and Custom bank", () => {
  const dialogSource = readFileSync(
    resolve(__dirname, "../src/components/AddAssetDialog.tsx"),
    "utf8",
  );
  assert.ok(dialogSource.includes("CAMBODIAN_BANKS.map"));
  assert.ok(dialogSource.includes("CUSTOM_BANK"));
  assert.ok(dialogSource.includes("setCustomBankSelected(true)"));
});
