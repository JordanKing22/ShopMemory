"use client";

import { ErrorFallback } from "@/components/app/error-fallback";
import { FictionalBanner } from "@/components/app/fictional-banner";
import { LogoMark } from "@/components/app/logo";

/**
 * Root-segment error boundary. (app)/error.tsx doesn't wrap (app)/layout.tsx (Next 16 error.js docs), so shell
 * failures (DB not seeded or locked, bad configuration) land here. It still renders inside the root layout
 * (fonts, globals.css, light theme), carries its own fictional banner (CLAUDE.md hard rule 10: never removable)
 * and, like every boundary, never shows or logs error.message (hard rule 2).
 */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <FictionalBanner />
      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start justify-center gap-4 px-4 py-12">
        <LogoMark />
        <ErrorFallback digest={error.digest} retry={retry} homeLink />
      </main>
    </div>
  );
}
