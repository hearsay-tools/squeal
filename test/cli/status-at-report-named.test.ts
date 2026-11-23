import { describe, expect, it } from "vitest";
import {
  type AtReport,
  compareSides,
  formatAt,
  type SideState,
  stateOf,
} from "../../src/cli/status-at-report.js";
import { fileLines, NAMED_SHOWN } from "../../src/cli/status-at-report-files.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { result } from "../store/helpers.js";

/*
 * Row 023-59 (dogfood round 7, W2): 4 s1 sessions reported
 * `lint-ast-grep-1.test.ts` and others as still running, while their later
 * narrowed call counted them in "9 unchanged" without naming them. A
 * narrowed call names each of its files with both sides, unchanged ones
 * included, up to `NAMED_SHOWN`, then the rest by group with a count.
 */

const OWN = "own-worktree-id1";
const DAY = 86_400_000;
const NOW = 100 * DAY;
const ref = (path: string): TestFileRef => ({ project: "", path });
const pass: SideState = stateOf(
  "k1",
  [result({ kind: "file", project: "", testPath: "x" }, "k1", { worktreeId: OWN })],
  OWN,
);
const running: SideState = { state: "no result", key: "k2", pending: "running" };

function report(refs: readonly TestFileRef[], now: (r: TestFileRef) => SideState): AtReport {
  return {
    commit: "d8abcfe46bbe0e0a",
    commitTimeMs: NOW - DAY,
    head: "8be977ad6aaaaaaa",
    dirty: false,
    now: { kind: "daemon", revision: 3 },
    checkoutMs: null,
    failure: null,
    files: compareSides(refs, () => pass, now),
    scope: {
      paths: ["packages/cezar/src/lint"],
      files: refs.length,
      selects: 13,
      command: "squeal status --at d8abcfe46",
    },
  };
}

const lint = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ref(`lint/l${String(i + from).padStart(2, "0")}.test.ts`));

describe("a narrowed call names its files (row 023-59, W2)", () => {
  it("names each unchanged file beside the ones still running", () => {
    const done = lint(9);
    const still = lint(2, 9);
    const ids = new Set(still.map((r) => r.path));
    const text = formatAt(
      report([...done, ...still], (r) => (ids.has(r.path) ? running : pass)),
      NOW,
    );
    for (const r of done)
      expect(text).toContain(
        `${r.path}: pass -> pass (at d8abcfe46: run in this worktree; now: run in this worktree)\n`,
      );
    for (const r of still) expect(text).toContain(`${r.path}: pass -> no result (running)`);
    expect(text).toContain(
      "0 pass -> fail, 0 fail -> pass, 9 unchanged, 2 unknown, of 11 named test files",
    );
    // The unchanged come before the unknown.
    expect(text.indexOf("l08.test.ts")).toBeLessThan(text.indexOf("l09.test.ts"));
  });

  it("names the first 20, then counts the rest by group", () => {
    const refs = lint(25);
    const text = formatAt(
      report(refs, () => pass),
      NOW,
    );
    const named = text.split("\n").filter((line) => line.endsWith("now: run in this worktree)"));
    expect(named).toHaveLength(NAMED_SHOWN);
    expect(text).toContain(
      "5 more test files: pass -> pass (at d8abcfe46: run in this worktree; now: run in this worktree): lint/l20.test.ts, lint/l21.test.ts, lint/l22.test.ts and 2 more\n",
    );
    expect(text).toContain("`--full` lists every file");
    // A call without paths keeps counting the unchanged files.
    const { scope: _, ...wideReport } = report(refs, () => pass);
    const wide = formatAt(wideReport, NOW);
    expect(wide).not.toContain("l00.test.ts");
  });

  it("names each not-selected file the commit cannot change, with its state now (review 0.1.607 B3)", () => {
    // Five files under a named folder: no result at the commit, not selected, closure complete.
    const fixed: SideState = {
      state: "no result",
      key: "k3",
      notSelected: true,
      closure: "complete",
    };
    const refs = lint(5);
    const states = [running, pass, running, { state: "no result", key: "k4" } as const, pass];
    const now = (r: TestFileRef) => states[refs.indexOf(r)] as SideState;
    const files = compareSides(refs, () => fixed, now);
    const { lines, folded } = fileLines(files, "c", false, true);
    const cannot =
      "no result at c, not selected by the change: none of its inputs differs between c and the working tree, so this commit cannot change its result; now";
    // Larger groups of one state first; within a size, the files' own order.
    expect(lines).toEqual([
      `lint/l00.test.ts: ${cannot} no result (running)`,
      `lint/l01.test.ts: ${cannot} pass (now: run in this worktree)`,
      `lint/l02.test.ts: ${cannot} no result (running)`,
      `lint/l04.test.ts: ${cannot} pass (now: run in this worktree)`,
      `lint/l03.test.ts: ${cannot} no result`,
    ]);
    expect(folded).toBe(false);
    // A wide call keeps T2's one grouped line.
    const wide = fileLines(files, "c", false, false).lines;
    expect(wide).toHaveLength(1);
    expect(wide[0]).toMatch(/^5 test files not selected: none of their inputs differs/);
  });

  it("shares the 20-file limit between ordinary and not-selected files (review 0.1.607 B3)", () => {
    const fixed: SideState = {
      state: "no result",
      key: "k3",
      notSelected: true,
      closure: "complete",
    };
    const plain = lint(18);
    const cut = lint(5, 18);
    const ids = new Set(cut.map((r) => r.path));
    const at = (r: TestFileRef) => (ids.has(r.path) ? fixed : pass);
    const files = compareSides([...plain, ...cut], at, () => running);
    const { lines, folded } = fileLines(files, "c", false, true);
    expect(lines).toHaveLength(NAMED_SHOWN + 1);
    expect(lines.slice(0, 18).every((l) => l.includes("pass -> no result (running)"))).toBe(true);
    expect(lines[18]).toMatch(/^lint\/l18\.test\.ts: no result at c, not selected by the change/);
    expect(lines[19]).toMatch(/^lint\/l19\.test\.ts: no result at c, not selected by the change/);
    expect(lines[20]).toBe(
      "3 more test files: no result at c, not selected by the change: none of their inputs differs between c and the working tree, so this commit cannot change their result; now no result (running): lint/l20.test.ts, lint/l21.test.ts, lint/l22.test.ts\n".trimEnd(),
    );
    expect(folded).toBe(true);
  });
});
