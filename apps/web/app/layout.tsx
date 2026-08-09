import type { Metadata } from "next";
import { Kantumruy_Pro } from "next/font/google";
import Script from "next/script";
import "./globals.css";

// Applies the persisted (or system-default) theme to <html> before
// hydration/paint, so there's no flash of the wrong theme. Must run
// beforeInteractive - by the time React hydrates ThemeToggle, this has
// already set the class it reads. Keep the storage key in sync with
// components/theme-toggle.tsx.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('second-brain:theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

// SF Pro itself isn't licensed for general web embedding, so it's not
// loaded as a webfont here - globals.css pulls it in via the standard
// -apple-system/BlinkMacSystemFont system-font stack instead, which
// resolves to real SF Pro on Apple devices. Kantumruy Pro (Khmer + Latin)
// is the one actual webfont, used both directly and as the fallback for
// Khmer glyphs the system stack can't render.
const kantumruyPro = Kantumruy_Pro({
  variable: "--font-kantumruy-pro",
  subsets: ["khmer", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Agentic Second Brain",
  description: "Capture everything. Let the agents organize it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${kantumruyPro.variable} h-full antialiased`}
      // The beforeInteractive theme-init script below adds/removes "dark"
      // on this element before hydration runs, on purpose (that's what
      // avoids a flash of the wrong theme) - React can't know that ahead
      // of time, so it flags the class mismatch. This is the standard,
      // documented mitigation for exactly this pattern, not a real bug.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        {children}
      </body>
    </html>
  );
}
