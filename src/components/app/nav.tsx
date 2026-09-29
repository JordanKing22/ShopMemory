"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, ClipboardList, Factory, Grid3x3, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Phase 2 destinations (PLAN.md §9). Later phases add Ask, Interviews, Documents, Training, Audit, Privacy, Settings. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/risk", label: "Risk", icon: Grid3x3 },
  { href: "/library", label: "Library", icon: BookOpen },
  { href: "/people", label: "People", icon: Users },
  { href: "/machines", label: "Machines", icon: Factory },
  { href: "/jobs", label: "Jobs", icon: ClipboardList },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Left navigation: hidden below 640 px (the bottom tab bar takes over), an icon rail with labels under the
 * icons from 640 to 1199 px, and a full sidebar from 1200 px. Labels are always visible (no hover-only text).
 */
export function SideNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav
      aria-label="Main"
      className="sticky top-(--app-header-h) hidden h-[calc(100dvh-var(--app-header-h))] shrink-0 overflow-y-auto border-r bg-sidebar text-sidebar-foreground sm:block sm:w-22 wide:w-52 print:hidden"
    >
      <ul className="flex flex-col gap-1 p-2 wide:p-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-tap flex-col items-center justify-center gap-1 rounded-md px-1 py-2 text-sm font-medium transition-colors",
                  "wide:flex-row wide:justify-start wide:gap-3 wide:px-3",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-ink hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon aria-hidden="true" className="size-5 shrink-0" />
                <span className="leading-tight">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Bottom tab bar below 640 px (PLAN.md §9). Fixed; the main area reserves its height. */
export function BottomTabBar() {
  const pathname = usePathname() ?? "";
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden print:hidden"
    >
      <ul className="grid h-(--app-tabbar-h) grid-cols-5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="min-w-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full min-w-0 flex-col items-center justify-center gap-0.5 text-sm font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-ink",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full",
                    active && "bg-accent",
                  )}
                >
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <span className="max-w-full truncate px-0.5 leading-tight">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
