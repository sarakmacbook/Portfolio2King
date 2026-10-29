"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { savePriceUpdatesAction, type PriceUpdatesState } from "@/app/settings-actions";
import {
  DEFAULT_ALERT_SETTINGS,
  REFRESH_INTERVAL_OPTIONS,
  type AlertSettings,
} from "@/lib/alert-rules";
import { PRICE_SETTINGS_CHANGED_EVENT } from "@/lib/price-update-events";
import { SubmitButton } from "./ui";

function intervalLabel(minutes: number): string {
  if (minutes < 60) return `every ${minutes} minutes`;
  const hours = minutes / 60;
  return `every ${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * Settings → Price updates.
 *
 * Two independent switches, because the feed and the paint are separate jobs:
 * "Update prices in the background" decides whether the server keeps fetching
 * live prices at all, and "Auto refresh" decides whether the open page is
 * redrawn when those prices land. Turning the second one off gives silent
 * updates — the data stays current while the screen holds still.
 */
export default function PriceUpdatesSettings({
  settings,
  lastUpdatedLabel = null,
}: {
  settings: Pick<AlertSettings, "backgroundRefreshMinutes" | "autoRefresh">;
  /** Pre-formatted on the server, e.g. "12 min ago". */
  lastUpdatedLabel?: string | null;
}) {
  const router = useRouter();
  const [state, action] = useActionState<PriceUpdatesState, FormData>(
    (_previous, formData) => savePriceUpdatesAction(_previous, formData),
    {},
  );

  const [enabled, setEnabled] = useState(settings.backgroundRefreshMinutes > 0);
  // Remember the last real interval, so turning the switch off and on again
  // does not silently drop the user back to the default.
  const [minutes, setMinutes] = useState(
    settings.backgroundRefreshMinutes > 0
      ? settings.backgroundRefreshMinutes
      : DEFAULT_ALERT_SETTINGS.backgroundRefreshMinutes,
  );
  const [autoRefresh, setAutoRefresh] = useState(settings.autoRefresh);

  // The page itself was re-rendered from the database by the action, but the
  // background timer in the layout is untouched. Tell it to re-read.
  useEffect(() => {
    if (!state.ok) return;
    window.dispatchEvent(new Event(PRICE_SETTINGS_CHANGED_EVENT));
    router.refresh();
  }, [state, router]);

  return (
    <form action={action} className="card p-5">
      <input type="hidden" name="kind" value="price-updates" />
      <input
        type="hidden"
        name="backgroundRefreshMinutes"
        value={enabled ? String(minutes) : "0"}
      />
      {/*
        The checkbox below is unlabelled for form submission on purpose: a
        disabled checkbox is never sent, so this hidden twin carries the stored
        choice even while the feed is off. Switching the feed back on then
        restores "auto refresh" instead of quietly clearing it.
      */}
      <input type="hidden" name="autoRefresh" value={autoRefresh ? "on" : ""} />

      <h2 className="text-sm font-semibold text-slate-900">Price updates</h2>
      <p className="mt-1 text-xs text-slate-500">
        Keep live prices moving while the app is open. If you schedule this from the server instead
        (cron or a systemd timer), you can leave both switches off.
      </p>

      <div className="mt-4 space-y-3">
        <label className="flex items-start gap-3 rounded-xl bg-slate-50 px-4 py-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-indigo-600"
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">
              Update prices in the background
            </span>
            <span className="block text-xs text-slate-500">
              Fetch live crypto and stock prices from the server on a timer. The data updates even
              when you are not looking at the numbers. Real-time changes apply to volatile crypto
              only — stablecoins keep their saved price.
            </span>
          </span>
        </label>

        <div className={enabled ? "pl-2 sm:pl-8" : "pl-2 opacity-60 sm:pl-8"}>
          <label className="label" htmlFor="priceRefreshMinutes">
            How often
          </label>
          <select
            id="priceRefreshMinutes"
            value={String(minutes)}
            onChange={(event) => setMinutes(Number(event.target.value))}
            disabled={!enabled}
            className="input"
          >
            {REFRESH_INTERVAL_OPTIONS.map((option) => (
              <option key={option} value={option}>
                Every {option < 60 ? `${option} minutes` : `${option / 60} hour${option === 60 ? "" : "s"}`}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-400">
            The timer only runs while a tab is open, pauses in a hidden tab, and refreshes on the
            first tick after you come back. Scheduled server runs are set up on the{" "}
            <span className="font-medium">Alerts</span> page.
          </p>
        </div>

        <label
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition ${
            enabled ? "border-indigo-100 bg-indigo-50/60" : "border-slate-100 bg-slate-50 opacity-60"
          }`}
        >
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(event) => setAutoRefresh(event.target.checked)}
            disabled={!enabled}
            className="mt-0.5 h-4 w-4 accent-indigo-600"
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">Auto refresh</span>
            <span className="block text-xs text-slate-500">
              Redraw the page as soon as new prices arrive. Turn it off to update silently — the
              numbers move when you reload or change page.
            </span>
          </span>
        </label>

      </div>

      <p className="mt-4 rounded-xl bg-slate-50 px-4 py-2.5 text-xs text-slate-600" aria-live="polite">
        {enabled ? (
          <>
            Prices will update <span className="font-semibold">{intervalLabel(minutes)}</span> while
            the app is open
            {autoRefresh ? ", and the page redraws itself." : ", silently — the page redraws when you reload."}
          </>
        ) : (
          <>Background updates are off. Prices change only when you refresh them yourself.</>
        )}
        {lastUpdatedLabel && (
          <span className="mt-0.5 block text-slate-400">Prices last updated {lastUpdatedLabel}.</span>
        )}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SubmitButton>Save price updates</SubmitButton>
        {state.error && (
          <p role="alert" className="text-xs text-rose-700">
            {state.error}
          </p>
        )}
        {state.ok && state.message && (
          <p role="status" className="text-xs text-emerald-700">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
