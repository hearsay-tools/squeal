import { expect } from "vitest";
import { formatCheck } from "../../src/core/state/check-name.js";
import type { StatusSnapshot } from "../../src/core/types/status.js";

/*
 * Spec 001 goals 3 and 5, task scenario 9: what a hook delivered and what
 * `squeal status --json` from the shipped CLI says right after agree. Called
 * only at quiet points, where nothing is pending and no file is changing.
 */

// 001-85: the revision may be followed by "(changed a.ts, b.ts and 2 more)". Review 0.1.379
// S2: the changed paths end at the ")" before ": ", so a path's own ")"
// (`src/app/(auth)/page.tsx`) does not end them; the group captures nothing. Row 005-94: no hook
// names the revision's commit (001-406's "· 1bc146f0 + 3, dirty"); `squeal status` does.
const CHANGED = String.raw`(?: \(changed (?:[^)\n]|\)(?!: ))*\))?`;

/**
 * Row 005-94 (R1, C2): the registration and Stop have a `Revision` line only when it has
 * something to say, the changed paths, a delay or the daemon: `Revision 12 (changed a.ts).`, or
 * `Revision 12: No daemon is running; …`. Then the title names the revision alone.
 */
const REVISION = new RegExp(String.raw`^Revision (\d+)${CHANGED}[.:]`, "m");
const TITLE = /^SQUEAL · .*\brevision (\d+)\b/m;

/**
 * Row 005-94 (R1): the `Known failures` line of the registration and Stop, and the line of the
 * first results in a worktree (row 011-205), count the test files current: `468 of 584 test
 * files are current (run on the files as they are now)`, or `all 484 test files are current (…)`.
 */
const FILES =
  /(?:(\d+) of (\d+)|(?:all )?(\d+)) test files? (?:is|are) current \(run on the files as they are now\)/;

/**
 * 001-407: a change delivery's news header has no checkpoint. Row 011-262: the revision names
 * its changed paths as the full form does. Row 005-93 (c): it counts the test files the
 * consumer's edits affect, `3 of the 9 test files your edits affect have not run.`, or none:
 * the line ends after the changed paths. The worktree's counts stay in status.
 */
const NEWS = new RegExp(
  String.raw`Revision (\d+)${CHANGED}(?:: (?:\d+ of )?the \d+ test files? your edits affect (has run|have all run|has not run|have not run)(?:; \d+ with no result \(unknown\))?)?\.`,
);

/** Check names of the `FAIL  <name>` or `PASS  <name>` blocks of a delivered text. */
export function blocks(text: string, outcome: "FAIL" | "PASS"): string[] {
  return [...text.matchAll(new RegExp(`^${outcome}  (.+)$`, "gm"))].map((m) => m[1] ?? "");
}

/** The revision a delivered header names: its `Revision` line's, else its title's. */
export function headerRevision(text: string): number {
  const match = REVISION.exec(text) ?? TITLE.exec(text);
  if (match === null) throw new Error(`no header line in:\n${text}`);
  return Number(match[1]);
}

export function expectAgrees(text: string | null, status: StatusSnapshot): void {
  if (text === null) throw new Error("nothing was delivered");
  expect(Number(headerRevision(text)), text).toBe(status.revision);
  // Row 005-94: no hook names the commit, the worktree's check counts or the checkpoint.
  expect(text, text).not.toMatch(/^Revision \d+ · /m);
  expect(text, text).not.toMatch(/^Revision \d+[^\n]*: \d+ current\b/m);
  expect(text, text).not.toContain("Full-suite checkpoint");
  // Row 005-94 (R1): the current test files the hook counted. Results that land between the
  // hook and this status read, at the same revision, only add current files, so the hook may
  // count fewer than status, never more; the files listed at that revision do not move.
  const files = FILES.exec(text);
  const counted = status.testFileCounts;
  if (files !== null && counted !== undefined) {
    const total = counted.current + counted.pending + counted.stale + counted.unknown;
    const [current, of] = files[1] === undefined ? [files[3], files[3]] : [files[1], files[2]];
    expect(Number(of), text).toBe(total);
    expect(Number(current), text).toBeLessThanOrEqual(counted.current);
  }
  const news = NEWS.exec(text);
  if (news?.[2] !== undefined) {
    // At a quiet point nothing is pending, so no file the consumer's edits affect is owed.
    const owed = news[2].includes("not run");
    expect(owed, text).toBe(status.counts.pending + status.testFilesWithoutChecks.pending > 0);
  }
  // Row 011-276: a late heartbeat is a down daemon that reads late, not "no daemon".
  expect(
    /No daemon (has validated|is running)|no daemon is running; |[Tt]he daemon's heartbeat is late/.test(
      text,
    ),
    text,
  ).toBe(status.daemon.state === "down");
  const failing = new Set(status.knownFailures.map((f) => formatCheck(f.check)));
  for (const name of blocks(text, "FAIL")) expect(failing, text).toContain(name);
  for (const name of blocks(text, "PASS")) expect(failing, text).not.toContain(name);
  // Spec 011 C6 (gh-34): the line counts the current failures only.
  const known = /^Known failures: (\d+)\b/m.exec(text);
  const current = status.knownFailures.filter((f) => f.validity === "current");
  if (known !== null) expect(Number(known[1]), text).toBe(current.length);
}
