/**
 * The auto note: one short line the app picks for you and appends to each
 * scheduled recap, so the message reads differently every day (or week, or
 * month) without you writing anything.
 *
 * It is deliberately **offline and deterministic**: there is no API key, no
 * network call and no cost, and the same period always produces the same line —
 * a retried send, a preview and the delivered message agree. Consecutive
 * periods step through the list, so a daily recap never repeats yesterday's
 * line.
 *
 * These are original one-liners rather than famous quotations: a misattributed
 * quote in a money app is worse than no quote at all.
 */
import type { AlertWindow } from "./alert-rules";

export const AUTO_NOTES: readonly string[] = [
  "Keep the plan, ignore the noise.",
  "Boring portfolios win quietly.",
  "Small steps, steady ledger.",
  "Today's number is not the whole story.",
  "Patience is a position.",
  "Nothing to do is a decision too.",
  "The market is loud. Your plan isn't.",
  "Count it, don't chase it.",
  "Long games are won on quiet days.",
  "Consistency compounds.",
  "Look at the trend, not the tick.",
  "One day is a data point, not a verdict.",
  "Stay the course you chose calmly.",
  "Volatility is the price of admission.",
  "Write it down; memory is biased.",
  "Risk first, returns later.",
  "Time in beats timing.",
  "No drama in a spreadsheet.",
  "Your future self reads this log.",
  "Keep receipts, keep calm.",
  "A flat day is still a day in the market.",
  "Zoom out before you act.",
  "Plans beat predictions.",
  "Cash is a position too.",
  "Measure, don't guess.",
  "The best trade is often none.",
  "Sleep well, review often.",
  "Set it, check it, leave it.",
  "Discipline is a quiet advantage.",
  "Numbers don't need a narrative.",
  "Hold the line you drew.",
  "Every ledger tells its story slowly.",
  "Compounding hates interruptions.",
  "Doubt is expensive; data is cheap.",
  "Check the facts, then the feelings.",
  "Fewer decisions, better ones.",
  "The plan already knows what to do.",
  "Steady hands, long horizon.",
  "Not every day needs a move.",
  "One good habit beats ten good hunches.",
  "Let the boring parts work.",
  "Track it, don't perform it.",
  "Your allocation is the strategy.",
  "Calm is a competitive edge.",
  "Look again next month.",
  "Progress hides in the average.",
  "Nothing changed. That's allowed.",
  "Same plan, new day.",
];

/**
 * Cadence offsets keep the three recaps from picking the same line when they
 * land on the same date (a weekly recap on a daily day, for instance).
 */
const CADENCE_OFFSET: Record<AlertWindow, number> = { day: 0, week: 17, month: 31 };

function daysSinceEpoch(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * The period index of a recap: days for the daily cadence, weeks for the weekly
 * one, months for the monthly one. It increments by exactly one per period,
 * which is what makes the chosen line advance instead of repeat.
 */
function periodIndex(window: AlertWindow, periodKey: string): number {
  if (window === "month") {
    const [year, month] = periodKey.split("-").map(Number);
    return year * 12 + (month - 1);
  }
  const days = daysSinceEpoch(periodKey);
  return window === "week" ? Math.floor(days / 7) : days;
}

/**
 * The line for one send. `periodKey` is the dedupe period — the local date for
 * daily and weekly recaps, `YYYY-MM` for the monthly one — so every send in the
 * same period gets the same line and the next period gets the next one.
 */
export function autoNoteFor(window: AlertWindow, periodKey: string): string {
  const index = periodIndex(window, periodKey) + CADENCE_OFFSET[window];
  return AUTO_NOTES[((index % AUTO_NOTES.length) + AUTO_NOTES.length) % AUTO_NOTES.length];
}

/** Same helper, for a calendar date: the monthly cadence keys by month. */
export function autoNoteForDate(window: AlertWindow, date: string): string {
  return autoNoteFor(window, window === "month" ? date.slice(0, 7) : date);
}
