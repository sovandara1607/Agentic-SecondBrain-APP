import type { Metadata } from "next";
import { Kantumruy_Pro } from "next/font/google";
import "./globals.css";

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
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
