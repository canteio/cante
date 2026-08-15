import type { Metadata } from "next";
import { EB_Garamond, Inter } from "next/font/google";
import "./globals.css";

// Mike's pairing: Inter for UI chrome, EB Garamond for anything that reads as
// a document — here, the alert body the customer actually receives.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const garamond = EB_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "Cante",
  description: "Indonesia export compliance monitor",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${garamond.variable}`}>
      <body>{children}</body>
    </html>
  );
}
