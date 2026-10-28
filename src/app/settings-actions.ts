"use server";

import { revalidatePath } from "next/cache";
import { saveRefreshSettings } from "@/lib/alerts";
import {
  MAX_REFRESH_MINUTES,
  MIN_REFRESH_MINUTES,
  parseRefreshMinutes,
} from "@/lib/alert-rules";

export type PriceUpdatesState = {
  ok?: boolean;
  error?: string;
  message?: string;
};

/**
 * Saves the Settings → Price updates card.
 *
 * Only the two refresh keys are written (see `saveRefreshSettings`), so saving
 * here can never reset the alert thresholds, channels or the portfolio update.
 * "Auto refresh" is stored even while background updates are off, so switching
 * the feed back on restores the choice the user made instead of a default.
 */
export async function savePriceUpdatesAction(
  _previous: PriceUpdatesState,
  formData: FormData,
): Promise<PriceUpdatesState> {
  try {
    if (formData.get("kind") !== "price-updates") throw new Error("Unknown form");

    const raw = formData.get("backgroundRefreshMinutes");
    // The switch and the interval are one control on screen: "on" is only sent
    // with a real interval, and "off" arrives as 0.
    const backgroundRefreshMinutes = raw === "0" ? 0 : parseRefreshMinutes(raw);
    if (backgroundRefreshMinutes === null) {
      throw new Error(
        `Pick an interval between ${MIN_REFRESH_MINUTES} and ${MAX_REFRESH_MINUTES} minutes.`,
      );
    }

    const autoRefresh = formData.get("autoRefresh") === "on";
    await saveRefreshSettings({ backgroundRefreshMinutes, autoRefresh });
    // The interval lives in the root layout's timer; revalidate so the next
    // render agrees with what was just saved.
    revalidatePath("/", "layout");

    if (backgroundRefreshMinutes === 0) {
      return { ok: true, message: "Saved. Prices will only update when you refresh them yourself." };
    }
    const every =
      backgroundRefreshMinutes % 60 === 0
        ? `${backgroundRefreshMinutes / 60} hour${backgroundRefreshMinutes === 60 ? "" : "s"}`
        : `${backgroundRefreshMinutes} minutes`;
    return {
      ok: true,
      message: autoRefresh
        ? `Saved. Prices update every ${every} and this page redraws itself.`
        : `Saved. Prices update every ${every} in the background; the page redraws when you reload.`,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error && error.message !== "Unknown form"
          ? error.message
          : "Could not save these settings. Check the server logs.",
    };
  }
}
