"use client";

import { useState } from "react";

type Props = {
  symbol: string;
  name?: string;
  className?: string;
};

export default function CryptoLogo({ symbol, name, className = "h-9 w-9" }: Props) {
  const [failed, setFailed] = useState(false);
  const ticker = symbol.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const initials = (symbol || name || "?").slice(0, 4).toUpperCase();

  return (
    <span
      className={`${className} relative grid shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-[10px] font-bold text-white`}
      title={name || symbol}
    >
      {initials}
      {ticker && !failed && (
        // CoinCap exposes public symbol-based icons and does not require an API key.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://assets.coincap.io/assets/icons/${ticker}@2x.png`}
          alt={`${name || symbol} logo`}
          className="crypto-logo-image absolute inset-0 h-full w-full bg-white object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
