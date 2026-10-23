"use client";

import { PROVIDER_LABELS, type PriceProvider } from "@/lib/market-prices";

/**
 * Small, self-contained marks for the exchanges a holding can be priced from —
 * used as folder icons and as the badge on a holding that came from an exchange.
 *
 * They are inline SVG rather than remote images so they render instantly, need
 * no network, and stay crisp on both themes.
 */

export const EXCHANGE_BRAND_COLORS: Record<PriceProvider, string> = {
  binance: "#f0b90b",
  okx: "#111827",
  bybit: "#f7a600",
  coinbase: "#0052ff",
  kraken: "#5741d9",
  dexscreener: "#1f6bff",
};

export function ExchangeMark({ provider }: { provider: PriceProvider }) {
  switch (provider) {
    case "binance":
      return (
        <svg viewBox="0 0 32 32" className="h-[70%] w-[70%]" aria-hidden="true">
          <polygon points="16,4 21.5,9.5 19.2,11.8 16,8.6 12.8,11.8 10.5,9.5" fill="#1e2026" />
          <polygon points="16,28 10.5,22.5 12.8,20.2 16,23.4 19.2,20.2 21.5,22.5" fill="#1e2026" />
          <polygon points="6.6,12.6 8.9,14.9 6.6,17.2 4.3,14.9" fill="#1e2026" />
          <polygon points="25.4,12.6 27.7,14.9 25.4,17.2 23.1,14.9" fill="#1e2026" />
          <polygon points="16,11.6 19.3,14.9 16,18.2 12.7,14.9" fill="#1e2026" />
        </svg>
      );
    case "okx":
      return (
        <svg viewBox="0 0 32 32" className="h-[64%] w-[64%]" aria-hidden="true">
          <rect x="5" y="5" width="7" height="7" rx="1.2" fill="#ffffff" />
          <rect x="20" y="5" width="7" height="7" rx="1.2" fill="#ffffff" />
          <rect x="12.5" y="12.5" width="7" height="7" rx="1.2" fill="#ffffff" />
          <rect x="5" y="20" width="7" height="7" rx="1.2" fill="#ffffff" />
          <rect x="20" y="20" width="7" height="7" rx="1.2" fill="#ffffff" />
        </svg>
      );
    case "bybit":
      return (
        <svg viewBox="0 0 32 32" className="h-[70%] w-[70%]" aria-hidden="true">
          <rect x="6" y="9" width="12" height="4.4" rx="1.2" fill="#ffffff" />
          <rect x="6" y="15.4" width="12" height="4.4" rx="1.2" fill="#ffffff" />
          <rect x="20" y="9" width="6" height="13.8" rx="1.5" fill="#17181e" />
        </svg>
      );
    case "coinbase":
      return (
        <svg viewBox="0 0 32 32" className="h-[70%] w-[70%]" aria-hidden="true">
          <circle cx="16" cy="16" r="11" fill="#ffffff" />
          <rect x="12.2" y="12.2" width="7.6" height="7.6" rx="1.8" fill="#0052ff" />
        </svg>
      );
    case "kraken":
      return (
        <svg viewBox="0 0 32 32" className="h-[68%] w-[68%]" aria-hidden="true">
          <path
            d="M5 17.5h4.2l2.2-6 3.1 12 3.4-16 3.1 12.4 1.9-6.6H27"
            stroke="#ffffff"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      );
    case "dexscreener":
      return (
        <svg viewBox="0 0 32 32" className="h-[64%] w-[64%]" aria-hidden="true">
          <path d="M6 24 13 12l5 7 3-4 5 9H6Z" fill="#ffffff" />
        </svg>
      );
  }
}

/**
 * A folder icon: an exchange mark, a custom emoji, or the folder's initial. All
 * three render in the same square so a row of folders looks even.
 */
export default function ExchangeIcon({
  provider,
  glyph,
  label,
  color,
  className = "h-7 w-7 rounded-lg",
  title,
}: {
  /** Exchange id, when the icon is an exchange mark. */
  provider?: PriceProvider | "";
  /** Emoji or short text for a custom icon. */
  glyph?: string;
  /** Fallback initial(s) — usually the first letter of the folder name. */
  label?: string;
  color: string;
  className?: string;
  title?: string;
}) {
  const text = (glyph || label || "•").slice(0, 2);
  const isEmoji = Boolean(glyph) && !/^[a-z0-9 ]+$/i.test(glyph ?? "");

  return (
    <span
      className={`${className} relative grid shrink-0 place-items-center overflow-hidden text-[11px] font-bold text-white shadow-sm`}
      style={{ backgroundColor: color }}
      title={title ?? (provider ? PROVIDER_LABELS[provider] : text)}
    >
      {provider ? (
        <ExchangeMark provider={provider} />
      ) : (
        <span className={isEmoji ? "text-[13px] leading-none" : "uppercase"}>{text}</span>
      )}
    </span>
  );
}
