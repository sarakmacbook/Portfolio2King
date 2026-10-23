import DatabaseSetup from "@/components/DatabaseSetup";
import { isDatabaseConfigured } from "@/db";
import Link from "next/link";
import AutoDailySnapshot from "@/components/AutoDailySnapshot";
import BulkPriceForm, { type PriceRow } from "@/components/BulkPriceForm";
import { PortfolioPriceHistory, type AssetPriceHistoryItem } from "@/components/PriceHistorySection";
import { getAllAssets, getAllPriceSnapshots, localDateString, today } from "@/lib/portfolio";
import { buildAssetPriceSeries, type PricePoint } from "@/lib/price-history";
import { loadAssetWalletLogos } from "@/lib/web3-wallets-db";

export const dynamic = "force-dynamic";

export default async function PricesPage() {
  if (!isDatabaseConfigured()) return <DatabaseSetup />;
  const list = await getAllAssets();
  const [priceSnaps, walletLogos] = await Promise.all([
    getAllPriceSnapshots(),
    loadAssetWalletLogos(),
  ]);
  const t = today();
  const stalePrices = list.some(
    (a) =>
      (a.type === "crypto" || a.type === "stock") &&
      a.symbol.trim() !== "" &&
      localDateString(a.priceUpdatedAt) < t,
  );

  const byAsset = new Map<number, PricePoint[]>();
  for (const row of priceSnaps) {
    const existing = byAsset.get(row.assetId) ?? [];
    existing.push({ date: row.date, price: row.price });
    byAsset.set(row.assetId, existing);
  }

  const pricedAssets = list
    .filter((a) => a.type !== "cash")
    .sort((a, b) =>
      a.type === b.type ? (a.symbol || a.name).localeCompare(b.symbol || b.name) : a.type.localeCompare(b.type),
    );

  const historyItems: AssetPriceHistoryItem[] = pricedAssets.map((a) => ({
    id: a.id,
    type: a.type,
    name: a.name,
    symbol: a.symbol,
    wallet: walletLogos[a.id],
    avgCost: a.avgCost,
    currentPrice: a.currentPrice,
    points: buildAssetPriceSeries(byAsset.get(a.id) ?? [], a.currentPrice, t),
  }));

  const rows: PriceRow[] = pricedAssets.map((a, idx) => ({
    id: a.id,
    type: a.type,
    name: a.name,
    symbol: a.symbol,
    wallet: walletLogos[a.id],
    priceSource: a.priceSource,
    quantity: a.quantity,
    currentPrice: a.currentPrice,
    updated: a.priceUpdatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    snapshotsCount: historyItems[idx].points.length,
  }));

  return (
    <div className="space-y-6">
      <AutoDailySnapshot stale={stalePrices} currentDate={t} />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Refresh prices</h1>
        <p className="mt-1 text-sm text-slate-500">
          Fetch live prices — crypto from a CEX or DEX, stocks and ETFs from Yahoo Finance — or enter prices
          manually. Each asset&apos;s daily snapshot price is saved automatically and tracked as its price history
          below.
        </p>
      </div>
      <section className="card overflow-hidden">
        {rows.length ? (
          <BulkPriceForm rows={rows} />
        ) : (
          <div className="px-6 py-14 text-center text-sm text-slate-400">
            No priced assets yet.{" "}
            <Link href="/" className="font-medium text-indigo-600 hover:underline">
              Add a stock or crypto
            </Link>{" "}
            first.
          </div>
        )}
      </section>

      <PortfolioPriceHistory assets={historyItems} />
    </div>
  );
}
