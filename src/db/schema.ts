import {
  date,
  doublePrecision,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { ASSET_TYPES, TX_KINDS, type AssetType, type TxKind } from "../lib/constants";
import type { PriceProvider } from "../lib/market-prices";

export { ASSET_TYPES, TX_KINDS };
export type { AssetType, TxKind };

export const CRYPTO_CATEGORIES = ["stablecoin", "volatile"] as const;
export type CryptoCategory = (typeof CRYPTO_CATEGORIES)[number];

export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  type: text("type").$type<AssetType>().notNull(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull().default(""),
  cryptoCategory: text("crypto_category").$type<CryptoCategory>().notNull().default("volatile"),
  /**
   * Exchange a crypto asset was added from (Bybit, OKX, Binance, Coinbase,
   * Kraken or DexScreener). "" = no preference, every provider is tried.
   */
  priceSource: text("price_source").$type<PriceProvider | "">().notNull().default(""),
  quantity: doublePrecision("quantity").notNull().default(0),
  avgCost: doublePrecision("avg_cost").notNull().default(0),
  currentPrice: doublePrecision("current_price").notNull().default(0),
  realizedPnl: doublePrecision("realized_pnl").notNull().default(0),
  notes: text("notes").notNull().default(""),
  priceUpdatedAt: timestamp("price_updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id")
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" }),
  kind: text("kind").$type<TxKind>().notNull(),
  quantity: doublePrecision("quantity").notNull(),
  price: doublePrecision("price").notNull(),
  fee: doublePrecision("fee").notNull().default(0),
  date: date("date").notNull(),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const snapshots = pgTable("snapshots", {
  date: date("date").primaryKey(),
  totalValue: doublePrecision("total_value").notNull(),
  costBasis: doublePrecision("cost_basis").notNull(),
  cashValue: doublePrecision("cash_value").notNull(),
});

export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    assetId: integer("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    price: doublePrecision("price").notNull(),
  },
  (table) => [primaryKey({ columns: [table.assetId, table.date] })],
);

/** Web Push subscriptions (one row per browser/device that enabled alerts). */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Delivered alerts. `dedupeKey` is unique so a scheduled refresh that runs every
 * few minutes cannot send the same alert twice.
 */
export const alertEvents = pgTable("alert_events", {
  id: serial("id").primaryKey(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  kind: text("kind").notNull(),
  assetId: integer("asset_id"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  channels: text("channels").notNull().default(""),
  pushSent: integer("push_sent").notNull().default(0),
  pushFailed: integer("push_failed").notNull().default(0),
  telegramSent: integer("telegram_sent").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Small key/value store for alert settings and generated VAPID keys. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Asset = typeof assets.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Snapshot = typeof snapshots.$inferSelect;
export type PriceSnapshot = typeof priceSnapshots.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type AlertEvent = typeof alertEvents.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
