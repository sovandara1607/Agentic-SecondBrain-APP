import type { Metadata } from "next";
import Script from "next/script";
import { Kantumruy_Pro } from "next/font/google";
import { ToastProvider } from "@/components/toast";
import { LocaleProvider } from "@/lib/i18n/locale-provider";
import "./globals.css";

// Khmer-script coverage for the language switcher (see globals.css's
// --font-khmer) - self-hosted via next/font like every other font in
// this app, subset to just latin+khmer rather than every script Google
// serves for this family to keep the download small.
const kantumruyPro = Kantumruy_Pro({
  subsets: ["khmer", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-kantumruy-pro",
  display: "swap",
});

// Applies the persisted (or system-default) theme to <html> before
// hydration/paint, so there's no flash of the wrong theme. Must run
// beforeInteractive - by the time React hydrates ThemeToggle, this has
// already set the class it reads. Keep the storage key in sync with
// components/theme-toggle.tsx.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('second-brain:theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

// Same reasoning, same pattern, for the language switcher - stamps
// data-locale/lang from localStorage before hydration so the Khmer
// font swap (globals.css's :root[data-locale="km"] rule) and
// lib/i18n/locale-provider.tsx's initial read are both already correct
// by first paint, not applied one render late.
const LOCALE_INIT_SCRIPT = `(function(){try{var l=localStorage.getItem('second-brain:locale')||'en';document.documentElement.setAttribute('data-locale',l);document.documentElement.lang=l;}catch(e){}})();`;

export const metadata: Metadata = {
  title: "Agentic Second Brain",
  description: "Capture everything. Let the agents organize it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${kantumruyPro.variable}`}
      // The beforeInteractive theme-init/locale-init scripts below both
      // mutate this element before hydration runs, on purpose (that's
      // what avoids a flash of the wrong theme/language) - React can't
      // know that ahead of time, so it flags the mismatch. This is the
      // standard, documented mitigation for exactly this pattern, not a
      // real bug.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <Script id="locale-init" strategy="beforeInteractive">
          {LOCALE_INIT_SCRIPT}
        </Script>
        <ToastProvider>
          <LocaleProvider>{children}</LocaleProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
