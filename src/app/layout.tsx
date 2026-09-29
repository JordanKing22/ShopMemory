import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const TITLE = "Floorwise (demo) · Ridgeline Precision (fictional)";

export const metadata: Metadata = {
  title: { default: TITLE, template: `%s · ${TITLE}` },
  description: "Floorwise captures machine-shop know-how. Demo software: all data is fictional.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FAFAF7",
  colorScheme: "light",
};

/** Geist and Geist Mono come from the local "geist" package files (variable fonts cover 400/500/600). */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background font-sans text-foreground">
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
