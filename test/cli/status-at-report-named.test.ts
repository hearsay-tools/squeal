import { describe, expect, it } from "vitest";
import {
  type AtReport,
  compareSides,
  formatAt,
  type SideState,
  stateOf,
} from "../../src/cli/status-at-report.js";
import { NAMED_SHOWN } from "../../src/cli/status-at-report-files.js";
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
    const wide = formatAt({ ...report(refs, () => pass), scope: undefined }, NOW);
    expect(wide).not.toContain("l00.test.ts");
  });
});
