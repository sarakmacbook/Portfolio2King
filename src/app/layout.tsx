import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ledgerly — Portfolio Manager",
  description: "Track cash, stocks and crypto holdings with manual input.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <header className="bg-gradient-to-br from-indigo-700 via-indigo-600 to-violet-600">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2 text-white">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 text-lg ring-1 ring-white/25">◆</span>
              <span className="text-lg font-semibold tracking-tight">Ledgerly</span>
            </Link>
            <Nav />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 text-center text-xs text-slate-400 sm:px-6">
          All values entered manually · Amounts in USD
        </footer>
      </body>
    </html>
  );
}
