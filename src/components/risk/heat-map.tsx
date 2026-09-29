"use client";

import { Fragment, memo, useCallback, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Hourglass } from "lucide-react";
import { RiskBandChip } from "@/components/app/risk-band-chip";
import { SpofFlag } from "@/components/app/spof-flag";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { RiskCellVM, RiskOverviewVM, RiskPersonVM, RiskTopicVM, TopicCategory } from "@/lib/data/risk";
import { NOT_AVAILABLE, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CellSheetBody } from "./cell-sheet";
import {
  CATEGORY_LABEL,
  LEVEL_SHORT,
  METRICS,
  approvedCardsText,
  cellAriaLabel,
  departureChipWords,
  metricDelta,
  metricValue,
  signedInt,
  signedOneDecimal,
  type RiskMetric,
  type RiskView,
} from "./copy";
import { CountUp, CountUpProvider } from "./count-up";
import { HeatLegend } from "./legend";
import { CELL_RAMP, rampStep, textHex } from "./ramp";
import { hasKeyboardFocusRing, revealCell } from "./reveal";

type Grouping = "risk" | "category";
type CategoryTab = "all" | TopicCategory;

const CATEGORIES: readonly TopicCategory[] = ["process", "machine", "material", "customer"];
const METRIC_KEYS: readonly RiskMetric[] = ["risk", "expertise", "captured"];

/** Cell height: 52 px, or the 44 / 48 px tap height when the viewport is 800 px tall or less (CSS only). */
const CELL_H = "h-13 [@media(max-height:800px)]:h-tap";

const keyOf = (personId: string, topicId: string) => `${personId}|${topicId}`;

interface Section {
  category: TopicCategory | null;
  topics: RiskTopicVM[];
}

/**
 * The Knowledge Risk heat map (PLAN.md §8.1): topics × holders, metric toggle, risk-first or grouped rows, delta mode
 * against the seeded baseline, a tooltip per cell (hover and keyboard focus) and the cell sheet. The table scrolls
 * inside its card; the first column is sticky. Cells use a roving tabindex: Tab enters the grid once, the arrow keys
 * move between cells, Enter opens the sheet. Every keyboard focus on a cell (arrow keys, Tab, focus returning from
 * the sheet) scrolls the table so the cell and its focus ring clear the sticky Topic column (./reveal.ts).
 */
