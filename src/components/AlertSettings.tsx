"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveAlertSettingsAction, sendTestAlertAction, type AlertActionState } from "@/app/alert-actions";
import { type AlertSettings } from "@/lib/alert-rules";
import { SubmitButton } from "./ui";

const REFRESH_OPTIONS = [0, 5, 10, 15, 30, 60, 120];

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

export default function AlertSettingsForm({
  settings,
  telegramConnected = true,
}: {
  settings: AlertSettings;
  telegramConnected?: boolean;
}) {
  const [state, action] = useActionState<AlertActionState, FormData>(
    (_previous, formData) => saveAlertSettingsAction(_previous, formData),
    {},
  );

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="kind" value="alert-settings" />

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
            Send a notification when a holding moves beyond the threshold below. Turning this off still allows manual
            test alerts.
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
            Month rules catch slower swings; day rules catch single-session moves. New holdings without history compare
            with the previous refresh.
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

      <fieldset>
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
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Save alert settings</SubmitButton>
        <span className="text-xs text-slate-400">Alerts are deduplicated: at most one per asset, window, direction and day.</span>
      </div>
      <Note state={state} />
    </form>
  );
}
