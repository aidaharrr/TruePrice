import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { PaywallProvider } from "@/components/paywall-modal";
import { AccountProvider } from "@/components/account/account-provider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TruePrice — Can you trust that Amazon listing?",
  description:
    "Paste an Amazon link. TruePrice traces the factory listing behind dropshipped products, detects AI-altered imagery and flags keyword-stuffed titles.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="flex min-h-dvh flex-col antialiased">
        <AccountProvider>
          <PaywallProvider>
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </PaywallProvider>
        </AccountProvider>
      </body>
    </html>
  );
}
