/**
 * Parsing helpers for seed-data/ files: YAML (with file:line errors), the expertise CSV and Markdown documents
 * with frontmatter. Pure: callers pass file text in; nothing here touches the filesystem.
 */
import { createHash } from "node:crypto";
import { LineCounter, parseDocument } from "yaml";
import type { z } from "zod";

export type IssueSeverity = "error" | "warning";

/** One problem found in seed-data/, phrased for a non-programmer. Never contains secrets. */
export interface SeedIssue {
  severity: IssueSeverity;
  /** Path relative to seed-data/, forward slashes. */
  file: string;
  line?: number;
  message: string;
  /** Short machine-friendly category, e.g. "schema", "fk", "traceability", "demo_invariant". */
  code: string;
}

/** All seed-data text files, keyed by path relative to seed-data/ (forward slashes), already normalized. */
export type SeedSources = Record<string, string>;

/** CRLF → LF, strip a UTF-8 BOM, Unicode NFC (so a Windows checkout never shifts offsets or hashes). */
export function normalizeText(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").normalize("NFC");
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** JSON with sorted object keys and no whitespace — the input to every seed hash. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export class IssueList {
  readonly items: SeedIssue[] = [];
  error(file: string, message: string, code: string, line?: number): void {
    this.items.push({ severity: "error", file, message, code, ...(line ? { line } : {}) });
  }
  warn(file: string, message: string, code: string, line?: number): void {
    this.items.push({ severity: "warning", file, message, code, ...(line ? { line } : {}) });
  }
  get errorCount(): number {
    return this.items.filter((i) => i.severity === "error").length;
  }
}

/** A parsed YAML document plus a way to find the line of any value by its path. */
export interface YamlDoc {
  value: unknown;
  lineOf(path: readonly (string | number)[]): number | undefined;
}

/** Parses YAML text; reports syntax errors with their line. `lineOffset` shifts lines (for frontmatter). */
export function parseYaml(file: string, text: string, issues: IssueList, lineOffset = 0): YamlDoc | null {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false, uniqueKeys: true });
  if (doc.errors.length > 0) {
    for (const e of doc.errors) {
      const line = e.linePos?.[0]?.line ?? lineCounter.linePos(e.pos[0]).line;
      issues.error(file, `This file isn't valid YAML: ${firstLine(e.message)}`, "yaml", line ? line + lineOffset : undefined);
    }
    return null;
  }
  const lineOf = (path: readonly (string | number)[]): number | undefined => {
    // Walk up to the deepest existing node (a missing key reports its parent's line).
    for (let depth = path.length; depth >= 0; depth--) {
      const node = doc.getIn(path.slice(0, depth), true) as { range?: [number, number, number] } | undefined;
      if (node && Array.isArray(node.range)) return lineCounter.linePos(node.range[0]).line + lineOffset;
    }
    return undefined;
  };
  return { value: doc.toJS({ maxAliasCount: 50 }), lineOf };
}

function firstLine(message: string): string {
  return message.split("\n")[0].replace(/ at line \d+, column \d+:?$/, "");
}

/** Validates a parsed value with a zod schema and reports every problem with its line. */
export function validate<S extends z.ZodType>(
  file: string,
  doc: YamlDoc,
  schema: S,
  issues: IssueList,
  value: unknown = doc.value,
  basePath: (string | number)[] = [],
): z.infer<S> | null {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    const path = [...basePath, ...(issue.path as (string | number)[])];
    issues.error(file, `${describePath(path)}: ${friendlyZodMessage(issue)}`, "schema", doc.lineOf(path));
  }
  return null;
}

/** "item 3 › evidence › item 1 › quote" — 1-based, readable path. */
export function describePath(path: readonly (string | number)[]): string {
  if (path.length === 0) return "File";
  return path.map((p) => (typeof p === "number" ? `item ${p + 1}` : p)).join(" › ");
}

function friendlyZodMessage(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return /received undefined$/.test(issue.message)
        ? `required field is missing (expected ${issue.expected})`
        : `expected ${issue.expected}`;
    case "invalid_value":
      return `must be one of: ${issue.values.map(String).join(", ")}`;
    case "unrecognized_keys":
      return `unknown field(s): ${issue.keys.join(", ")} (check the spelling)`;
    default:
      return issue.message;
  }
}

// ---------------------------------------------------------------------------------------------
// Markdown with frontmatter
// ---------------------------------------------------------------------------------------------

export interface FrontmatterDoc {
  frontmatter: YamlDoc;
  /** Everything after the closing `---`. */
  body: string;
  /** 1-based line number of the first body line. */
  bodyStartLine: number;
}

export function parseFrontmatter(file: string, text: string, issues: IssueList): FrontmatterDoc | null {
  const lines = text.split("\n");
  if (lines[0] !== "---") {
    issues.error(file, "Markdown files must start with a line containing only --- (the frontmatter block).", "frontmatter", 1);
    return null;
  }
  const end = lines.indexOf("---", 1);
  if (end < 0) {
    issues.error(file, "The frontmatter block is never closed: add a line containing only --- after it.", "frontmatter", 1);
    return null;
  }
  const fm = parseYaml(file, lines.slice(1, end).join("\n"), issues, 1);
  if (!fm) return null;
  return { frontmatter: fm, body: lines.slice(end + 1).join("\n"), bodyStartLine: end + 2 };
}

export interface ParsedTurn {
  n: number;
  speaker: "interviewer" | "expert" | "system";
  phase: string | null;
  move: string | null;
  text: string;
  line: number;
}

const TURN_HEADING = /^## T(\d{3}) (interviewer|expert|system)(?: \(([a-z_]+)\))?(?: \[([A-Z_]+)\])?$/;

