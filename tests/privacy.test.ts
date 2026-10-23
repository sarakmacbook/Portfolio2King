import assert from "node:assert/strict";
import crypto from "node:crypto";
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
  PRIVACY_DEVICE_MAX_AGE,
  PRIVACY_STORAGE_KEY,
  createPasskeyChallenge,
  createPasskeyOnlyPrivacyConfig,
  createPrivacyConfig,
  createSessionToken,
  extractP256SpkiFromAuthData,
  maskSensitiveText,
  parsePrivacyConfig,
  privacyBootScript,
  validatePin,
  verifyPasskeyAssertion,
  verifyPasskeyRegistration,
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

test("WebAuthn Passkey & iPhone Face ID helpers verify P-256 registration, CBOR fallback, and assertions", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const spkiDer = publicKey.export({ type: "spki", format: "der" });
  const spkiBase64url = spkiDer.toString("base64url");

  // Also test CBOR COSE key extraction from authenticatorData (32-byte X and Y at end of 91-byte SPKI)
  const x = spkiDer.subarray(27, 59);
  const y = spkiDer.subarray(59, 91);
  const coseKey = Buffer.concat([
    Buffer.from([
      0xa5, // map(5)
      0x01, 0x02, // 1: 2 (EC2)
      0x03, 0x26, // 3: -7 (ES256)
      0x20, 0x01, // -1: 1 (P-256)
      0x21, 0x58, 0x20, // -2: bstr(32) X
    ]),
    x,
    Buffer.from([0x22, 0x58, 0x20]), // -3: bstr(32) Y
    y,
  ]);
  const rpIdHash = crypto.createHash("sha256").update("app.test").digest();
  const flagsWithAttestedCred = Buffer.from([0x45]); // UP (0x01) + UV (0x04) + AT (0x40)
  const signCount = Buffer.alloc(4);
  const aaguid = Buffer.alloc(16);
  const credIdBytes = Buffer.from("iphone-faceid-cred-1");
  const credIdLen = Buffer.alloc(2);
  credIdLen.writeUInt16BE(credIdBytes.length, 0);
  const fullAttestedAuthData = Buffer.concat([
    rpIdHash,
    flagsWithAttestedCred,
    signCount,
    aaguid,
    credIdLen,
    credIdBytes,
    coseKey,
  ]);
  assert.equal(
    extractP256SpkiFromAuthData(fullAttestedAuthData.toString("base64url")),
    spkiBase64url,
  );

  // Register passkey via verifyPasskeyRegistration
  const config = createPasskeyOnlyPrivacyConfig();
  const regChallenge = createPasskeyChallenge(config.sessionSecret);
  const regClientData = Buffer.from(
    JSON.stringify({
      type: "webauthn.create",
      challenge: regChallenge.challenge,
      origin: "https://app.test",
    }),
  ).toString("base64url");

  const storedCred = verifyPasskeyRegistration({
    credentialId: credIdBytes.toString("base64url"),
    clientDataJSON: regClientData,
    authenticatorData: fullAttestedAuthData.toString("base64url"),
    challengeToken: regChallenge.challengeToken,
    secret: config.sessionSecret,
    label: "iPhone Face ID / Passkey",
  });
  assert.equal(storedCred.publicKeySpki, spkiBase64url);
  assert.equal(storedCred.label, "iPhone Face ID / Passkey");

  config.passkeys = [storedCred];

  // Create & verify assertion
  const authChallenge = createPasskeyChallenge(config.sessionSecret);
  const getClientDataBuf = Buffer.from(
    JSON.stringify({
      type: "webauthn.get",
      challenge: authChallenge.challenge,
      origin: "https://app.test",
    }),
  );
  const assertionAuthData = Buffer.concat([
    rpIdHash,
    Buffer.from([0x05]), // UP + UV
    Buffer.alloc(4),
  ]);
  const clientDataHash = crypto.createHash("sha256").update(getClientDataBuf).digest();
  const signedPayload = Buffer.concat([assertionAuthData, clientDataHash]);
  const signature = crypto.sign("sha256", signedPayload, privateKey);

  assert.equal(
    verifyPasskeyAssertion({
      credentialId: storedCred.id,
      clientDataJSON: getClientDataBuf.toString("base64url"),
      authenticatorData: assertionAuthData.toString("base64url"),
      signature: signature.toString("base64url"),
      challengeToken: authChallenge.challengeToken,
      config,
      expectedRpId: "app.test",
    }),
    true,
  );

  // Tampered signature must fail
  const badSig = Buffer.from(signature);
  badSig[badSig.length - 1] ^= 0xff;
  assert.equal(
    verifyPasskeyAssertion({
      credentialId: storedCred.id,
      clientDataJSON: getClientDataBuf.toString("base64url"),
      authenticatorData: assertionAuthData.toString("base64url"),
      signature: badSig.toString("base64url"),
      challengeToken: authChallenge.challengeToken,
      config,
      expectedRpId: "app.test",
    }),
    false,
  );
});

