import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";

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
        <Sidebar />
        <main className="flex-1 overflow-hidden">{children}</main>
      </body>
    </html>
  );
}
