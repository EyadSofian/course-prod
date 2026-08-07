import type { Metadata } from "next";
import { Cairo, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { app } from "@/lib/strings";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["700"],
  variable: "--font-cairo",
  display: "swap",
});

const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: app.name,
  description: `${app.org} — إنتاج الدروس`,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} ${plex.variable}`}>
      <body
        style={
          {
            "--font-display": "var(--font-cairo), system-ui, sans-serif",
            "--font-body": "var(--font-plex), system-ui, sans-serif",
          } as React.CSSProperties
        }
      >
        {children}
      </body>
    </html>
  );
}
