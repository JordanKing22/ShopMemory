import Link from "next/link";
import { FictionalBanner } from "@/components/app/fictional-banner";
import { LogoMark } from "@/components/app/logo";

/**
 * Root 404 for URLs that match no route. Rendered outside the app shell, so it carries its own fictional banner.
 * A bad record ID on an existing route (notFound() in a page) renders src/app/(app)/not-found.tsx inside the shell.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <FictionalBanner />
      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start justify-center gap-4 px-4 py-12">
        <LogoMark />
        <h1 className="text-2xl font-semibold text-ink">Page not found</h1>
        <p className="text-muted-foreground">This page doesn&apos;t exist in the Floorwise demo.</p>
        <Link
          href="/risk"
          className="inline-flex min-h-tap items-center rounded-md bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90"
        >
          Go to Knowledge Risk
        </Link>
      </main>
    </div>
  );
}
