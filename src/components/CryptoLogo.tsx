"use client";

import { useState } from "react";
import {
  detectWeb3Wallet,
  type Web3Wallet,
  type Web3WalletId,
} from "@/lib/web3-wallets";

type Props = {
  symbol: string;
  name?: string;
  wallet?: Web3WalletId | string;
  /** Token artwork from an indexer (DeBank). Falls back to CoinCap by ticker. */
  logo?: string;
  className?: string;
};

export function Web3WalletSvg({ id }: { id: Web3WalletId }) {
  switch (id) {
    case "metamask":
      // MetaMask geometric fox face
      return (
        <svg viewBox="0 0 32 32" className="h-[72%] w-[72%]" aria-hidden="true">
          <polygon points="6,5 13,11 11,16 5,13" fill="#fff4e6" />
          <polygon points="26,5 19,11 21,16 27,13" fill="#fff4e6" />
          <polygon points="5,13 11,16 9,22 5,19" fill="#fde2c4" />
          <polygon points="27,13 21,16 23,22 27,19" fill="#fde2c4" />
          <polygon points="13,11 19,11 21,16 16,20 11,16" fill="#ffffff" />
          <polygon points="11,16 16,20 14,26 9,22" fill="#fed7aa" />
          <polygon points="21,16 16,20 18,26 23,22" fill="#fed7aa" />
          <polygon points="14,26 18,26 16,28" fill="#1e293b" />
          <circle cx="12.5" cy="16.5" r="1.3" fill="#1e293b" />
          <circle cx="19.5" cy="16.5" r="1.3" fill="#1e293b" />
        </svg>
      );
    case "phantom":
      // Phantom friendly ghost
      return (
        <svg viewBox="0 0 32 32" className="h-[72%] w-[72%]" aria-hidden="true">
          <path
            d="M16.5 6C10.7 6 6 10.6 6 16.3v7.2c0 1.4 1.6 2.1 2.6 1.2l1.8-1.7c.7-.6 1.8-.6 2.5 0l1.3 1.2c.8.7 2 .7 2.8 0l1.3-1.2c.7-.6 1.8-.6 2.5 0l1.6 1.5c1 .9 2.6.2 2.6-1.2v-7C25 10.6 21.4 6 16.5 6Z"
            fill="#ffffff"
          />
          <ellipse cx="13.5" cy="15" rx="1.6" ry="2.2" fill="#534bb1" />
          <ellipse cx="18.8" cy="15" rx="1.6" ry="2.2" fill="#534bb1" />
        </svg>
      );
    case "okx-web3":
      // OKX iconic 5-square 3x3 checkerboard
      return (
        <svg viewBox="0 0 32 32" className="h-[68%] w-[68%]" aria-hidden="true">
          <rect x="5" y="5" width="7" height="7" rx="1.2" fill="#ffffff" />
          <rect x="20" y="5" width="7" height="7" rx="1.2" fill="#ffffff" />
          <rect x="12.5" y="12.5" width="7" height="7" rx="1.2" fill="#ffffff" />
          <rect x="5" y="20" width="7" height="7" rx="1.2" fill="#ffffff" />
          <rect x="20" y="20" width="7" height="7" rx="1.2" fill="#ffffff" />
        </svg>
      );
    case "trust-wallet":
      // Trust Wallet shield
      return (
        <svg viewBox="0 0 32 32" className="h-[72%] w-[72%]" fill="none" aria-hidden="true">
          <path
            d="M16 5.5C19.5 8.2 23 8.6 25 8.8v7.6c0 6-4.2 9.4-9 11.1-4.8-1.7-9-5.1-9-11.1V8.8c2-.2 5.5-.6 9-3.3Z"
            stroke="#ffffff"
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "rabby":
      // Rabby rabbit silhouette
      return (
        <svg viewBox="0 0 32 32" className="h-[72%] w-[72%]" aria-hidden="true">
          <path
            d="M11.5 5.5c1.5 0 2.7 1.3 2.7 3v5.2h3.6V8.5c0-1.7 1.2-3 2.7-3s2.7 1.3 2.7 3v8.8c0 4.8-3.8 8.7-8.5 8.7s-8.5-3.9-8.5-8.7v-3.6c0-1.7 1.2-3 2.6-3v-2.2c0-1.7 1.2-3 2.7-3Z"
            fill="#ffffff"
          />
          <circle cx="18.5" cy="17.5" r="1.4" fill="#7084ff" />
        </svg>
      );
    case "coinbase-wallet":
      // Coinbase Wallet circle + inner rounded square
      return (
        <svg viewBox="0 0 32 32" className="h-[72%] w-[72%]" aria-hidden="true">
          <circle cx="16" cy="16" r="10.5" fill="#ffffff" />
          <rect x="12.2" y="12.2" width="7.6" height="7.6" rx="1.8" fill="#0052ff" />
        </svg>
      );
    case "binance-web3":
      // Binance diamond cluster
      return (
        <svg viewBox="0 0 32 32" className="h-[72%] w-[72%]" aria-hidden="true">
          <polygon points="16,5.5 21.5,11 19.2,13.3 16,10.1 12.8,13.3 10.5,11" fill="#f3ba2f" />
          <polygon points="16,26.5 10.5,21 12.8,18.7 16,21.9 19.2,18.7 21.5,21" fill="#f3ba2f" />
          <polygon points="7.8,13.7 10.1,16 7.8,18.3 5.5,16" fill="#f3ba2f" />
          <polygon points="24.2,13.7 26.5,16 24.2,18.3 21.9,16" fill="#f3ba2f" />
          <polygon points="16,13.2 18.8,16 16,18.8 13.2,16" fill="#f3ba2f" />
        </svg>
      );
    case "bybit-web3":
      return (
        <svg viewBox="0 0 32 32" className="h-[72%] w-[72%]" aria-hidden="true">
          <rect x="6" y="9" width="12" height="4.5" rx="1.2" fill="#ffffff" />
          <rect x="6" y="15.5" width="12" height="4.5" rx="1.2" fill="#ffffff" />
          <rect x="20" y="9" width="6" height="14" rx="1.5" fill="#f7a600" />
        </svg>
      );
    case "solflare":
      return (
        <svg viewBox="0 0 32 32" className="h-[72%] w-[72%]" aria-hidden="true">
          <path
            d="M17.5 5 9 17.2h6.3L13.8 27 23 14.5h-6.4L17.5 5Z"
            fill="#ffffff"
          />
        </svg>
      );
    case "backpack":
      return (
        <svg viewBox="0 0 32 32" className="h-[72%] w-[72%]" aria-hidden="true">
          <path
            d="M12.5 7.5a3.5 3.5 0 0 1 7 0V9h-7V7.5ZM9 10h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3Z"
            fill="#ffffff"
          />
          <rect x="10.5" y="16" width="11" height="3.2" rx="1.2" fill="#e33e3f" />
        </svg>
      );
    case "ledger":
      return (
        <svg viewBox="0 0 32 32" className="h-[68%] w-[68%]" fill="none" aria-hidden="true">
          <path d="M7 13V7h6M19 7h6v6M25 19v6h-6M7 19v6h10V13H7" stroke="#ffffff" strokeWidth="2.6" />
        </svg>
      );
    case "rainbow":
      return (
        <svg viewBox="0 0 32 32" className="h-[74%] w-[74%]" fill="none" aria-hidden="true">
          <path d="M7 23a9 9 0 0 1 18 0" stroke="#ff494a" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M10 23a6 6 0 0 1 12 0" stroke="#ffb800" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M13 23a3 3 0 0 1 6 0" stroke="#3898ff" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      );
  }
}

export function Web3WalletBadge({
  wallet,
  className = "h-9 w-9 rounded-xl",
}: {
  wallet: Web3Wallet;
  className?: string;
}) {
  return (
    <span
      className={`${className} relative grid shrink-0 place-items-center overflow-hidden text-[10px] font-bold text-white shadow-sm`}
      style={{ backgroundColor: wallet.color }}
      title={wallet.name}
    >
      <Web3WalletSvg id={wallet.id} />
    </span>
  );
}

export default function CryptoLogo({
  symbol,
  name,
  wallet,
  logo,
  className = "h-9 w-9",
}: Props) {
  const [failed, setFailed] = useState(false);
  const resolvedWallet = detectWeb3Wallet(name, symbol, wallet);

  if (resolvedWallet) {
    return (
      <Web3WalletBadge
        wallet={resolvedWallet}
        className={`${className} rounded-xl`}
      />
    );
  }

  const ticker = symbol.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const initials = (symbol || name || "?").slice(0, 4).toUpperCase();
  // DeBank's artwork already matches the token the scanner saw; CoinCap is the
  // ticker-based fallback.
  const imageUrl = logo || (ticker ? `https://assets.coincap.io/assets/icons/${ticker}@2x.png` : "");

  return (
    <span
      className={`${className} relative grid shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-[10px] font-bold text-white`}
      title={name || symbol}
    >
      {initials}
      {imageUrl && !failed && (
        // DeBank and CoinCap both expose public token icons; no API key is needed.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={`${name || symbol} logo`}
          className="crypto-logo-image absolute inset-0 h-full w-full bg-white object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
