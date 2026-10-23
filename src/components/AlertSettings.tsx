"use client";

import { startTransition, useActionState, useState, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import {
  saveAlertSettingsAction,
  sendPortfolioUpdateNowAction,
  sendTestAlertAction,
  type AlertActionState,
} from "@/app/alert-actions";
import { type AlertSettings } from "@/lib/alert-rules";
import { SubmitButton } from "./ui";

const REFRESH_OPTIONS = [0, 5, 10, 15, 30, 60, 120];

/** Common zones plus whatever the device reports, so everyone can find theirs. */
const COMMON_TIME_ZONES = [
  "UTC",
  "Asia/Phnom_Penh",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Manila",
  "Asia/Kuala_Lumpur",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Moscow",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "America/Sao_Paulo",
  "America/New_York",
  "America/Toronto",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Vancouver",
];

// The device zone never changes while a page is open, so there is nothing to
// subscribe to. useSyncExternalStore keeps the server render deterministic
// ("" → the stored zone) and reads the real zone after hydration.
const noopSubscribe = () => () => {};

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function serverTimeZone(): string {
  return "";
}

function Note({ state }: { state: AlertActionState }) {
  if (state.error) {
    return <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">{state.error}</p>;
  }
  if (state.ok && state.message) {
    return <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-emerald-200">{state.message}</p>;
  }
  return null;
}

function TestSubmit({ label, disabled, className }: { label: string; disabled?: boolean; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled}>
      {pending ? "Sending…" : label}
    </button>
  );
}

export function TestAlertButton({
  channel,
  label,
  disabled,
  className = "btn-ghost",
}: {
  channel: "push" | "telegram" | "all";
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const [state, action] = useActionState<AlertActionState, FormData>(sendTestAlertAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="channel" value={channel} />
      <TestSubmit label={label} disabled={disabled} className={className} />
      <Note state={state} />
    </form>
  );
}

/**
 * Lives inside the settings form (nested forms are invalid), so the preview can
 * pick up unsaved edits.
 *
 * It is a plain button rather than `type="submit" formAction={action}`: React
 * replaces the name/value of a button whose formAction is a function (it uses the
 * name to encode the action), so a hidden `portfolioTest` flag never reached the
 * server and every click answered "Unknown form". A real submit would also reset
 * every uncontrolled field in the settings form before the action runs, throwing
 * away edits the user has not saved yet.
 */
function PortfolioTestButton() {
  const [state, action, pending] = useActionState<AlertActionState, FormData>(sendPortfolioUpdateNowAction, {});
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn-ghost"
        disabled={pending}
        onClick={(event) => {
          const form = event.currentTarget.form;
          if (!form) return;
          const formData = new FormData(form);
          startTransition(() => action(formData));
        }}
      >
        {pending ? "Sending…" : "Send portfolio update now"}
      </button>
      <Note state={state} />
    </div>
  );
}

