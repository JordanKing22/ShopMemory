import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  IssueList,
  canonicalJson,
  normalizeText,
  parseDocSections,
  parseFrontmatter,
  parseMatrixCsv,
  parseTranscript,
  parseYaml,
  validate,
} from "@/lib/seed/source";

describe("seed source parsing", () => {
  it("normalizes CRLF, BOM and Unicode to LF + NFC", () => {
    expect(normalizeText("﻿a\r\nb\rc")).toBe("a\nb\nc");
    expect(normalizeText("Tomás")).toBe("Tomás");
  });

  it("canonical JSON sorts keys at every level", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}');
  });

  it("reports YAML syntax errors with a line", () => {
    const issues = new IssueList();
    expect(parseYaml("x.yaml", "a: 1\nb: [1,\nc: 2\n", issues)).toBeNull();
    expect(issues.items[0].line).toBeGreaterThan(0);
    expect(issues.items[0].message).toMatch(/isn't valid YAML/);
  });

  it("reports schema errors with a readable path and the line of the value", () => {
    const issues = new IssueList();
    const doc = parseYaml("x.yaml", "# comment\n- id: A\n  n: 1\n- id: B\n  n: two\n", issues)!;
    validate("x.yaml", doc, z.array(z.object({ id: z.string(), n: z.number() })), issues);
    expect(issues.items).toHaveLength(1);
    expect(issues.items[0]).toMatchObject({ file: "x.yaml", line: 5, code: "schema" });
    expect(issues.items[0].message).toBe("item 2 › n: expected number");
  });

  it("says when a required field is missing", () => {
    const issues = new IssueList();
    const doc = parseYaml("x.yaml", "id: A\n", issues)!;
    validate("x.yaml", doc, z.object({ id: z.string(), title: z.string() }), issues);
    expect(issues.items[0].message).toMatch(/title: required field is missing/);
  });

  it("parses frontmatter and transcript turns", () => {
    const issues = new IssueList();
    const text = "---\nid: INT-09\n---\n## T001 interviewer (scope) [SCOPE]\nHello?\n\n## T002 expert\nHi.\nSecond line.\n";
    const fm = parseFrontmatter("t.md", text, issues)!;
    expect(fm.frontmatter.value).toEqual({ id: "INT-09" });
    const turns = parseTranscript("t.md", fm.body, fm.bodyStartLine, issues);
    expect(issues.items).toEqual([]);
    expect(turns).toEqual([
      { n: 1, speaker: "interviewer", phase: "scope", move: "SCOPE", text: "Hello?", line: 4 },
      { n: 2, speaker: "expert", phase: null, move: null, text: "Hi.\nSecond line.", line: 7 },
    ]);
  });

  it("rejects bad or out-of-order turn headings", () => {
    const issues = new IssueList();
    parseTranscript("t.md", "## T001 expert\nA\n## T003 expert\nB\n## Turn 4\nC\n", 1, issues);
    expect(issues.items.map((i) => i.line)).toEqual([3, 5]);
    expect(issues.items[0].message).toMatch(/out of order/);
    expect(issues.items[1].message).toMatch(/isn't in the form/);
  });

  it("parses setup-sheet sections, citations and tables", () => {
    const sections = parseDocSections("## Tools\n| Tool | Use |\n|---|---|\n| T1 | finish |\n- Fresh finisher. [KC-002, KC-021]\n- Plain line.\n## Cautions\n- Watch it. [KC-021]\n", 10);
    expect(sections.map((s) => s.key)).toEqual(["tools", "cautions"]);
    expect(sections[0].table).toEqual({ columns: ["Tool", "Use"], rows: [["T1", "finish"]] });
    expect(sections[0].items).toEqual([
      { text: "Fresh finisher.", cardIds: ["KC-002", "KC-021"], line: 14 },
      { text: "Plain line.", cardIds: [], line: 15 },
    ]);
  });

  it("parses the expertise CSV with ';' separators and blank cells as 0", () => {
    const issues = new IssueList();
    const m = parseMatrixCsv("m.csv", 'topic_id;topic_label;PER-01 Ray;PER-02 Marv\nt-a;"A; label";3;\n', issues)!;
    expect(issues.items).toEqual([]);
    expect(m.personIds).toEqual(["PER-01", "PER-02"]);
    expect(m.rows).toEqual([{ topicId: "t-a", levels: [3, 0], line: 2 }]);
  });

  it("rejects out-of-range levels in the expertise CSV", () => {
    const issues = new IssueList();
    parseMatrixCsv("m.csv", "topic_id,topic_label,PER-01 Ray\nt-a,A,4\n", issues);
    expect(issues.items[0]).toMatchObject({ line: 2, code: "csv" });
  });
});