test("privacy API enforces PIN lock, Face ID / Passkey lock, reveal protection, export guard, and rate limit", async () => {
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

    // Initial state has no PIN or Passkey and is unlocked.
    const initialRes = await privacyGET(new Request("http://app.test/api/privacy"));
    const initial = await initialRes.json();
    assert.equal(initial.hasPin, false);
    assert.equal(initial.hasPasskey, false);
    assert.equal(initial.locked, false);

    // Cross-origin POST is rejected with 403.
    const crossOrigin = await privacyPOST(req({ action: "hide" }, "", "https://evil.test"));
    assert.equal(crossOrigin.status, 403);

    // Register an iPhone Face ID / Passkey (without needing a PIN) and lock immediately.
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const spkiBase64url = publicKey.export({ type: "spki", format: "der" }).toString("base64url");
    const credentialId = Buffer.from("iphone-face-id-credential").toString("base64url");

    const regOptRes = await privacyPOST(req({ action: "passkeyRegisterOptions" }));
    assert.equal(regOptRes.status, 200);
    const regOpt = await regOptRes.json();
    assert.ok(regOpt.challenge);
    assert.ok(regOpt.challengeToken);

    const regClientData = Buffer.from(
      JSON.stringify({
        type: "webauthn.create",
        challenge: regOpt.challenge,
        origin: "http://app.test",
      }),
    ).toString("base64url");

    const regRes = await privacyPOST(
      req({
        action: "passkeyRegister",
        credentialId,
        clientDataJSON: regClientData,
        publicKeySpki: spkiBase64url,
        alg: -7,
        label: "iPhone Face ID / Passkey",
        challengeToken: regOpt.challengeToken,
        lockNow: true,
      }),
    );
    assert.equal(regRes.status, 200);
    const regJson = await regRes.json();
    assert.equal(regJson.hasPasskey, true);
    assert.equal(regJson.hasPin, false);
    assert.equal(regJson.locked, true);
    assert.equal(regJson.passkeys.length, 1);

    // Unauthenticated visitor sees locked=true when Passkey-only lock is active.
    const passkeyStranger = await (
      await privacyGET(new Request("http://app.test/api/privacy"))
    ).json();
    assert.equal(passkeyStranger.hasPasskey, true);
    assert.equal(passkeyStranger.locked, true);

    // Stranger cannot register another passkey while locked.
    const blockedReg = await privacyPOST(req({ action: "passkeyRegisterOptions" }));
    assert.equal(blockedReg.status, 401);

    // Unlock using Face ID / Passkey assertion (`passkeyAuthOptions` -> `unlockPasskey`).
    const authOptRes = await privacyPOST(req({ action: "passkeyAuthOptions" }));
    assert.equal(authOptRes.status, 200);
    const authOpt = await authOptRes.json();
    assert.deepEqual(authOpt.credentialIds, [credentialId]);

    const getClientDataBuf = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge: authOpt.challenge,
        origin: "http://app.test",
      }),
    );
    const authDataBuf = Buffer.concat([
      crypto.createHash("sha256").update("app.test").digest(),
      Buffer.from([0x05]),
      Buffer.alloc(4),
    ]);
    const sigBuf = crypto.sign(
      "sha256",
      Buffer.concat([
        authDataBuf,
        crypto.createHash("sha256").update(getClientDataBuf).digest(),
      ]),
      privateKey,
    );

    const passkeyUnlockRes = await privacyPOST(
      req({
        action: "unlockPasskey",
        credentialId,
        clientDataJSON: getClientDataBuf.toString("base64url"),
        authenticatorData: authDataBuf.toString("base64url"),
        signature: sigBuf.toString("base64url"),
        challengeToken: authOpt.challengeToken,
      }),
    );
    assert.equal(passkeyUnlockRes.status, 200);
    const pkCookieHeader = passkeyUnlockRes.headers.get("set-cookie") ?? "";
    const pkMatch = new RegExp(`${PRIVACY_COOKIE_NAME}=([^;]+)`).exec(pkCookieHeader);
    assert.ok(pkMatch, "Expected session cookie after Face ID / Passkey unlock");
    const pkSessionCookie = `${PRIVACY_COOKIE_NAME}=${pkMatch[1]}`;

    // Remove the passkey while unlocked.
    const removePkRes = await privacyPOST(
      req({ action: "removePasskey", credentialId }, pkSessionCookie),
    );
    assert.equal(removePkRes.status, 200);
    const removePkJson = await removePkRes.json();
    assert.equal(removePkJson.hasPasskey, false);
    assert.equal(removePkJson.locked, false);

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

    // "Remembered until you lock": the unlock cookie outlives a 30-day session
    // and the response tells the client to cache the device.
    assert.match(setCookieHeader, new RegExp("Max-Age=" + PRIVACY_DEVICE_MAX_AGE));
    assert.equal((await unlockRes.clone().json()).remembered, true);

    // Forgetting the device clears the remembered unlock, so the next visit is
    // treated like a brand-new device and must pass Face ID / PIN again.
    const forgetRes = await privacyPOST(req({ action: "forgetDevice" }, sessionCookie));
    assert.equal(forgetRes.status, 200);
    const forgetJson = await forgetRes.json();
    assert.equal(forgetJson.remembered, false);
    assert.equal(forgetJson.locked, true);
    const forgetCookies = forgetRes.headers.get("set-cookie") ?? "";
    assert.match(forgetCookies, new RegExp(`${PRIVACY_COOKIE_NAME}=;`));
    assert.match(forgetCookies, /Max-Age=0/);

    // The browser no longer holds a session cookie, so it looks like a new
    // device again (the forgotten token itself is not resubmitted).
    const forgottenStatus = await (
      await privacyGET(new Request("http://app.test/api/privacy"))
    ).json();
    assert.equal(forgottenStatus.locked, true);

    // Re-unlocking issues a fresh remembered session for the rest of the test.
    resetPrivacyRateLimitForTests();
    const reUnlock = await privacyPOST(req({ action: "unlock", pin: "9876" }));
    assert.equal(reUnlock.status, 200);
    const reMatch = new RegExp(`${PRIVACY_COOKIE_NAME}=([^;]+)`).exec(
      reUnlock.headers.get("set-cookie") ?? "",
    );
    assert.ok(reMatch);
    const activeSessionCookie = `${PRIVACY_COOKIE_NAME}=${reMatch[1]}`;

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
      req({ action: "removePin", currentPin: "wrong" }, activeSessionCookie),
    );
    assert.equal(removeBad.status, 401);

    resetPrivacyRateLimitForTests();
    const removeOk = await privacyPOST(
      req({ action: "removePin", currentPin: "9876" }, activeSessionCookie),
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
