/**
 * UI-convention regressions (PLAN.md §10, CLAUDE.md "UI conventions") for the shared primitives, checked by
 * server-rendering them and by computing WCAG contrast from the tokens in globals.css. Each case is a bug that
 * review found in the Phase 2 foundation.
 */
import fs from "node:fs";
import path from "node:path";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClassificationBadge } from "@/components/app/classification-badge";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { StatTile } from "@/components/app/stat-tile";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const css = fs.readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
const html = (el: ReactElement) => renderToStaticMarkup(el);

/** The class list of the first element carrying data-slot="<slot>". */
function slotClasses(markup: string, slot: string): string[] {
  const tag = new RegExp(`<[a-z]+[^>]*data-slot="${slot}"[^>]*>`).exec(markup)?.[0] ?? "";
  return (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/).filter(Boolean);
}

function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m?.[1]) throw new Error(`token --${name} not found`);
  return m[1];
}

/** WCAG 2.x relative luminance / contrast ratio. */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** globals.css with every @layer block removed (what's left is unlayered). */
function unlayeredCss(): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf("@layer", i);
    if (at === -1) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, at);
    let j = css.indexOf("{", at);
    let depth = 1;
    while (depth > 0 && ++j < css.length) depth += css[j] === "{" ? 1 : css[j] === "}" ? -1 : 0;
    i = j + 1;
  }
  return out;
}

describe("tabs", () => {
  it("inactive tab labels use muted-foreground (≥ 4.5:1 on the tab list), not ink at 60 %", () => {
    const markup = html(
      h(Tabs, { defaultValue: "a" }, h(TabsList, null, h(TabsTrigger, { value: "a" }, "Risk"), h(TabsTrigger, { value: "b" }, "Expertise"))),
    );
    const classes = slotClasses(markup, "tabs-trigger");
    expect(classes).toContain("text-muted-foreground");
    expect(classes).not.toContain("text-foreground/60");
    // 14 px medium text is not "large": it needs 4.5:1 on the list (bg-muted) and on paper (line variant).
    expect(contrast(token("muted-text"), token("surface-sunken"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("muted-text"), token("paper"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("toggle and toggle group", () => {
  it("the selected state is a primary fill (≥ 3:1 against paper), not a faint accent tint", () => {
    for (const markup of [
      html(h(Toggle, { pressed: true, "aria-label": "Bold" }, "B")),
      html(h(ToggleGroup, { type: "single", value: "risk" }, h(ToggleGroupItem, { value: "risk" }, "Risk"))),
    ]) {
      const classes = [...slotClasses(markup, "toggle"), ...slotClasses(markup, "toggle-group-item")];
      expect(classes).toContain("data-[state=on]:bg-primary");
      expect(classes).toContain("data-[state=on]:text-primary-foreground");
      expect(classes).not.toContain("data-[state=on]:bg-accent");
    }
    expect(contrast(token("primary-blue"), token("paper"))).toBeGreaterThanOrEqual(3);
    expect(contrast("#ffffff", token("primary-blue"))).toBeGreaterThanOrEqual(4.5);
    // The old on-state tint was ~1.1:1 against paper: invisible on a projector.
    expect(contrast(token("accent"), token("paper"))).toBeLessThan(1.5);
  });

  it("hovering an outline toggle can't look selected", () => {
    const classes = slotClasses(html(h(Toggle, { variant: "outline", "aria-label": "x" }, "x")), "toggle");
    expect(classes).not.toContain("hover:bg-accent");
    expect(classes).toContain("hover:bg-muted");
  });

  it("no min-w-* utility overrides the base-layer 44 / 48 px min-width", () => {
    for (const size of ["default", "sm", "lg"] as const) {
      const toggle = slotClasses(html(h(Toggle, { size, "aria-label": "x" }, "x")), "toggle");
      const item = slotClasses(html(h(ToggleGroup, { type: "single", size }, h(ToggleGroupItem, { value: "a" }, "a"))), "toggle-group-item");
      for (const c of [...toggle, ...item]) expect(c, size).not.toMatch(/^min-w-/);
    }
    expect(css).toMatch(/\[data-slot="toggle"\],\s*\[data-slot="toggle-group-item"\]\s*\{\s*min-width: var\(--tap\);/);
  });
});

describe("shared app components", () => {
  it("the classification badge hit area is sized from --tap (44 px, 48 px on coarse pointers)", () => {
    const markup = html(h(ClassificationBadge, { level: "customer_confidential", size: "sm" }));
    const classes = slotClasses(markup, "popover-trigger");
    expect(classes).toContain("before:h-tap");
    expect(classes).toContain("before:top-1/2");
    expect(classes).toContain("before:-translate-y-1/2");
    expect(classes.some((c) => /^before:-inset-y-/.test(c))).toBe(false);
    expect(css).toMatch(/@media \(pointer: coarse\)\s*\{\s*:root\s*\{\s*--tap: 3rem;/);
  });

  it("StatTile's orange rule uses signal-strong (strokes), never the signal fill color", () => {
    const markup = html(h(StatTile, { label: "Topics at risk", value: "4", tone: "signal" }));
    expect(markup).toContain("border-l-signal-strong");
    expect(markup).not.toMatch(/border-l-signal(?!-strong)/);
    expect(contrast(token("signal-strong"), token("surface"))).toBeGreaterThanOrEqual(3);
  });

  it("body copy inherits the body size (16 px, 18 px on coarse pointers) instead of pinning text-base", () => {
    const header = html(h(PageHeader, { title: "Knowledge Risk", description: "Who holds the know-how." }));
    const empty = html(h(EmptyState, { title: "Nothing here", body: "Add one." }));
    expect(header).not.toContain("text-base");
    expect(empty).not.toContain("text-base");
    for (const f of ["src/app/(app)/error.tsx", "src/app/error.tsx", "src/app/not-found.tsx", "src/components/app/error-fallback.tsx"]) {
      expect(fs.readFileSync(path.join(process.cwd(), f), "utf8"), f).not.toMatch(/\btext-base\b/);
    }
    expect(css).toMatch(/@media \(pointer: coarse\)\s*\{\s*body\s*\{\s*font-size: 1\.125rem;/);
  });
});

describe("toasts", () => {
  it("unlayered overrides beat sonner's injected 13 px text and 24 px / 12 px action buttons", () => {
    const plain = unlayeredCss();
    // One attribute more specific than sonner's own selectors, and outside every @layer.
    expect(plain).toMatch(/\[data-sonner-toaster\] \[data-sonner-toast\]\[data-styled="true"\] \{\s*font-size: 0\.875rem;/);
    expect(plain).toMatch(
      /\[data-sonner-toaster\] \[data-sonner-toast\]\[data-styled="true"\] \[data-button\],[^{]*\{\s*min-height: var\(--tap\);\s*height: auto;\s*font-size: 0\.875rem;/,
    );
  });
});
