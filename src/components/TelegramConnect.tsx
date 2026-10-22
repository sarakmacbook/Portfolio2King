"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  connectTelegramAction,
  disconnectTelegramAction,
  type AlertActionState,
} from "@/app/alert-actions";
import type { TelegramStatus } from "@/lib/telegram-bot";
import { TestAlertButton } from "./AlertSettings";

function Note({ state }: { state: AlertActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">
        {state.error}
      </p>
    );
  }
  if (state.ok && (state.message || state.warning)) {
    return (
      <div className="space-y-1">
        {state.message && (
          <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-emerald-200">
            {state.message}
          </p>
        )}
        {state.warning && (
          <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
            {state.warning}
          </p>
        )}
      </div>
    );
  }
  return null;
}

function ConnectSubmit({ connected }: { connected: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full sm:w-auto" disabled={pending}>
      {pending ? (connected ? "Updating…" : "Connecting…") : connected ? "Update bot" : "Connect bot"}
    </button>
  );
}

function DisconnectSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-danger" disabled={pending}>
      {pending ? "Disconnecting…" : "Disconnect"}
    </button>
  );
}

function SetupSteps() {
  return (
    <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-500">
      <li>
        In Telegram, open <strong>@BotFather</strong>, send{" "}
        <code className="rounded bg-slate-100 px-1">/newbot</code> and follow the prompts. Copy the token it gives you.
      </li>
      <li>
        Open your new bot and send it any message (for example <code className="rounded bg-slate-100 px-1">/start</code>).
      </li>
      <li>
        Paste the token below and click <strong>Connect bot</strong> — the chat is detected for you.
      </li>
    </ol>
  );
}

/**
 * Connect a Telegram bot without editing environment variables or restarting.
 * The token is validated with `getMe`; the chat id is detected automatically
 * from the most recent message to the bot when it is left blank.
 */
export default function TelegramConnect({ status }: { status: TelegramStatus }) {
  const [connectState, connectAction] = useActionState<AlertActionState, FormData>(connectTelegramAction, {});
  const [disconnectState, disconnectAction] = useActionState<AlertActionState, FormData>(
    disconnectTelegramAction,
    {},
  );
  const [chatId, setChatId] = useState("");
  const [open, setOpen] = useState(!status.configured);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <span className={`inline-flex h-2 w-2 rounded-full ${status.configured ? "bg-emerald-500" : "bg-slate-300"}`} />
        <span className="font-medium text-slate-700">{status.configured ? "Connected" : "Not connected"}</span>
        {status.source === "env" && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            from environment variables
          </span>
        )}
        {status.source === "settings" && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
            added in the app
          </span>
        )}
      </div>

      {status.configured && (
        <dl className="grid gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-slate-500">Bot</dt>
            <dd className="truncate font-medium text-slate-800">
              {status.botUsername ? `@${status.botUsername}` : status.tokenHint ?? "configured"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-slate-500">Chat id</dt>
            <dd className="truncate font-medium tabular-nums text-slate-800">{status.chatId ?? "—"}</dd>
          </div>
          {status.botUsername && status.tokenHint && (
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-slate-500">Token</dt>
              <dd className="truncate font-mono text-[11px] text-slate-600">{status.tokenHint}</dd>
            </div>
          )}
        </dl>
      )}

      {status.source === "env" && (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Set by <code className="rounded bg-white px-1 py-0.5 ring-1 ring-slate-200">TELEGRAM_BOT_TOKEN</code> and{" "}
          <code className="rounded bg-white px-1 py-0.5 ring-1 ring-slate-200">TELEGRAM_CHAT_ID</code> on the server.
          Connecting a bot below overrides them without a restart.
        </p>
      )}

      {status.configured && (
        <div className="flex flex-wrap items-center gap-2">
          <TestAlertButton channel="telegram" label="Send test message" className="btn-ghost" />
          <button type="button" className="btn-ghost" onClick={() => setOpen((value) => !value)}>
            {open ? "Hide settings" : "Change bot"}
          </button>
          {status.source === "settings" && (
            <form action={disconnectAction}>
              <input type="hidden" name="kind" value="telegram-bot" />
              <DisconnectSubmit />
            </form>
          )}
        </div>
      )}

      {!status.configured && <SetupSteps />}

      {open && (
        <form action={connectAction} className="space-y-4 border-t border-slate-100 pt-4">
          <input type="hidden" name="kind" value="telegram-bot" />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <label className="label" htmlFor="telegram-token">
                Bot token
              </label>
              <input
                id="telegram-token"
                name="token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={status.configured ? "Leave blank to keep the saved token" : "123456789:AA…"}
                className="input font-mono text-[13px]"
                aria-describedby="telegram-token-hint"
              />
              <p id="telegram-token-hint" className="mt-1 text-xs text-slate-400">
                From <strong>@BotFather</strong> → <em>API Token</em>. It stays on the server and is only shown masked.
              </p>
            </div>
            <div className="min-w-0">
              <label className="label" htmlFor="telegram-chat">
                Chat id <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                id="telegram-chat"
                name="chatId"
                inputMode="numeric"
                autoComplete="off"
                value={chatId}
                onChange={(event) => setChatId(event.target.value)}
                placeholder="Detected automatically"
                className="input tabular-nums"
                aria-describedby="telegram-chat-hint"
              />
              <p id="telegram-chat-hint" className="mt-1 text-xs text-slate-400">
                Leave blank and the last chat that messaged the bot is used. Use{" "}
                <code className="rounded bg-slate-100 px-1">-100…</code> for a group or{" "}
                <code className="rounded bg-slate-100 px-1">@name</code> for a channel.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <ConnectSubmit connected={status.configured} />
            <span className="text-xs text-slate-400">
              Telegram must be reachable from the server for verification and delivery.
            </span>
          </div>

          <Note state={connectState} />
        </form>
      )}

      <Note state={disconnectState} />
    </div>
  );
}
