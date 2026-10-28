import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import BackgroundRefresh from "@/components/BackgroundRefresh";
import Nav from "@/components/Nav";
import { PrivacyGate, PrivacyProvider } from "@/components/PrivacyProvider";
import ThemeToggle from "@/components/ThemeToggle";
import { privacyBootScript } from "@/lib/privacy";
import { getServerPrivacyStatus } from "@/lib/privacy-db";
import { bootScript } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "Track cash, stocks and crypto holdings with manual input.",
  applicationName: "Portfolio",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Portfolio",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false, email: false, address: false },
  icons: { icon: "/icon.png", apple: "/apple-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The header carries `env(safe-area-inset-top)` padding, so the web clip can
  // paint under the notch without the status bar sitting on top of the buttons.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#4f46e5" },
    { media: "(prefers-color-scheme: dark)", color: "#111827" },
  ],
};

const themeScript = `${bootScript()}${privacyBootScript()}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const privacy = await getServerPrivacyStatus();
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <PrivacyProvider
          key={`${privacy.hasPin}-${privacy.hasPasskey}-${privacy.locked}-${privacy.hidden}`}
          initialHasPin={privacy.hasPin}
          initialHasPasskey={privacy.hasPasskey}
          initialPasskeys={privacy.passkeys}
          initialLocked={privacy.locked}
          initialHidden={privacy.hidden}
        >
          <header className="site-header sticky top-0 z-40 bg-gradient-to-br from-indigo-700 via-indigo-600 to-violet-600">
            <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-6 sm:py-4">
              <Link
                href="/"
                className="flex shrink-0 items-center gap-2 text-white"
                aria-label="Portfolio dashboard"
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/15 text-lg ring-1 ring-white/25 sm:h-9 sm:w-9">
                  ◆
                </span>
                <span className="hidden text-lg font-semibold tracking-tight min-[390px]:inline">
                  Portfolio
                </span>
              </Link>
              <div className="flex min-w-0 items-center gap-2">
                {!privacy.locked && <Nav />}
                <ThemeToggle />
              </div>
            </div>
          </header>
          {!privacy.locked && <BackgroundRefresh />}
          <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
            <PrivacyGate>{privacy.locked ? null : children}</PrivacyGate>
          </main>
          <footer className="mx-auto max-w-6xl px-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))] text-center text-xs text-slate-400 sm:px-6">
            All values entered manually · Amounts in USD ·{" "}
            <Link href="/alerts" className="hover:text-slate-600 hover:underline">
              Price alerts
            </Link>
          </footer>
        </PrivacyProvider>
      </body>
    </html>
  );
}
