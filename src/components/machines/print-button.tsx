"use client";

import type { ReactNode } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Opens the browser's print dialog. Screen only: it never appears on the printed page. */
export function PrintButton({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Button
      type="button"
      size="lg"
      onClick={() => window.print()}
      className={cn("min-h-16 px-6 text-base print:hidden", className)}
    >
      <Printer aria-hidden="true" className="size-5" />
      {children}
    </Button>
  );
}
