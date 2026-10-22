import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import BackgroundRefresh from "@/components/BackgroundRefresh";
import Nav from "@/components/Nav";
import ThemeToggle from "@/components/ThemeToggle";
import { bootScript } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ledgerly — Portfolio Manager",
  description: "Track cash, stocks and crypto holdings with manual input.",
  applicationName: "Ledgerly",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Ledgerly", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.png", apple: "/apple-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#4f46e5" },
    { media: "(prefers-color-scheme: dark)", color: "#111827" },
  ],
};

const themeScript = bootScript();

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <header className="site-header bg-gradient-to-br from-indigo-700 via-indigo-600 to-violet-600">
          <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
            <Link href="/" className="flex shrink-0 items-center gap-2 text-white" aria-label="Ledgerly dashboard">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 text-lg ring-1 ring-white/25">◆</span>
              <span className="hidden text-lg font-semibold tracking-tight min-[390px]:inline">Ledgerly</span>
            </Link>
            <div className="flex min-w-0 items-center gap-2">
              <Nav />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <BackgroundRefresh />
        <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))] text-center text-xs text-slate-400 sm:px-6">
          All values entered manually · Amounts in USD ·{" "}
          <Link href="/alerts" className="hover:text-slate-600 hover:underline">
            Price alerts
          </Link>
        </footer>
      </body>
    </html>
  );
}
