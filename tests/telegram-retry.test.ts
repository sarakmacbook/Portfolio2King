import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ALERT_SETTINGS } from "../src/lib/alert-rules";
import { dispatchAlert } from "../src/lib/alerts";

// A tiny in-memory stand-in for the alert-event queries. It exercises the real
// dispatch flow (including its retry claim) without requiring a Postgres server.
type EventRow = {
  id: number;
  dedupeKey: string;
  channels: string;
  pushSent: number;
  pushFailed: number;
  telegramSent: number;
  telegramAttemptedAt: Date | null;
};

type InsertValues = Omit<EventRow, "id" | "pushSent" | "pushFailed" | "telegramSent"> & {
  title: string;
  body: string;
};

test("a failed Telegram send is retried without repeating a delivered push", async () => {
  let event: EventRow | undefined;
  const fakeDb = {
    execute: async () => ({ rows: [] }),
    select: () => ({ from: async () => [] }),
    insert: () => ({
      values: (values: InsertValues) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (event) return [];
            event = {
              id: 1,
              ...values,
              pushSent: 0,
              pushFailed: 0,
              telegramSent: 0,
            };
            return [{ id: event.id }];
          },
        }),
      }),
    }),
    update: () => ({
      set: (patch: Partial<EventRow>) => ({
        where: () => {
          let rows: { id: number }[] = [];
          if (event && "telegramSent" in patch) {
            Object.assign(event, patch);
          } else if (event && patch.telegramAttemptedAt) {
            const cutoff = patch.telegramAttemptedAt.getTime() - 60_000;
            const due = !event.telegramAttemptedAt || event.telegramAttemptedAt.getTime() < cutoff;
            if (event.telegramSent === 0 && event.channels.includes("telegram") && due) {
              event.telegramAttemptedAt = patch.telegramAttemptedAt;
              rows = [{ id: event.id }];
            }
          }
          const result = Promise.resolve(rows);
          return Object.assign(result, { returning: async () => rows });
        },
      }),
    }),
  };

  const globals = globalThis as typeof globalThis & {
    __portfolioDb?: unknown;
    __portfolioPool?: unknown;
  };
  globals.__portfolioDb = fakeDb;
  globals.__portfolioPool = {};
  process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:5432/telegram_retry_test";
  process.env.TELEGRAM_BOT_TOKEN = `123456:${"A".repeat(35)}`;
  process.env.TELEGRAM_CHAT_ID = "42";

  const originalFetch = globalThis.fetch;
  let telegramCalls = 0;
  globalThis.fetch = (async () => {
    telegramCalls += 1;
    if (telegramCalls === 1) {
      return new Response(JSON.stringify({ ok: false, error_code: 503 }), { status: 503 });
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: 2 } }), { status: 200 });
  }) as typeof fetch;

  try {
    const settings = { ...DEFAULT_ALERT_SETTINGS, channels: ["push", "telegram"] as ("push" | "telegram")[] };
    const input = {
      dedupeKey: "price:7:2026-11-05:day:up:1",
      kind: "price_move",
      title: "BTC ▲ 6.00%",
      body: "Bitcoin moved",
      settings,
      force: true,
    };

    const first = await dispatchAlert(input);
    assert.equal(first.status, "sent");
    assert.equal(first.telegramSent, false);
    assert.equal(telegramCalls, 1);
    assert.ok(event);

    // The retry cooldown also suppresses an immediate duplicate scheduler run.
    const immediate = await dispatchAlert(input);
    assert.equal(immediate.status, "duplicate");
    assert.equal(telegramCalls, 1);

    // Simulate the push that the first combined attempt delivered before its
    // Telegram failure, then make the failed Telegram attempt eligible to retry.
    event.pushSent = 2;
    event.telegramAttemptedAt = new Date(Date.now() - 61_000);
    const retry = await dispatchAlert(input);
    assert.equal(retry.status, "sent");
    assert.equal(retry.telegramSent, true);
    assert.equal(telegramCalls, 2);
    assert.equal(event.pushSent, 2, "Telegram-only retry preserved the original push count");

    const delivered = await dispatchAlert(input);
    assert.equal(delivered.status, "duplicate");
    assert.equal(telegramCalls, 2, "a successful Telegram delivery is never sent twice");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.DATABASE_URL;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete globals.__portfolioDb;
    delete globals.__portfolioPool;
  }
});
