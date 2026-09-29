import Link from "next/link";
import type { Role } from "@/lib/auth/roles";
import { LogoMark } from "./logo";
import { PersonaSwitcher, type PersonaOption } from "./persona-switcher";
import { ProviderBadge, type RoutingSummary } from "./provider-badge";

export interface HeaderProps {
  /** shop_profile.name, e.g. "Ridgeline Precision" (always shown with "(fictional)"). */
  shopName: string;
  personas: PersonaOption[];
  active: { personaId: string; displayName: string; role: Role };
  canSwitch: boolean;
  /** Optional: defaults to getRoutingSummary(getEnv()) inside ProviderBadge. */
  summary?: RoutingSummary;
}

/**
 * App header (PLAN.md §9): wordmark, shop name, provider badge and persona switcher.
 * One sticky row from 640 px (fixed height = --app-header-h). On phones it has two rows (so nothing scrolls
 * sideways) and scrolls away with the page; the bottom tab bar stays.
 */
export function Header({ shopName, personas, active, canSwitch, summary }: HeaderProps) {
  return (
    <header className="relative z-40 border-b bg-surface sm:sticky sm:top-0 print:hidden">
      <div className="mx-auto flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 sm:h-(--app-header-h) sm:flex-nowrap sm:py-0">
        <Link
          href="/risk"
          className="flex min-h-tap shrink-0 items-center gap-2.5 rounded-md pr-1"
          aria-label={`Floorwise (demo), ${shopName} (fictional): go to Knowledge Risk`}
        >
          <LogoMark />
          <span className="flex flex-col leading-tight">
            <span className="text-lg font-semibold tracking-tight text-ink">Floorwise</span>
            <span className="hidden text-sm text-muted-foreground xl:block">{shopName} (fictional)</span>
          </span>
        </Link>

        {/* Phones: persona sits on the first row; the badge wraps to its own row. */}
        <div className="order-2 ml-auto shrink-0 sm:order-3 sm:ml-0">
          <PersonaSwitcher personas={personas} active={active} canSwitch={canSwitch} />
        </div>

        <div className="order-3 flex w-full min-w-0 items-center sm:order-2 sm:ml-auto sm:w-auto sm:flex-1 sm:justify-end">
          <ProviderBadge summary={summary} className="max-w-full" />
        </div>
      </div>
    </header>
  );
}