export default function AlertSettingsForm({
  settings,
  telegramConnected = true,
  nextPortfolioLabel = null,
  lastPortfolioLabel = null,
}: {
  settings: AlertSettings;
  telegramConnected?: boolean;
  /** Pre-formatted on the server, e.g. "Fri, Oct 23, 6:00 PM GMT+7". */
  nextPortfolioLabel?: string | null;
  /** Pre-formatted on the server, e.g. "2 h ago". */
  lastPortfolioLabel?: string | null;
}) {
  const [state, action] = useActionState<AlertActionState, FormData>(
    (_previous, formData) => saveAlertSettingsAction(_previous, formData),
    {},
  );

  const [portfolioEnabled, setPortfolioEnabled] = useState(settings.portfolio.enabled);
  const [pickedTimeZone, setPickedTimeZone] = useState<string | null>(null);
  const detectedTimeZone = useSyncExternalStore(noopSubscribe, deviceTimeZone, serverTimeZone);

  // Most people never think about time zones: default to the device's own.
  const timezone =
    pickedTimeZone || settings.portfolio.timezone || detectedTimeZone || "UTC";
  const timeZones = Array.from(
    new Set([...COMMON_TIME_ZONES, settings.portfolio.timezone, detectedTimeZone, timezone].filter(Boolean)),
  );

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="kind" value="alert-settings" />

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-slate-900">Holding alerts</legend>

        <label className="flex items-start gap-3 rounded-xl bg-slate-50 px-4 py-3">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={settings.enabled}
            className="mt-0.5 h-4 w-4 accent-indigo-600"
          />
          <span>
            <span className="block text-sm font-semibold text-slate-900">Automatic price alerts</span>
            <span className="block text-xs text-slate-500">
              Send a notification when a single holding moves beyond the threshold below. Turning this off still allows
              manual test alerts and does not affect the portfolio update.
            </span>
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label" htmlFor="thresholdPct">
              Alert threshold (%)
            </label>
            <input
              id="thresholdPct"
              name="thresholdPct"
              type="number"
              inputMode="decimal"
              step="0.5"
              min="0.5"
              max="50"
              defaultValue={settings.thresholdPct}
              className="input"
            />
            <p className="mt-1 text-xs text-slate-400">
              The move must reach this size within the window to alert.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="window">
              Compare over
            </label>
            <select id="window" name="window" defaultValue={settings.window} className="input">
              <option value="day">Day — vs yesterday&apos;s close</option>
              <option value="month">Month — vs the price 30 days ago</option>
            </select>
            <p className="mt-1 text-xs text-slate-400">
              Month rules catch slower swings; day rules catch single-session moves. New holdings without history
              compare with the previous refresh.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="backgroundRefreshMinutes">
              Background refresh
            </label>
            <select
              id="backgroundRefreshMinutes"
              name="backgroundRefreshMinutes"
              defaultValue={String(settings.backgroundRefreshMinutes)}
              className="input"
            >
              {REFRESH_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes === 0 ? "Off" : `Every ${minutes} minutes while the app is open`}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              A server-side schedule keeps prices fresh when nobody has the app open — see below.
            </p>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4 border-t border-slate-100 pt-5">
        <legend className="text-sm font-semibold text-slate-900">Portfolio update</legend>

        <label className="flex items-start gap-3 rounded-xl bg-indigo-50/60 px-4 py-3">
          <input
            type="checkbox"
            name="portfolioEnabled"
            checked={portfolioEnabled}
            onChange={(event) => setPortfolioEnabled(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-indigo-600"
          />
          <span>
            <span className="block text-sm font-semibold text-slate-900">
              Send my whole portfolio change at a set time
            </span>
            <span className="block text-xs text-slate-500">
              One message with the total change in money and percent, e.g. “Portfolio ▲ +2.35% (+$1,234.56)”. This
              runs on its own switch, whether or not holding alerts are on.
            </span>
          </span>
        </label>

        <div className={portfolioEnabled ? "" : "opacity-60"}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label" htmlFor="portfolioTime">
                Send at
              </label>
              <input
                id="portfolioTime"
                name="portfolioTime"
                type="time"
                step={60}
                defaultValue={settings.portfolio.time}
                className="input"
              />
              <p className="mt-1 text-xs text-slate-400">
                The first refresh after this time sends it — never earlier. A later run the same day still
                delivers it; if nothing runs that day, that day is skipped.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="portfolioTimezone">
                Time zone
              </label>
              <select
                id="portfolioTimezone"
                name="portfolioTimezone"
                value={timezone}
                onChange={(event) => setPickedTimeZone(event.target.value)}
                className="input"
              >
                {timeZones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-400">Uses your device zone by default.</p>
            </div>
            <div>
              <label className="label" htmlFor="portfolioThresholdPct">
                Only if it moves (%)
              </label>
              <input
                id="portfolioThresholdPct"
                name="portfolioThresholdPct"
                type="number"
                inputMode="decimal"
                step="0.5"
                min="0.5"
                max="50"
                placeholder="Blank = always send"
                defaultValue={settings.portfolio.thresholdPct ?? ""}
                className="input"
              />
              <p className="mt-1 text-xs text-slate-400">Optional — leave blank to get it every day.</p>
            </div>
            <div>
              <label className="label" htmlFor="portfolioWindow">
                Compare over
              </label>
              <select id="portfolioWindow" name="portfolioWindow" defaultValue={settings.portfolio.window} className="input">
                <option value="day">Day — vs yesterday&apos;s total</option>
                <option value="month">Month — vs the total 30 days ago</option>
              </select>
              <p className="mt-1 text-xs text-slate-400">Deposits and withdrawals count as part of the change.</p>
            </div>
          </div>

          {portfolioEnabled && (nextPortfolioLabel || lastPortfolioLabel) && (
            <div className="mt-3 text-xs text-slate-500">
              {nextPortfolioLabel && (
                <p>
                  Next scheduled send: <span className="font-medium text-slate-700">{nextPortfolioLabel}</span>
                </p>
              )}
              <p className="mt-0.5">
                Last portfolio update sent:{" "}
                <span className="font-medium text-slate-700">{lastPortfolioLabel ?? "never"}</span>
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
          <PortfolioTestButton />
          <p className="max-w-md text-xs text-slate-500">
            Sends a preview of today&apos;s message through the channels below right now. It ignores the optional
            threshold and does not wait for the schedule, so it works before this is turned on.
          </p>
        </div>
      </fieldset>

      <fieldset className="border-t border-slate-100 pt-5">
        <legend className="label">Delivery channels</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              name="channels"
              value="push"
              defaultChecked={settings.channels.includes("push")}
              className="h-4 w-4 accent-indigo-600"
            />
            Browser push (web clip)
          </label>
          <label className="flex items-start gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              name="channels"
              value="telegram"
              defaultChecked={settings.channels.includes("telegram")}
              className="mt-0.5 h-4 w-4 accent-indigo-600"
            />
            <span>
              Telegram
              {!telegramConnected && (
                <span className="block text-xs text-amber-700">Connect a bot above to deliver here.</span>
              )}
            </span>
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Both the holding alerts and the portfolio update use these channels.
        </p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
        <SubmitButton>Save alert settings</SubmitButton>
        <span className="text-xs text-slate-400">
          Holding alerts are deduplicated: at most one per asset, window, direction and day. The portfolio update sends
          at most once per day.
        </span>
      </div>
      <Note state={state} />
    </form>
  );
}
