"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { setPersona } from "@/app/actions/persona";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABEL, type Role } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

export interface PersonaOption {
  id: string;
  label: string;
  role: Role;
}

export interface PersonaSwitcherProps {
  /** listPersonas(): show_in_switcher personas in sort order. */
  personas: PersonaOption[];
  /** The active persona (from getActor()). */
  active: { personaId: string; displayName: string; role: Role };
  /** can(actor.role, "switchPersona", …). When false the active persona is shown without a menu. */
  canSwitch?: boolean;
}

const ROLE_ORDER: Role[] = ["owner", "quoter", "machinist", "trainee"];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

function ActiveIdentity({ displayName, role, pending }: { displayName: string; role: Role; pending: boolean }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-semibold text-paper"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : initials(displayName) || <UserRound className="size-4" />}
      </span>
      <span className="flex min-w-0 flex-col items-start leading-tight">
        <span className="hidden max-w-40 truncate text-sm font-semibold text-ink md:block">{displayName}</span>
        <span className="text-sm text-muted-foreground">
          <span className="sr-only md:hidden">{displayName}, </span>
          {ROLE_LABEL[role]}
        </span>
      </span>
    </>
  );
}

/** "Act as…" persona menu (PLAN.md §4.8), grouped by role. The server re-reads the role from the DB. */
export function PersonaSwitcher({ personas, active, canSwitch = true }: PersonaSwitcherProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!canSwitch || personas.length === 0) {
    return (
      <div className="flex min-h-tap items-center gap-2 px-1">
        <ActiveIdentity displayName={active.displayName} role={active.role} pending={false} />
      </div>
    );
  }

  const groups = ROLE_ORDER.map((role) => ({ role, items: personas.filter((p) => p.role === role) })).filter(
    (g) => g.items.length > 0,
  );

  function choose(personaId: string) {
    if (personaId === active.personaId) return;
    startTransition(async () => {
      try {
        await setPersona(personaId);
        router.refresh();
      } catch {
        // Never surface raw error text (CLAUDE.md hard rule 2).
        toast.error("Couldn't switch persona. Try again.");
      }
    });
  }

  // modal={false}: a modal Radix menu sets aria-hidden on the rest of the page while its links stay focusable,
  // which axe flags (aria-hidden-focus). Non-modal keeps keyboard navigation and closes on an outside click.
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={`Persona: ${active.displayName}, ${ROLE_LABEL[active.role]}. Switch persona`}
        aria-busy={pending || undefined}
        className={cn(
          "flex min-h-tap max-w-full items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-left transition-colors",
          "hover:border-hairline hover:bg-surface data-[state=open]:border-hairline data-[state=open]:bg-surface",
        )}
      >
        <ActiveIdentity displayName={active.displayName} role={active.role} pending={pending} />
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={16} className="w-72 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="text-sm font-semibold text-ink">Act as…</DropdownMenuLabel>
        {groups.map((g, i) => (
          <div key={g.role}>
            {i > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel aria-hidden="true" className="pt-2 pb-1 text-sm font-medium text-muted-foreground">
              {ROLE_LABEL[g.role]}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup aria-label={ROLE_LABEL[g.role]} value={active.personaId} onValueChange={choose}>
              {g.items.map((p) => (
                <DropdownMenuRadioItem key={p.id} value={p.id} disabled={pending} className="text-base">
                  {p.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
