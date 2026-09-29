import { cn } from "@/lib/utils";

/** The Floorwise mark: a stepped, machined "F" profile on the primary blue. Decorative. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="7" fill="#1D4ED8" />
      <path d="M8 24V8h16v5h-10v3h7v4h-7v4z" fill="#FFFFFF" />
      <rect x="22" y="20" width="4" height="4" rx="1" fill="#F26B1D" />
    </svg>
  );
}
