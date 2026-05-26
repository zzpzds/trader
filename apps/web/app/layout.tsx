import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Trader — Strategy Management & Monitoring",
  description: "Strategy injection, position tracking, and daily monitoring platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh" className={`${geistSans.variable} h-full`}>
      <body className="h-full flex bg-background text-foreground antialiased">
        <Sidebar className="hidden md:flex" />
        <main className="flex-1 overflow-y-auto pb-14 md:pb-0">{children}</main>
        <MobileNav />
      </body>
    </html>
  );
}
