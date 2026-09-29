"use client";

import { ErrorFallback } from "@/components/app/error-fallback";

/**
 * Error boundary for app pages (inside the shell, so the banner, header and nav stay). Never shows error.message
 * (it could carry payload text; CLAUDE.md hard rule 2) and never logs from the browser. The digest is an opaque
 * hash that matches the server log line. Errors thrown by (app)/layout.tsx itself are caught by src/app/error.tsx.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorFallback digest={error.digest} retry={retry} className="mx-auto py-10" />;
}