export function RiskHeatMap({ vm, view, countRun }: { vm: RiskOverviewVM; view: RiskView; countRun: number | null }) {
  const [metric, setMetric] = useState<RiskMetric>("risk");
  const [grouping, setGrouping] = useState<Grouping>("risk");
  const [tab, setTab] = useState<CategoryTab>("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<{ personId: string; topicId: string } | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const gridRef = useRef<HTMLTableSectionElement | null>(null);
  const ids = { metric: useId(), grouping: useId() };

  const hasChanges = vm.baseline.hasChanges;
  const effectiveView: RiskView = hasChanges ? view : "now";
  const showDelta = hasChanges && effectiveView === "now";

  const cellIndex = useMemo(() => new Map(vm.cells.map((c) => [keyOf(c.personId, c.topicId), c])), [vm.cells]);
  const topicById = useMemo(() => new Map(vm.topics.map((t) => [t.id, t])), [vm.topics]);
  const personById = useMemo(() => new Map(vm.people.map((p) => [p.id, p])), [vm.people]);
  const riskRank = useMemo(() => new Map(vm.riskFirstOrder.map((id, i) => [id, i])), [vm.riskFirstOrder]);

  const sectionsFor = useCallback(
    (which: CategoryTab | null): Section[] => {
      const byRisk = (list: RiskTopicVM[]) => [...list].sort((a, b) => riskRank.get(a.id)! - riskRank.get(b.id)!);
      if (which === null) return [{ category: null, topics: byRisk(vm.topics) }];
      const cats = which === "all" ? CATEGORIES : [which];
      return cats.map((category) => ({ category, topics: byRisk(vm.topics.filter((t) => t.category === category)) }));
    },
    [vm.topics, riskRank],
  );

  const onOpenCell = useCallback((personId: string, topicId: string, el: HTMLButtonElement) => {
    lastTrigger.current = el;
    setSelected({ personId, topicId });
    setSheetOpen(true);
  }, []);
  const onFocusCell = useCallback((key: string) => setFocusKey(key), []);

  const onGridKeyDown = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLButtonElement) || !target.dataset.cell || !gridRef.current) return;
    const r = Number(target.dataset.row);
    const c = Number(target.dataset.col);
    const all = Array.from(gridRef.current.querySelectorAll<HTMLButtonElement>("button[data-cell]"));
    const pos = (b: HTMLButtonElement) => ({ r: Number(b.dataset.row), c: Number(b.dataset.col) });
    let next: HTMLButtonElement | undefined;
    const sameRow = all.filter((b) => pos(b).r === r);
    switch (e.key) {
      case "ArrowRight":
        next = sameRow.filter((b) => pos(b).c > c).sort((a, b) => pos(a).c - pos(b).c)[0];
        break;
      case "ArrowLeft":
        next = sameRow.filter((b) => pos(b).c < c).sort((a, b) => pos(b).c - pos(a).c)[0];
        break;
      case "ArrowDown":
        next = all.filter((b) => pos(b).c === c && pos(b).r > r).sort((a, b) => pos(a).r - pos(b).r)[0];
        break;
      case "ArrowUp":
        next = all.filter((b) => pos(b).c === c && pos(b).r < r).sort((a, b) => pos(b).r - pos(a).r)[0];
        break;
      case "Home":
        next = sameRow.sort((a, b) => pos(a).c - pos(b).c)[0];
        break;
      case "End":
        next = sameRow.sort((a, b) => pos(b).c - pos(a).c)[0];
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next) {
      next.focus();
      setFocusKey(next.dataset.cell ?? null);
    }
  };

  const renderTable = (sections: Section[]) => {
    // The one tabbable cell: the last focused one if it is on screen, else the first cell of the first row.
    let firstKey: string | null = null;
    const shown = new Set<string>();
    for (const s of sections)
      for (const t of s.topics)
        for (const p of vm.people) {
          const k = keyOf(p.id, t.id);
          if (cellIndex.has(k)) {
            shown.add(k);
            firstKey ??= k;
          }
        }
    const activeKey = focusKey && shown.has(focusKey) ? focusKey : firstKey;
    let rowIndex = 0;

    return (
      // relative: the sr-only spans inside the table are absolutely positioned; without a positioned scroll container
      // they escape its clipping and widen the page.
      <div data-heat-scroll="" className="relative overflow-x-auto rounded-lg border bg-card shadow-xs">
        <table data-testid="risk-heatmap" className="w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">
            Knowledge risk by topic (rows) and person (columns), showing {METRICS[metric].label.toLowerCase()}. Use the arrow keys to move between cells and
            Enter to see why a cell scores what it does.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-20 min-w-28 bg-card px-3 pt-3 pb-2 text-left align-bottom font-medium text-muted-foreground sm:min-w-36">
                Topic
              </th>
              {vm.people.map((p) => (
                <PersonHeader key={p.id} person={p} />
              ))}
              <th scope="col" className="px-2 pt-3 pb-2 text-left align-bottom font-medium whitespace-nowrap text-muted-foreground">
                Coverage
              </th>
              <th scope="col" className="px-2 pt-3 pb-2 text-left align-bottom font-medium whitespace-nowrap text-muted-foreground">
                Topic risk
              </th>
            </tr>
          </thead>
          <tbody
            ref={gridRef}
            onKeyDown={onGridKeyDown}
            onFocus={(e) => {
              // React's onFocus bubbles (focusin): this covers arrow keys, Tab into the roving cell and the sheet's
              // focus return. Keyboard focus only (see hasKeyboardFocusRing). The browser's default focus scroll
              // still handles vertical page scrolling.
              const t = e.target;
              if (t instanceof HTMLButtonElement && t.dataset.cell && hasKeyboardFocusRing(t)) revealCell(t);
            }}
          >
            {sections.map((s) => (
              <Fragment key={s.category ?? "all"}>
                {s.category && sections.length > 1 ? (
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={vm.people.length + 3}
                      className="border-t bg-surface-sunken px-3 py-1.5 text-left text-sm font-semibold text-ink"
                    >
                      <span className="sticky left-3">{CATEGORY_LABEL[s.category]}</span>
                    </th>
                  </tr>
                ) : null}
                {s.topics.map((t) => {
                  const r = rowIndex++;
                  const band = effectiveView === "before" && t.bandBefore ? t.bandBefore : t.band;
                  const risk = effectiveView === "before" && t.riskBefore !== null ? t.riskBefore : t.risk;
                  const spofId = effectiveView === "before" ? t.spofPersonIdBefore : t.spofPersonId;
                  return (
                    <tr key={t.id} data-testid={`risk-row-${t.id}`} data-band={band} data-spof={spofId ? "true" : "false"}>
                      <th scope="row" className="sticky left-0 z-10 max-w-56 min-w-28 border-t bg-card px-3 py-1 text-left font-medium text-ink sm:min-w-36">
                        <TopicLabel topic={t} />
                      </th>
                      {vm.people.map((p, c) => {
                        const k = keyOf(p.id, t.id);
                        const cell = cellIndex.get(k);
                        return (
                          // pl-[5px] on the first data column: its 4 px focus ring would otherwise paint under the sticky Topic column.
                          <td key={p.id} className={cn("border-t border-transparent p-px", c === 0 && "pl-[5px]")}>
                            {cell ? (
                              <HeatCell
                                cell={cell}
                                person={p}
                                topic={t}
                                metric={metric}
                                view={effectiveView}
                                showDelta={showDelta}
                                tabbable={k === activeKey}
                                row={r}
                                col={c}
                                onOpen={onOpenCell}
                                onFocusCell={onFocusCell}
                              />
                            ) : (
                              <span
                                data-testid={`risk-cell-${p.id}-${t.id}`}
                                data-risk="0"
                                data-empty="true"
                                className={cn("flex min-w-14 items-center justify-center rounded-[3px] border border-hairline bg-paper text-muted-foreground", CELL_H)}
                              >
                                <span aria-hidden="true">–</span>
                                <span className="sr-only">{p.fullName}: no recorded expertise</span>
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="border-t px-2 py-1 align-middle">
                        <CoverageCell topic={t} view={effectiveView} showDelta={showDelta} />
                      </td>
                      <td className="border-t px-2 py-1 align-middle">
                        <div className="flex flex-col items-start gap-1">
                          <RiskBandChip band={band} score={risk} size="sm" />
                          {spofId ? <SpofFlag size="sm" /> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="sticky left-0 z-10 border-t-2 bg-card px-3 py-2 text-left font-medium text-ink">
                Deep coverage
                <span className="block text-sm font-normal text-muted-foreground">captured share of level-3 topics</span>
              </th>
              {vm.people.map((p) => (
                <td key={p.id} data-testid={`deep-coverage-${p.id}`} className="border-t-2 px-1 py-2 text-center align-top">
                  <DeepCoverage person={p} view={effectiveView} showDelta={showDelta} />
                </td>
              ))}
              <td colSpan={2} className="border-t-2" />
            </tr>
          </tfoot>
        </table>
      </div>
    );
  };

  const selectedCell = selected ? cellIndex.get(keyOf(selected.personId, selected.topicId)) : undefined;
  const selectedPerson = selected ? personById.get(selected.personId) : undefined;
  const selectedTopic = selected ? topicById.get(selected.topicId) : undefined;
  const backupNames =
    selectedCell && selectedCell.factors.B > 0
      ? vm.cells
          .filter((c) => c.topicId === selectedCell.topicId && c.personId !== selectedCell.personId && c.level === selectedCell.factors.B)
          .map((c) => personById.get(c.personId)?.fullName ?? c.personId)
      : [];

  return (
    <section aria-label="Heat map" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span id={ids.metric} className="sr-only">
          Cells show
        </span>
        <ToggleGroup
          type="single"
          variant="outline"
          value={metric}
          onValueChange={(v) => {
            if ((METRIC_KEYS as readonly string[]).includes(v)) setMetric(v as RiskMetric);
          }}
          aria-labelledby={ids.metric}
          data-testid="risk-metric"
        >
          {METRIC_KEYS.map((m) => (
            <ToggleGroupItem key={m} value={m} data-value={m} data-testid={`risk-metric-${m}`}>
              {METRICS[m].label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <span id={ids.grouping} className="sr-only">
          Row order
        </span>
        <ToggleGroup
          type="single"
          variant="outline"
          value={grouping}
          onValueChange={(v) => {
            if (v === "risk" || v === "category") setGrouping(v);
          }}
          aria-labelledby={ids.grouping}
          data-testid="risk-grouping"
        >
          <ToggleGroupItem value="risk" data-value="risk">
            Highest risk first
          </ToggleGroupItem>
          <ToggleGroupItem value="category" data-value="category">
            By category
          </ToggleGroupItem>
        </ToggleGroup>

        <HeatLegend metric={metric} thresholds={vm.thresholds} className="wide:ml-auto" />
      </div>

      <CountUpProvider run={showDelta ? countRun : null}>
        {grouping === "risk" ? (
          renderTable(sectionsFor(null))
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as CategoryTab)} className="gap-3">
            {/* Scrolls sideways on phones; p-1 leaves room for focus rings, overflow-y-hidden stops a stray scrollbar. */}
            <div className="-m-1 max-w-full overflow-x-auto overflow-y-hidden p-1">
              <TabsList data-testid="risk-category-tabs" aria-label="Topic category">
                <TabsTrigger value="all">All ({vm.topics.length})</TabsTrigger>
                {CATEGORIES.map((c) => (
                  <TabsTrigger key={c} value={c}>
                    {CATEGORY_LABEL[c]} ({vm.topics.filter((t) => t.category === c).length})
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            {(["all", ...CATEGORIES] as const).map((c) => (
              <TabsContent key={c} value={c}>
                {tab === c ? renderTable(sectionsFor(c)) : null}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </CountUpProvider>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          data-testid="risk-cell-sheet"
          className="w-full gap-0 overflow-y-auto sm:max-w-md"
          onCloseAutoFocus={(e) => {
            // No SheetTrigger (one sheet serves every cell), so return focus to the cell that opened it.
            if (lastTrigger.current?.isConnected) {
              e.preventDefault();
              lastTrigger.current.focus();
            }
          }}
        >
          {selectedCell && selectedPerson && selectedTopic ? (
            <CellSheetBody
              cell={selectedCell}
              person={selectedPerson}
              topic={selectedTopic}
              cards={vm.cards}
              backupNames={backupNames}
              changed={hasChanges && Boolean(selectedCell.before) && (selectedCell.before!.risk !== selectedCell.risk || selectedCell.before!.capturedPct !== selectedCell.capturedPct)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </section>
  );
}

/** "Titanium (Ti-6Al-4V)": the parenthetical never breaks at its inner hyphens. */
function TopicLabel({ topic }: { topic: RiskTopicVM }) {
  const rest = topic.label.slice(topic.shortLabel.length).trim();
  if (!rest) return <>{topic.label}</>;
  return (
    <>
      {topic.shortLabel} <span className="whitespace-nowrap">{rest}</span>
    </>
  );
}

function PersonHeader({ person }: { person: RiskPersonVM }) {
  const dep = person.departure.hidden ? null : person.departure.value;
  return (
    <th scope="col" className="min-w-16 px-1 pt-3 pb-2 text-center align-bottom font-normal">
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-sm leading-tight font-semibold text-ink">{person.fullName}</span>
        <span className="text-sm text-muted-foreground">{person.tenureLabel}</span>
        {dep ? (
          <span
            data-testid={`retires-chip-${person.id}`}
            className="mt-0.5 inline-flex flex-col items-center rounded-md border border-signal-strong bg-signal-tint px-1.5 py-px text-sm leading-tight whitespace-nowrap text-ink"
          >
            <span className="inline-flex items-center gap-1">
              <Hourglass aria-hidden="true" className="size-3.5 shrink-0 text-signal-strong" />
              {departureChipWords(dep)[0]}
            </span>
            <span>{departureChipWords(dep)[1]}</span>
          </span>
        ) : null}
      </div>
    </th>
  );
}

interface HeatCellProps {
  cell: RiskCellVM;
  person: RiskPersonVM;
  topic: RiskTopicVM;
  metric: RiskMetric;
  view: RiskView;
  showDelta: boolean;
  tabbable: boolean;
  row: number;
  col: number;
  onOpen: (personId: string, topicId: string, el: HTMLButtonElement) => void;
  onFocusCell: (key: string) => void;
}

const HeatCell = memo(function HeatCell({ cell, person, topic, metric, view, showDelta, tabbable, row, col, onOpen, onFocusCell }: HeatCellProps) {
  const value = metricValue(cell, metric, view);
  const delta = showDelta ? metricDelta(cell, metric) : 0;
  const from = delta !== 0 ? metricValue(cell, metric, "before") : value;
  const step = rampStep(value, METRICS[metric].max);
  const k = keyOf(cell.personId, cell.topicId);
  const label = cellAriaLabel({ personName: person.fullName, topicShortLabel: topic.shortLabel, cell, metric, view, showDelta });
  const shownRisk = view === "before" && cell.before ? cell.before.risk : cell.risk;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-cell={k}
          data-row={row}
          data-col={col}
          data-testid={`risk-cell-${cell.personId}-${cell.topicId}`}
          data-risk={shownRisk}
          data-changed={delta !== 0 ? "true" : undefined}
          tabIndex={tabbable ? 0 : -1}
          aria-label={label}
          aria-haspopup="dialog"
          onClick={(e) => onOpen(cell.personId, cell.topicId, e.currentTarget)}
          onFocus={() => onFocusCell(k)}
          className={cn(
            "relative flex w-full min-w-14 items-center justify-center gap-1 rounded-[3px] px-1 text-sm font-semibold tabular-nums transition-[transform,box-shadow] hover:z-[1] hover:scale-[1.06] hover:shadow-md",
            CELL_H,
            delta !== 0 &&
              "ring-2 ring-signal-strong ring-inset after:pointer-events-none after:absolute after:inset-[2px] after:rounded-[2px] after:border after:border-surface after:content-['']",
          )}
          style={{ backgroundColor: step.hex, color: textHex(step) }}
        >
          <span>{delta !== 0 ? <CountUp from={from} to={value} format={(n) => formatNumber(n, 0)} /> : value}</span>
          {delta !== 0 ? <span className="rounded-sm bg-signal px-1 text-sm leading-5 font-semibold text-ink">{signedInt(delta)}</span> : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72 text-left text-pretty">
        <CellTooltip cell={cell} person={person} topic={topic} metric={metric} view={view} delta={delta} />
      </TooltipContent>
    </Tooltip>
  );
});

function CellTooltip({ cell, person, topic, metric, view, delta }: { cell: RiskCellVM; person: RiskPersonVM; topic: RiskTopicVM; metric: RiskMetric; view: RiskView; delta: number }) {
  const risk = view === "before" && cell.before ? cell.before.risk : cell.risk;
  const captured = view === "before" && cell.before ? cell.before.capturedPct : cell.capturedPct;
  let lead: ReactNode;
  if (metric === "risk") lead = `Risk ${risk}`;
  else if (metric === "expertise") lead = `Expertise ${cell.level} · ${LEVEL_SHORT[cell.level]}`;
  else lead = `${formatNumber(captured, 0)} % captured`;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-semibold">
        {lead}
        {delta !== 0 ? ` (${signedInt(delta)} since the last reset)` : ""}
      </span>
      <span>
        {person.fullName} · {topic.shortLabel}
      </span>
      <span>
        Level {cell.level} ({LEVEL_SHORT[cell.level]}) · {formatNumber(captured, 0)} % captured
      </span>
      <span>{approvedCardsText(cell.approvedCardIds.length).replace(/^./, (ch) => ch.toUpperCase())}</span>
      <span>Press Enter or click for the inputs.</span>
    </div>
  );
}

function CoverageCell({ topic, view, showDelta }: { topic: RiskTopicVM; view: RiskView; showDelta: boolean }) {
  const now = topic.coverage;
  const before = topic.coverageBefore;
  const shown = view === "before" && before !== null ? before : now;
  if (shown === null) return <span className="text-muted-foreground">{NOT_AVAILABLE}</span>;
  const delta = showDelta && now !== null && before !== null ? Math.round((now - before) * 10) / 10 : 0;
  return (
    <div className="flex min-w-20 flex-col gap-1" data-testid={`coverage-${topic.id}`}>
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="font-semibold tabular-nums text-ink">
          {delta !== 0 && before !== null ? <CountUp from={before} to={shown} decimals={1} format={(n) => formatNumber(n, 1)} /> : formatNumber(shown, 1)}
        </span>
        {delta !== 0 ? <span className="rounded-sm bg-signal px-1 text-sm leading-5 font-semibold text-ink">{signedOneDecimal(delta)}</span> : null}
      </div>
      <div aria-hidden="true" className="h-1.5 w-16 overflow-hidden rounded-full" style={{ backgroundColor: CELL_RAMP[0]!.hex }}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, shown))}%` }} />
      </div>
    </div>
  );
}

function DeepCoverage({ person, view, showDelta }: { person: RiskPersonVM; view: RiskView; showDelta: boolean }) {
  const now = person.deepCoveragePct;
  const before = person.deepCoveragePctBefore;
  const shown = view === "before" && before !== null ? before : now;
  if (shown === null)
    return (
      <span className="text-muted-foreground">
        <span aria-hidden="true">{NOT_AVAILABLE}</span>
        <span className="sr-only">no level-3 topics</span>
      </span>
    );
  const delta = showDelta && now !== null && before !== null ? Math.round((now - before) * 10) / 10 : 0;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="font-semibold whitespace-nowrap tabular-nums text-ink">
        {delta !== 0 && before !== null ? <CountUp from={before} to={shown} decimals={1} format={(n) => `${formatNumber(n, 1)} %`} /> : `${formatNumber(shown, 1)} %`}
      </span>
      {delta !== 0 ? <span className="rounded-sm bg-signal px-1 text-sm leading-5 font-semibold text-ink">{signedOneDecimal(delta)}</span> : null}
    </div>
  );
}
