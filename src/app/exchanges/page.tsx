import DatabaseSetup from "@/components/DatabaseSetup";
import ExchangeConnect from "@/components/ExchangeConnect";
import Link from "next/link";
import { isDatabaseConfigured } from "@/db";
import { getExchangeCredentialSummaries, getCredentialEncryptionKey } from "@/lib/exchange-credentials";
import { lastExchangeSync, listExchangeHoldings } from "@/lib/exchange-sync";
import { EXCHANGE_LABELS } from "@/lib/exchanges";
import { money, qty } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ExchangesPage() {
  if (!isDatabaseConfigured()) return <DatabaseSetup />;

  const [summaries, lastSync, holdings, encryption] = await Promise.all([
    getExchangeCredentialSummaries(),
    lastExchangeSync(),
    listExchangeHoldings(),
    getCredentialEncryptionKey().catch(() => null),
  ]);

  const total = holdings.reduce((sum, row) => sum + row.value, 0);
  const byExchange = new Map<string, number>();
  for (const row of holdings) {
    byExchange.set(row.exchange, (byExchange.get(row.exchange) ?? 0) + row.value);
  }

  return (
    <div className="space-y-6">
      <ExchangeConnect summaries={summaries} lastSync={lastSync} />

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Imported balances</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Quantities come from the last sync. Prices come from your normal refresh, so the values below move with
              the market.
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-slate-400">Total on exchanges</div>
            <div className="text-lg font-semibold tabular-nums">{money(total)}</div>
          </div>
        </div>

        {holdings.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-400">
            Nothing imported yet.{" "}
            <Link href="/" className="font-medium text-indigo-600 hover:underline">
              Holdings
            </Link>{" "}
            you add by hand still work as before.
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Exchange</th>
                    <th className="px-3 py-3 font-medium">Asset</th>
                    <th className="px-3 py-3 text-right font-medium">Quantity</th>
                    <th className="px-3 py-3 text-right font-medium">Price</th>
                    <th className="px-3 py-3 text-right font-medium">Value</th>
                    <th className="px-5 py-3 text-right font-medium">Last sync</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {holdings.map((row) => (
                    <tr key={`${row.exchange}-${row.assetId}`} className="hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-5 py-3 font-medium">
                        {EXCHANGE_LABELS[row.exchange] ?? row.exchange}
                      </td>
                      <td className="px-3 py-3">
                        <Link href={`/assets/${row.assetId}`} className="flex items-center gap-2 hover:text-indigo-600">
                          <span className="font-medium">{row.symbol}</span>
                          <span className="truncate text-slate-400">{row.name !== row.symbol ? row.name : ""}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{qty(row.quantity)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600">{money(row.price)}</td>
                      <td className="px-5 py-3 text-right font-medium tabular-nums">{money(row.value)}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right text-xs text-slate-400">
                        {new Date(row.syncedAt).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-slate-100 bg-slate-50/40 text-sm">
                  {[...byExchange.entries()].map(([exchange, value]) => (
                    <tr key={exchange} className="text-slate-500">
                      <td className="px-5 py-2 text-xs uppercase tracking-wide" colSpan={4}>
                        {EXCHANGE_LABELS[exchange as keyof typeof EXCHANGE_LABELS] ?? exchange}
                      </td>
                      <td className="px-5 py-2 text-right font-medium tabular-nums text-slate-700">{money(value)}</td>
                      <td />
                    </tr>
                  ))}
                </tfoot>
              </table>
            </div>

            {/* Phones: one card per position instead of a wide table. */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {holdings.map((row) => (
                <li key={`${row.exchange}-${row.assetId}`} className="px-5 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link href={`/assets/${row.assetId}`} className="font-medium hover:text-indigo-600">
                      {row.symbol}
                    </Link>
                    <span className="font-medium tabular-nums">{money(row.value)}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {EXCHANGE_LABELS[row.exchange] ?? row.exchange} · {qty(row.quantity)} @ {money(row.price)}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card space-y-2 p-5 text-xs text-slate-500">
        <h2 className="text-sm font-semibold text-slate-700">How the keys are handled</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Keys are stored <strong>encrypted</strong> (AES-256-GCM) and never leave the server — the browser only ever
            sees a mask such as <span className="font-mono">••••••••7F3A</span>.
          </li>
          <li>
            {encryption?.source === "env"
              ? "Encryption uses EXCHANGE_CREDENTIALS_KEY from the environment, so a copied database cannot be decrypted without it."
              : "No EXCHANGE_CREDENTIALS_KEY is set, so the encryption key lives in the database itself. Set that variable to protect the keys in a database dump."}
          </li>
          <li>
            Only balance-read endpoints are called. Create the key with read-only permission and, where the exchange
            allows it, an IP allowlist.
          </li>
          <li>
            Disconnecting deletes the key. Holdings it imported stay in your portfolio as normal assets, so nothing
            silently disappears from your totals.
          </li>
        </ul>
      </section>
    </div>
  );
}
