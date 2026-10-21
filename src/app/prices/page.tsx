import DatabaseSetup from "@/components/DatabaseSetup";
import { isDatabaseConfigured } from "@/db";
import Link from "next/link";
import BulkPriceForm, { type PriceRow } from "@/components/BulkPriceForm";
import { getAllAssets } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

export default async function PricesPage() {
  if (!isDatabaseConfigured()) return <DatabaseSetup />;
  const list = await getAllAssets();
  const rows: PriceRow[] = list
    .filter((a) => a.type !== "cash")
    .sort((a, b) => (a.type === b.type ? (a.symbol || a.name).localeCompare(b.symbol || b.name) : a.type.localeCompare(b.type)))
    .map((a) => ({
      id: a.id,
      type: a.type,
      name: a.name,
      symbol: a.symbol,
      quantity: a.quantity,
      currentPrice: a.currentPrice,
      updated: a.priceUpdatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Update prices</h1>
        <p className="mt-1 text-sm text-slate-500">
          Fetch live crypto prices from a CEX or DEX, or enter prices manually. Review the changes before saving; a
          daily snapshot is stored so you can track value over time.
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
    </div>
  );
}
