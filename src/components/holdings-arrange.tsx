"use client";

import { createContext, useContext } from "react";
import type { HoldingFilter } from "@/lib/holdings-filter";

export type HoldingsArrangeState = {
  /** True while the dashboard is in "Arrange layout" mode. */
  arranging: boolean;
  /** Left-to-right order of the Holdings category tabs. */
  categoryOrder: HoldingFilter[];
  onCategoryOrderChange: (next: HoldingFilter[]) => void;
  /** Top-to-bottom order of the holdings themselves, as asset ids. */
  assetOrder: number[];
  onAssetOrderChange: (next: number[]) => void;
};

/**
 * The dashboard hands the pending category and holding orders down to the
 * Holdings card, which is rendered as a block inside it. Both orders live in
 * `DashboardLayout` so one **Save layout** click stores the cards, the stat
 * cards, the category tabs and the holdings together.
 */
const HoldingsArrangeContext = createContext<HoldingsArrangeState | null>(null);

export const HoldingsArrangeProvider = HoldingsArrangeContext.Provider;

/** `null` outside the dashboard, where the tabs keep their default order. */
export function useHoldingsArrange(): HoldingsArrangeState | null {
  return useContext(HoldingsArrangeContext);
}
