"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorFallbackProps {
  /** Opaque hash that matches the server log line (never the error message). */
  digest?: string;
  /** Next 16 error boundaries pass `retry` (re-fetch and re-render the segment). */
  retry: () => void;
  /** Show a plain link to Knowledge Risk as a second way out (used outside the app shell). */
  homeLink?: boolean;
  className?: string;
}

/**
 * The one "Something went wrong" body shared by every error boundary ((app)/error.tsx, error.tsx,
 * global-error.tsx). CLAUDE.md hard rule 2: it takes only the digest, so error.message (which could carry
 * payload text) can't be rendered, and it never logs from the browser.
 */
export function ErrorFallback({ digest, retry, homeLink = false, className }: ErrorFallbackProps) {
  return (
    <div role="alert" className={cn("flex max-w-xl flex-col items-start gap-4", className)}>
      <div className="flex items-center gap-3">
        <TriangleAlert aria-hidden="true" className="size-6 shrink-0 text-signal-strong" />
        <h1 className="text-2xl font-semibold text-ink">Something went wrong</h1>
      </div>
      <p className="text-muted-foreground">This page couldn&apos;t load. Try again; if it keeps happening, reload the page.</p>
      {digest ? <p className="text-sm text-muted-foreground">Reference: {digest}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => retry()}>
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
        {homeLink ? (
          // A plain <a>: a full navigation still works when the client router is what failed.
          <a
            href="/risk"
            className="inline-flex min-h-tap items-center rounded-md px-3 font-medium text-primary underline underline-offset-4 hover:bg-muted"
          >
            Go to Knowledge Risk
          </a>
        ) : null}
      </div>
    </div>
  );
}
