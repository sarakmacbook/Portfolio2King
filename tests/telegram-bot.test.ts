import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chatIdFromUpdates,
  discoverChatId,
  isValidBotToken,
  maskBotToken,
  normaliseChatId,
  verifyBotToken,
} from "../src/lib/telegram-bot";

const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";

function fakeFetch(handler: (url: string) => Response | Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("bot tokens are validated before they are stored", () => {
  assert.equal(isValidBotToken(TOKEN), true);
  assert.equal(isValidBotToken(`  ${TOKEN}  `), true);
  assert.equal(isValidBotToken("123456789:short"), false);
  assert.equal(isValidBotToken("not-a-token"), false);
  assert.equal(isValidBotToken(""), false);
  assert.equal(isValidBotToken(null), false);
  assert.equal(isValidBotToken(123456), false);
});

test("chat ids accept users, groups and channels", () => {
  assert.equal(normaliseChatId("123456789"), "123456789");
  assert.equal(normaliseChatId(" -1001234567890 "), "-1001234567890");
  assert.equal(normaliseChatId("@my_channel"), "@my_channel");
  assert.equal(normaliseChatId("abc"), null);
  assert.equal(normaliseChatId("@ab"), null);
  assert.equal(normaliseChatId("42"), "42");
  assert.equal(normaliseChatId(""), null);
  assert.equal(normaliseChatId(undefined), null);
});

test("the token hint never exposes the secret", () => {
  const masked = maskBotToken(TOKEN);
  assert.equal(masked, "123456789:••••Dsaw");
  assert.equal(masked.includes("AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"), false);
  assert.equal(maskBotToken("garbage"), "••••");
});

test("chatIdFromUpdates picks the most recent chat that messaged the bot", () => {
  const payload = {
    ok: true,
    result: [
      { update_id: 1, message: { chat: { id: 111, first_name: "Old" }, text: "/start" } },
      { update_id: 2, my_chat_member: { chat: { id: 222, title: "Team group" } } },
      { update_id: 3, message: { chat: { id: 333, first_name: "Sara", username: "sara" }, text: "hi" } },
    ],
  };
  assert.deepEqual(chatIdFromUpdates(payload), { chatId: "333", title: "@sara" });
});

test("chatIdFromUpdates handles channels and empty payloads", () => {
  assert.deepEqual(
    chatIdFromUpdates({ ok: true, result: [{ channel_post: { chat: { id: -1001234567890, title: "Portfolio news" } } }] }),
    { chatId: "-1001234567890", title: "Portfolio news" },
  );
  assert.equal(chatIdFromUpdates({ ok: true, result: [] }), null);
  assert.equal(chatIdFromUpdates({ ok: false }), null);
  assert.equal(chatIdFromUpdates(null), null);
  assert.equal(chatIdFromUpdates("nope"), null);
  assert.equal(chatIdFromUpdates({ ok: true, result: [{ update_id: 9 }] }), null);
});

test("verifyBotToken reports the bot username", async () => {
  let calledUrl = "";
  const result = await verifyBotToken(
    TOKEN,
    fakeFetch((url) => {
      calledUrl = url;
      return json({ ok: true, result: { username: "ledgerly_bot" } });
    }),
  );
  assert.deepEqual(result, { ok: true, username: "ledgerly_bot" });
  assert.ok(calledUrl.startsWith(`https://api.telegram.org/bot${TOKEN}/getMe`));
});

test("verifyBotToken distinguishes a rejected token from a network problem", async () => {
  const rejected = await verifyBotToken(TOKEN, fakeFetch(() => json({ ok: false }, 401)));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.ok === false && rejected.rejected, true);
  assert.match(rejected.ok === false ? rejected.error : "", /rejected this bot token/);

  const offline = await verifyBotToken(
    TOKEN,
    fakeFetch(() => {
      throw new Error("ENETUNREACH");
    }),
  );
  assert.equal(offline.ok, false);
  assert.equal(offline.ok === false && offline.rejected, false);
  assert.match(offline.ok === false ? offline.error : "", /Could not reach api\.telegram\.org/);
});

test("discoverChatId explains what to do when no chat exists yet", async () => {
  const empty = await discoverChatId(TOKEN, fakeFetch(() => json({ ok: true, result: [] })));
  assert.equal("error" in empty, true);
  assert.match("error" in empty ? empty.error : "", /send \/start/);

  const found = await discoverChatId(
    TOKEN,
    fakeFetch(() => json({ ok: true, result: [{ message: { chat: { id: 42, first_name: "Sara" } } }] })),
  );
  assert.deepEqual(found, { chatId: "42", title: "Sara" });
});
