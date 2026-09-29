/**
 * Error and not-found boundaries render the safe copy (CLAUDE.md hard rules 2 and 10): the fictional banner
 * outside the shell, the digest, never error.message.
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AppError from "@/app/(app)/error";
import RecordNotFound from "@/app/(app)/not-found";
import RootError from "@/app/error";

const PAYLOAD = "canary-payload: Ray's quote for CUS-01 was [[AMOUNT_ab12]]";

function boom(digest?: string): Error & { digest?: string } {
  const e = new Error(PAYLOAD) as Error & { digest?: string };
  if (digest) e.digest = digest;
  return e;
}

describe("error boundaries", () => {
  it("the root boundary (shell failures) shows the banner, heading, digest and ways out, never the message", () => {
    const markup = renderToStaticMarkup(h(RootError, { error: boom("3141592653"), retry: () => {} }));
    expect(markup).toContain("data-fictional-banner");
    expect(markup).toContain("Something went wrong");
    expect(markup).toContain("Reference: 3141592653");
    expect(markup).toContain("Try again");
    expect(markup).toContain('href="/risk"');
    expect(markup).not.toContain("canary");
    expect(markup).not.toContain("AMOUNT");
    expect((markup.match(/<h1\b/g) ?? []).length).toBe(1);
  });

  it("the in-shell boundary shows the same copy without a second banner, and no digest line when there is none", () => {
    const markup = renderToStaticMarkup(h(AppError, { error: boom(), retry: () => {} }));
    expect(markup).toContain("Something went wrong");
    expect(markup).not.toContain("data-fictional-banner");
    expect(markup).not.toContain("Reference:");
    expect(markup).not.toContain("canary");
  });
});

describe("in-shell not-found", () => {
  it("names the problem and links to every list", () => {
    const markup = renderToStaticMarkup(h(RecordNotFound));
    expect(markup).toContain("Record not found");
    expect(markup).toContain("(fictional)");
    for (const href of ["/library", "/jobs", "/people", "/machines", "/risk"]) expect(markup).toContain(`href="${href}"`);
    expect(markup).not.toContain("data-fictional-banner");
  });
});
