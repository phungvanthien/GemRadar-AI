import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LanguageProvider } from "@/lib/i18n/context";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GemRadar AI | Crypto Intelligence Dashboard",
  description:
    "AI-powered crypto dashboard with hidden gem scanner, market analytics, and intelligent token analysis.",
  keywords: ["crypto", "AI", "hidden gems", "CoinMarketCap", "trading"],
  openGraph: {
    title: "GemRadar AI",
    description: "Discover hidden crypto gems with AI-powered analysis",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark h-full`} suppressHydrationWarning>
      <body className="min-h-full bg-background font-sans text-foreground antialiased" suppressHydrationWarning>
        <LanguageProvider>
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