/** Parses "## T001 interviewer (scope) [SCOPE]" turns. Turn numbers must run 1, 2, 3, … */
export function parseTranscript(file: string, body: string, bodyStartLine: number, issues: IssueList): ParsedTurn[] {
  const turns: ParsedTurn[] = [];
  let current: ParsedTurn | null = null;
  const buf: string[] = [];
  const flush = () => {
    if (current) {
      current.text = buf.join("\n").trim().replace(/\n{3,}/g, "\n\n");
      if (current.text === "") issues.error(file, `Turn T${pad3(current.n)} has no text.`, "transcript", current.line);
      turns.push(current);
    }
    buf.length = 0;
  };
  body.split("\n").forEach((line, i) => {
    const lineNo = bodyStartLine + i;
    if (line.startsWith("## ")) {
      const m = TURN_HEADING.exec(line.trimEnd());
      if (!m) {
        issues.error(
          file,
          `Turn heading "${line.slice(0, 60)}" isn't in the form "## T001 expert" or "## T002 interviewer (phase) [MOVE]".`,
          "transcript",
          lineNo,
        );
        return;
      }
      flush();
      current = { n: Number(m[1]), speaker: m[2] as ParsedTurn["speaker"], phase: m[3] ?? null, move: m[4] ?? null, text: "", line: lineNo };
      if (current.n !== turns.length + 1) {
        issues.error(file, `Turn T${m[1]} is out of order: expected T${pad3(turns.length + 1)}.`, "transcript", lineNo);
      }
      return;
    }
    if (current) buf.push(line);
    else if (line.trim() !== "") issues.error(file, "Text before the first turn heading (## T001 …).", "transcript", lineNo);
  });
  flush();
  return turns;
}

export interface ParsedDocSection {
  key: string;
  title: string;
  line: number;
  items: { text: string; cardIds: string[]; line: number }[];
  table?: { columns: string[]; rows: string[][] };
}

const CITATION = /\s*\[((?:KC-\d{3})(?:\s*,\s*KC-\d{3})*)\]\s*$/;

/**
 * Parses a setup-sheet body: "## Section" headings, "- item text [KC-002, KC-034]" bullet items and optional
 * Markdown tables. Section keys are the lowercased heading's first word (e.g. "## Workholding" → workholding).
 */
export function parseDocSections(body: string, bodyStartLine: number): ParsedDocSection[] {
  const sections: ParsedDocSection[] = [];
  let current: ParsedDocSection | null = null;
  body.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    const lineNo = bodyStartLine + i;
    if (line.startsWith("## ")) {
      const title = line.slice(3).trim();
      current = { key: title.toLowerCase().split(/[^a-z]+/)[0] ?? "", title, line: lineNo, items: [] };
      sections.push(current);
      return;
    }
    if (!current) return;
    if (line.startsWith("- ")) {
      const m = CITATION.exec(line);
      const text = (m ? line.slice(2, m.index) : line.slice(2)).trim();
      const cardIds = m ? m[1].split(",").map((s) => s.trim()) : [];
      current.items.push({ text, cardIds, line: lineNo });
      return;
    }
    if (line.startsWith("|")) {
      const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{3,}:?$/.test(c))) return; // separator row
      if (!current.table) current.table = { columns: cells, rows: [] };
      else current.table.rows.push(cells);
    }
  });
  return sections;
}

// ---------------------------------------------------------------------------------------------
// Expertise matrix CSV
// ---------------------------------------------------------------------------------------------

export interface MatrixCsv {
  personIds: string[];
  rows: { topicId: string; levels: number[]; line: number }[];
}

/**
 * Parses expertise-matrix.csv: header `topic_id,topic_label,PER-01 Ray Delgado,…`, one row per topic, levels 0–3.
 * Tolerates a BOM (already stripped by normalizeText), `;` separators (European Excel) and quoted labels.
 */
export function parseMatrixCsv(file: string, text: string, issues: IssueList): MatrixCsv | null {
  const lines = text.split("\n");
  const header = lines[0] ?? "";
  const sep = header.includes(";") && !header.includes(",") ? ";" : ",";
  const cols = splitCsvLine(header, sep);
  if (cols[0] !== "topic_id" || cols[1] !== "topic_label") {
    issues.error(file, 'The first row must start with "topic_id,topic_label" followed by one column per person.', "csv", 1);
    return null;
  }
  const personIds: string[] = [];
  for (const c of cols.slice(2)) {
    const m = /^(PER-\d{2})\b/.exec(c);
    if (!m) {
      issues.error(file, `Column "${c}" must start with a person ID like PER-01.`, "csv", 1);
      return null;
    }
    personIds.push(m[1]);
  }
  const rows: MatrixCsv["rows"] = [];
  lines.slice(1).forEach((raw, i) => {
    const lineNo = i + 2;
    if (raw.trim() === "") return;
    const cells = splitCsvLine(raw, sep);
    if (cells.length !== cols.length) {
      issues.error(file, `Row has ${cells.length} values but the header has ${cols.length}.`, "csv", lineNo);
      return;
    }
    const levels = cells.slice(2).map((v) => (v.trim() === "" ? 0 : Number(v)));
    levels.forEach((lv, j) => {
      if (!Number.isInteger(lv) || lv < 0 || lv > 3) {
        issues.error(file, `Level for ${personIds[j]} on ${cells[0]} must be 0, 1, 2 or 3 (found "${cells[j + 2]}").`, "csv", lineNo);
      }
    });
    rows.push({ topicId: cells[0].trim(), levels, line: lineNo });
  });
  return { personIds, rows };
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export function pad3(n: number): string {
  return String(n).padStart(3, "0");
}
