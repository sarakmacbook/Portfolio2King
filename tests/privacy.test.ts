import assert from "node:assert/strict";
import { test } from "node:test";
import { GET as exportGET } from "../src/app/api/database/export/route";
import {
  GET as privacyGET,
  POST as privacyPOST,
  resetPrivacyRateLimitForTests,
} from "../src/app/api/privacy/route";
import {
  MASKED_VALUE,
  PRIVACY_COOKIE_NAME,
  PRIVACY_STORAGE_KEY,
  createPrivacyConfig,
  createSessionToken,
  maskSensitiveText,
  parsePrivacyConfig,
  privacyBootScript,
  validatePin,
  verifyPin,
  verifySessionToken,
} from "../src/lib/privacy";
import { clearPrivacyConfig } from "../src/lib/privacy-db";

test("PIN validation, salted scrypt hashing, and session tokens round-trip securely", () => {
  assert.throws(() => validatePin(""), /between 4 and 32/);
  assert.throws(() => validatePin("123"), /between 4 and 32/);
  assert.throws(() => validatePin("a".repeat(33)), /between 4 and 32/);
  assert.equal(validatePin("  2468  "), "2468");

  const config = createPrivacyConfig("2468");
  const parsed = parsePrivacyConfig(JSON.stringify(config));
  assert.ok(parsed);
  assert.equal(verifyPin("2468", parsed), true);
  assert.equal(verifyPin("0000", parsed), false);
  assert.equal(verifyPin("", parsed), false);

  const token = createSessionToken(parsed);
  assert.equal(verifySessionToken(token, parsed), true);
  assert.equal(verifySessionToken("tampered", parsed), false);
  assert.equal(verifySessionToken(null, parsed), false);

  assert.equal(parsePrivacyConfig("not-json"), null);
  assert.equal(parsePrivacyConfig(JSON.stringify({ salt: "short" })), null);
});

test("maskSensitiveText masks dollar values, percentages, and tabular numbers", () => {
  assert.equal(maskSensitiveText("$12,345.67"), MASKED_VALUE);
  assert.equal(
    maskSensitiveText("+$320.50 (+2.64%) since Oct 22, 2026"),
    `${MASKED_VALUE} (${MASKED_VALUE}) since Oct 22, 2026`,
  );
  assert.equal(maskSensitiveText("-$1.2M"), MASKED_VALUE);
  assert.equal(maskSensitiveText("1.25400000", true), MASKED_VALUE);
  assert.equal(maskSensitiveText("Start tracking your portfolio", false), "Start tracking your portfolio");
});

test("privacyBootScript applies privacy-hidden class before first paint when stored", () => {
  const classes = new Set<string>();
  const documentElement = {
    classList: {
      add: (cls: string) => classes.add(cls),
    },
  };
  const storage = new Map<string, string>([[PRIVACY_STORAGE_KEY, "1"]]);
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
  };

  new Function("document", "localStorage", privacyBootScript())(
    { documentElement },
    localStorage,
  );
  assert.equal(classes.has("privacy-hidden"), true);
});

test("privacy API enforces PIN lock, reveal protection, export guard, and brute-force rate limit", async () => {
  const originalDbUrl = process.env.DATABASE_URL;
  const originalPgUrl = process.env.POSTGRES_URL;
  try {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    await clearPrivacyConfig();
    resetPrivacyRateLimitForTests();

    function req(body: unknown, cookie = "", origin = "http://app.test") {
      const headers: Record<string, string> = {
        origin,
        "content-type": "application/json",
      };
      if (cookie) headers.cookie = cookie;
      return new Request("http://app.test/api/privacy", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    }

    // Initial state has no PIN and is unlocked.
    const initialRes = await privacyGET(new Request("http://app.test/api/privacy"));
    const initial = await initialRes.json();
    assert.equal(initial.hasPin, false);
    assert.equal(initial.locked, false);

    // Cross-origin POST is rejected with 403.
    const crossOrigin = await privacyPOST(req({ action: "hide" }, "", "https://evil.test"));
    assert.equal(crossOrigin.status, 403);

    // Set a PIN and lock immediately.
    const setRes = await privacyPOST(
      req({ action: "setPin", pin: "9876", lockNow: true }),
    );
    assert.equal(setRes.status, 200);
    const setJson = await setRes.json();
    assert.equal(setJson.hasPin, true);
    assert.equal(setJson.locked, true);
    assert.equal(setJson.hidden, true);

    // Unauthenticated visitor sees locked=true.
    const strangerStatus = await (
      await privacyGET(new Request("http://app.test/api/privacy"))
    ).json();
    assert.equal(strangerStatus.hasPin, true);
    assert.equal(strangerStatus.locked, true);

    // Database export is blocked while portfolio is locked.
    const blockedExport = await exportGET(
      new Request("http://app.test/api/database/export?download=1", {
        headers: { referer: "http://app.test/database" },
      }),
    );
    assert.equal(blockedExport.status, 403);
    const blockedBody = await blockedExport.json();
    assert.match(blockedBody.error, /locked/i);

    // Revealing balances without the PIN fails with 401.
    const badReveal = await privacyPOST(req({ action: "reveal", pin: "0000" }));
    assert.equal(badReveal.status, 401);

    // Unlocking with the correct PIN issues the HttpOnly session cookie.
    resetPrivacyRateLimitForTests();
    const unlockRes = await privacyPOST(req({ action: "unlock", pin: "9876" }));
    assert.equal(unlockRes.status, 200);
    const setCookieHeader = unlockRes.headers.get("set-cookie") ?? "";
    const match = new RegExp(`${PRIVACY_COOKIE_NAME}=([^;]+)`).exec(setCookieHeader);
    assert.ok(match, "Expected session cookie on unlock");
    const sessionCookie = `${PRIVACY_COOKIE_NAME}=${match[1]}`;

    // Authenticated request sees locked=false.
    const unlockedStatus = await (
      await privacyGET(
        new Request("http://app.test/api/privacy", {
          headers: { cookie: sessionCookie },
        }),
      )
    ).json();
    assert.equal(unlockedStatus.locked, false);

    // Brute-force wrong PIN attempts trigger HTTP 429 rate limiting.
    resetPrivacyRateLimitForTests();
    for (let i = 0; i < 5; i++) {
      const wrong = await privacyPOST(req({ action: "unlock", pin: "wrong" }));
      assert.equal(wrong.status, 401);
    }
    const throttled = await privacyPOST(req({ action: "unlock", pin: "9876" }));
    assert.equal(throttled.status, 429);

    // Removing the PIN requires the current PIN.
    resetPrivacyRateLimitForTests();
    const removeBad = await privacyPOST(
      req({ action: "removePin", currentPin: "wrong" }, sessionCookie),
    );
    assert.equal(removeBad.status, 401);

    resetPrivacyRateLimitForTests();
    const removeOk = await privacyPOST(
      req({ action: "removePin", currentPin: "9876" }, sessionCookie),
    );
    assert.equal(removeOk.status, 200);
    const afterRemove = await removeOk.json();
    assert.equal(afterRemove.hasPin, false);
    assert.equal(afterRemove.locked, false);
  } finally {
    await clearPrivacyConfig();
    resetPrivacyRateLimitForTests();
    if (originalDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDbUrl;
    if (originalPgUrl === undefined) delete process.env.POSTGRES_URL;
    else process.env.POSTGRES_URL = originalPgUrl;
  }
});
