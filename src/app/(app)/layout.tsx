import type { ReactNode } from "react";
import { BottomTabBar, SideNav } from "@/components/app/nav";
import { FictionalBanner } from "@/components/app/fictional-banner";
import { Header } from "@/components/app/header";
import { Toaster } from "@/components/ui/sonner";
import { can } from "@/lib/auth/roles";
import { getEnv } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { getRoutingSummary } from "@/lib/policy/summary";
import { getActor, listPersonas } from "@/server/actor";
import { getShellInfo } from "@/server/queries/shell";

/**
 * App shell (PLAN.md §9): fictional banner · header (wordmark, shop, provider badge, persona switcher) ·
 * sidebar (icon rail below 1200 px, bottom tab bar below 640 px) · toaster.
 * Server Component: reading the persona cookie makes every page under it dynamic.
 */
export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const [shell, actor, personas] = await Promise.all([getShellInfo(), getActor(), listPersonas()]);
  const env = getEnv();
  const summary = getRoutingSummary(env);
  const canSwitch = can(actor.role, "switchPersona", { demoOpenControls: env.DEMO_OPEN_CONTROLS });

  return (
    <div className="flex min-h-dvh flex-col print:block print:min-h-0">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-4 py-3 font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to main content
      </a>
      <FictionalBanner notice={shell.fictionalNotice} demoDate={formatDate(shell.demoToday)} />
      <Header
        shopName={shell.shopName}
        personas={personas}
        active={{ personaId: actor.personaId, displayName: actor.displayName, role: actor.role }}
        canSwitch={canSwitch}
        summary={summary}
      />
      <div className="flex min-w-0 flex-1">
        <SideNav />
        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 pt-6 pb-[calc(var(--app-tabbar-h)+env(safe-area-inset-bottom)+1.5rem)] outline-none sm:px-6 sm:pb-10 print:p-0"
        >
          {children}
        </main>
      </div>
      <BottomTabBar />
      <Toaster position="top-center" />
    </div>
  );
}
