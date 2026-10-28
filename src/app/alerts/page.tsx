import DatabaseSetup from "@/components/DatabaseSetup";
import Link from "next/link";
import AlertSettingsForm, { TestAlertButton } from "@/components/AlertSettings";
import NotificationSetup from "@/components/NotificationSetup";
import TelegramConnect from "@/components/TelegramConnect";
import { isDatabaseConfigured } from "@/db";
import {
  countPushSubscriptions,
  getAlertSettings,
  getAutoNoteStep,
  getLastPortfolioUpdate,
  getLastPriceRefresh,
  getRecentAlerts,
  getVapidConfig,
} from "@/lib/alerts";
import { getTelegramStatus } from "@/lib/telegram-bot";
import {
  nextPortfolioAlertAt,
  resolveTimeZone,
  zonedClock,
  type AlertWindow,
  type PortfolioMessageContext,
} from "@/lib/alert-rules";
import { buildPortfolioUpdate, type PortfolioUpdate } from "@/lib/price-refresh";
export const dynamic = "force-dynamic";

const CURL_SNIPPET = `curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  https://your-portfolio.example.com/api/cron/refresh-prices`;

function timeAgo(date: Date | null): string {
  if (!date) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export default async function AlertsPage() {
  if (!isDatabaseConfigured()) return <DatabaseSetup />;

  const [settings, subscribers, telegram, recent, lastRefresh, lastPortfolio, autoNoteStep] = await Promise.all([
    getAlertSettings(),
    countPushSubscriptions(),
    getTelegramStatus(),
    getRecentAlerts(12),
    getLastPriceRefresh(),
    getLastPortfolioUpdate(),
    getAutoNoteStep(),
  ]);

  const portfolioZone = resolveTimeZone(settings.portfolio.timezone);
  const nextPortfolioAt =
    settings.portfolio.enabled && settings.portfolio.time
      ? nextPortfolioAlertAt(new Date(), settings.portfolio.time, portfolioZone, settings.portfolio)
      : null;
  const nextPortfolioLabel = nextPortfolioAt
    ? nextPortfolioAt.toLocaleString("en-US", {
        timeZone: portfolioZone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : null;

  // The exact message a Telegram send would carry: real totals, the real
  // comparison window and the date it would go out. Built here (server) so the
  // preview on /alerts is not a mock-up with invented numbers. All three
  // cadences are prepared, so switching the preview updates before saving.
  const previewContext: PortfolioMessageContext = {
    date: zonedClock(new Date(), portfolioZone).date,
    time: settings.portfolio.time || "18:00",
    window: "day",
  };
  let previewUpdates: Record<AlertWindow, PortfolioUpdate | null> = { day: null, week: null, month: null };
  try {
    const build = (window: AlertWindow) => buildPortfolioUpdate(settings, 0, { preview: true, window });
    const [day, week, month] = await Promise.all([build("day"), build("week"), build("month")]);
    previewUpdates = { day, week, month };
  } catch {
    // A preview must never take the settings page down with it.
    previewUpdates = { day: null, week: null, month: null };
  }

  let publicKey: string | null = null;
  let keyError = "";
  try {
    publicKey = (await getVapidConfig()).publicKey;
  } catch {
    keyError = "Push keys could not be initialised. Check the database connection.";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Refresh prices in the background and get notified on this device (web clip) and in Telegram when a holding
          moves beyond your threshold — or get one scheduled message with your whole portfolio change in money and
          percent. Last price update: <strong className="text-slate-700">{timeAgo(lastRefresh)}</strong>.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-base font-semibold text-slate-900">Browser push · web clip</h2>
          <p className="mt-1 mb-4 text-sm text-slate-500">
            Works in desktop browsers and in an installed Home Screen app on iOS 16.4+ and Android.
          </p>
          <NotificationSetup publicKey={publicKey} subscribers={subscribers} />
          {keyError && <p className="mt-3 text-xs text-rose-600">{keyError}</p>}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <TestAlertButton channel="push" label="Send test notification" disabled={!publicKey} />
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-base font-semibold text-slate-900">Telegram bot</h2>
          <p className="mt-1 mb-4 text-sm text-slate-500">
            Messages are sent through the Telegram Bot API using a bot you own. Connect it right here — no server
            restart needed. Nothing else is shared.
          </p>
          <TelegramConnect status={telegram} />
        </section>
      </div>

      <section className="card p-5 sm:p-6">
        <h2 className="text-base font-semibold text-slate-900">Alert rules</h2>
        <p className="mt-1 mb-5 text-sm text-slate-500">
          Holding thresholds apply to stocks and crypto, measured over the window you choose; cash is never alerted.
          The portfolio update covers the whole total and runs at the time you pick — its threshold is optional.
        </p>
        <AlertSettingsForm
          settings={settings}
          telegramConnected={telegram.configured}
          nextPortfolioLabel={nextPortfolioLabel}
          lastPortfolioLabel={lastPortfolio ? timeAgo(lastPortfolio) : null}
          previewUpdates={previewUpdates}
          previewContext={previewContext}
          initialAutoNoteStep={autoNoteStep}
        />
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="text-base font-semibold text-slate-900">Refresh in the background</h2>
        <p className="mt-1 text-sm text-slate-500">
          The app refreshes prices while a tab is open. To refresh on a schedule with nobody watching, call the cron
          endpoint from your server or scheduler.
        </p>

        <div className="mt-4 space-y-4 text-sm text-slate-600">
          <div>
            <p className="font-medium text-slate-800">1 · Set a secret (recommended)</p>
            <p className="mt-1 text-xs text-slate-500">
              Add <code className="rounded bg-slate-100 px-1 py-0.5">CRON_SECRET</code> to the server environment and
              restart. Without it the endpoint is open and throttled to one run per minute.
            </p>
            <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-900 px-4 py-3 text-xs leading-relaxed text-slate-100">
{`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`}
            </pre>
          </div>

          <div>
            <p className="font-medium text-slate-800">2 · Call the endpoint every 10 minutes</p>
            <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-900 px-4 py-3 text-xs leading-relaxed text-slate-100">{CURL_SNIPPET}</pre>
            <p className="mt-2 text-xs text-slate-500">
              Host cron: <code>*/10 * * * * /usr/local/bin/portfolio-refresh</code>. systemd timer and GitHub Actions
              examples are in the README. On Vercel, schedule <code>/api/cron/refresh-prices</code> in{" "}
              <code>vercel.json</code> (minute-level crons need a Pro plan; the bundled daily cron also sends alerts).
            </p>
          </div>

          <div>
            <p className="font-medium text-slate-800">3 · Verify</p>
            <p className="mt-1 text-xs text-slate-500">
              A healthy response looks like{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5">
                {`{ "ok": true, "refreshedCrypto": 3, "alertsSent": 1 }`}
              </code>
              . Alerts are deduplicated, so frequent runs do not repeat the same message.
            </p>
          </div>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Recent alerts</h2>
          <Link href="/prices" className="text-xs font-medium text-indigo-600 hover:underline">
            Refresh prices manually
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            No alerts yet. They appear here once a holding moves beyond {settings.thresholdPct}% over{" "}
            {settings.window === "month" ? "30 days" : "a day"}
            {settings.portfolio.enabled && settings.portfolio.time
              ? `, or with the portfolio update at ${settings.portfolio.time}`
              : ""}
            .
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((event) => (
              <li key={event.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{event.body}</p>
                </div>
                <div className="text-right text-xs text-slate-400">
                  <p>{event.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                  <p className="mt-0.5">
                    {[event.pushSent > 0 ? `push ${event.pushSent}` : "", event.telegramSent ? "telegram" : ""]
                      .filter(Boolean)
                      .join(" · ") || "no channel delivered"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
