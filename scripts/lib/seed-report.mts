// Prints seed:check results: issues grouped by file (file:line), then the demo invariant tables.
import type { BuildResult } from "@/lib/seed/build";
import { out } from "./out";

export function printIssues(result: BuildResult, opts: { showWarnings?: boolean } = {}): void {
  const errors = result.issues.filter((i) => i.severity === "error");
  const warnings = result.issues.filter((i) => i.severity === "warning");
  const print = (list: typeof result.issues, label: string, write: (s: string) => void) => {
    for (const i of list) write(`  seed-data/${i.file}${i.line ? `:${i.line}` : ""}  ${label}  ${i.message}`);
  };
  if (errors.length) {
    out.error(`\n${errors.length} error${errors.length === 1 ? "" : "s"}:`);
    print(errors, "error", out.error);
  }
  if (warnings.length && opts.showWarnings !== false) {
    out.warn(`\n${warnings.length} warning${warnings.length === 1 ? "" : "s"}:`);
    print(warnings, "warning", out.warn);
  }
}

export function printReport(result: BuildResult): void {
  const inv = result.report.invariants;
  const counts = Object.entries(result.report.counts).map(([k, v]) => `${k} ${v}`);
  if (counts.length) out.line(`\nCounts: ${counts.join(" · ")}`);
  const mix = result.report.classificationMix;
  if (Object.keys(mix).length) {
    out.line("Classification mix (general / internal / customer_confidential / export_controlled):");
    for (const [name, m] of Object.entries(mix)) {
      out.line(`  ${name.padEnd(11)} ${m.general} / ${m.internal} / ${m.customer_confidential} / ${m.export_controlled}`);
    }
  }
  if (!inv) return;
  out.line("Golden coverage numbers:");
  for (const g of inv.golden) {
    out.line(`  ${g.ok ? "ok  " : "FAIL"} ${g.phase.padEnd(6)} ${g.key.padEnd(22)} expected ${g.expected}, got ${g.actual ?? "—"}`);
  }
  out.line(`Single points of failure: ${inv.spofBefore.join(", ") || "none"}`);
  out.line(`Similar jobs for the demo question: ${inv.similarJobs.map((j, i) => `${i + 1}. ${j.id} (${j.score})`).join("  ")}`);
  out.line("Quoted-vs-actual variance (mean |v|):");
  for (const v of inv.variance) out.line(`  ${v.group.padEnd(36)} ${String(v.jobs).padStart(3)} jobs  ${v.meanAbsPct ?? "—"}%`);
  if (inv.varianceRatio !== null) out.line(`  judgment-heavy (not Ray) ÷ routine = ${inv.varianceRatio}× (needs ≥ 2.5×)`);
}
