import {
  date,
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { ASSET_TYPES, TX_KINDS, type AssetType, type TxKind } from "../lib/constants";

export { ASSET_TYPES, TX_KINDS };
export type { AssetType, TxKind };

export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  type: text("type").$type<AssetType>().notNull(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull().default(""),
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

export type Asset = typeof assets.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Snapshot = typeof snapshots.$inferSelect;
