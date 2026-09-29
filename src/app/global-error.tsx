"use client";

import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { ErrorFallback } from "@/components/app/error-fallback";
import { FictionalBanner } from "@/components/app/fictional-banner";
import { LogoMark } from "@/components/app/logo";
import "./globals.css";

/**
 * Last-resort boundary for errors in the root layout itself. It replaces the root layout, so it brings its own
 * <html>/<body>, global styles, fonts and light color scheme (the built-in page follows the OS dark mode), the
 * fictional banner (CLAUDE.md hard rule 10) and the same payload-free copy (hard rule 2: never error.message).
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`} style={{ colorScheme: "light" }}>
      <body className="min-h-full bg-background font-sans text-foreground">
        <title>Something went wrong · Floorwise (demo)</title>
        <div className="flex min-h-dvh flex-col">
          <FictionalBanner />
          <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start justify-center gap-4 px-4 py-12">
            <LogoMark />
            <ErrorFallback digest={error.digest} retry={retry} homeLink />
          </main>
        </div>
      </body>
    </html>
  );
}
