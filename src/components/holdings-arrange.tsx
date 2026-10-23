"use client";

import { createContext, useContext } from "react";
import type { HoldingFilter } from "@/lib/holdings-filter";

export type HoldingsArrangeState = {
  /** True while the dashboard is in "Arrange layout" mode. */
  arranging: boolean;
  /** Left-to-right order of the Holdings category tabs. */
  categoryOrder: HoldingFilter[];
  onCategoryOrderChange: (next: HoldingFilter[]) => void;
};

/**
 * The dashboard hands the pending category order down to the Holdings card,
 * which is rendered as a block inside it. The order lives in `DashboardLayout`
 * so one **Save layout** click stores the cards, the stat cards and the
 * category tabs together.
 */
const HoldingsArrangeContext = createContext<HoldingsArrangeState | null>(null);

export const HoldingsArrangeProvider = HoldingsArrangeContext.Provider;

/** `null` outside the dashboard, where the tabs keep their default order. */
export function useHoldingsArrange(): HoldingsArrangeState | null {
  return useContext(HoldingsArrangeContext);
}
