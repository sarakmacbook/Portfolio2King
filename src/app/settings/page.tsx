import DatabaseSetup from "@/components/DatabaseSetup";
import Link from "next/link";
import PriceUpdatesSettings from "@/components/PriceUpdatesSettings";
import { isDatabaseConfigured } from "@/db";
import { getAlertSettings, getLastPriceRefresh } from "@/lib/alerts";
import { MAX_REFRESH_MINUTES, MIN_REFRESH_MINUTES } from "@/lib/alert-rules";

export const dynamic = "force-dynamic";

function timeAgo(date: Date | null): string | null {
  if (!date) return null;
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export default async function SettingsPage() {
  if (!isDatabaseConfigured()) return <DatabaseSetup />;

  const [settings, lastRefresh] = await Promise.all([getAlertSettings(), getLastPriceRefresh()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          How the app keeps itself up to date while you are using it.
        </p>
      </div>

      <PriceUpdatesSettings
        settings={{
          backgroundRefreshMinutes: settings.backgroundRefreshMinutes,
          autoRefresh: settings.autoRefresh,
        }}
        lastUpdatedLabel={timeAgo(lastRefresh)}
      />

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900">Three ways prices stay current</h2>
        <dl className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Background updates
            </dt>
            <dd className="mt-1 text-xs leading-relaxed text-slate-600">
              The switch above. While a tab is open the app asks the server for fresh prices every{" "}
              {settings.backgroundRefreshMinutes > 0
                ? `${settings.backgroundRefreshMinutes} minutes`
                : `few minutes`}
              , and the server decides what is actually due — so several open tabs cannot multiply
              provider requests. Range: {MIN_REFRESH_MINUTES}–{MAX_REFRESH_MINUTES} minutes.
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Scheduled runs
            </dt>
            <dd className="mt-1 text-xs leading-relaxed text-slate-600">
              A cron job or systemd timer calling{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5">/api/cron/refresh-prices</code>.
              This is the only option that works with the app closed, and it is also what delivers
              alerts on time. Set it up on the{" "}
              <Link href="/alerts" className="text-indigo-600 hover:underline">
                Alerts
              </Link>{" "}
              page.
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Manual
            </dt>
            <dd className="mt-1 text-xs leading-relaxed text-slate-600">
              The{" "}
              <Link href="/prices" className="text-indigo-600 hover:underline">
                Refresh prices
              </Link>{" "}
              page, which also lets you type a price in by hand. It works whatever the two switches
              above are set to.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
