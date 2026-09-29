"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/** Delta mode counts changed numbers from the baseline to now over this long (PLAN.md §8.1). */
export const COUNT_UP_MS = 900;

const ProgressContext = createContext(1);

/**
 * Drives one shared 0 → 1 progress value for every changed number, so only the <CountUp> consumers re-render per
 * frame. `run` is a counter bumped by the click that enters the "Now" view (never by render); null means "show final
 * values" (first load, or prefers-reduced-motion). Time is measured from the first animation frame of each run, so
 * the click's clock never has to match the frame clock.
 */
export function CountUpProvider({ run, children }: { run: number | null; children: ReactNode }) {
  const [frame, setFrame] = useState<{ run: number; p: number } | null>(null);

  useEffect(() => {
    if (run === null) return;
    let first: number | null = null;
    let raf = requestAnimationFrame(function tick(t) {
      first ??= t;
      const p = Math.min(1, Math.max(0, (t - first) / COUNT_UP_MS));
      setFrame({ run, p });
      if (p < 1) raf = requestAnimationFrame(tick);
    });
    // Frames can be throttled (background tab, busy main thread); always land on the final values.
    const done = setTimeout(() => setFrame({ run, p: 1 }), COUNT_UP_MS + 100);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, [run]);

  // Until the first frame of THIS run arrives, hold the baseline (progress 0) so final values never flash first.
  const progress = run === null ? 1 : frame && frame.run === run ? frame.p : 0;
  return <ProgressContext.Provider value={progress}>{children}</ProgressContext.Provider>;
}

/** ease-out cubic */
function ease(p: number): number {
  return 1 - (1 - p) ** 3;
}

/** A number that counts from `from` to `to` while the surrounding CountUpProvider runs. */
export function CountUp({ from, to, decimals = 0, format }: { from: number; to: number; decimals?: number; format: (n: number) => string }) {
  const p = useContext(ProgressContext);
  const f = 10 ** decimals;
  const value = p >= 1 || from === to ? to : Math.round((from + (to - from) * ease(p)) * f) / f;
  return <>{format(value)}</>;
}

/** True when the user asked the OS for less motion (checked in event handlers only). */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
