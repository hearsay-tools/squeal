import { describe, expect, it } from "vitest";
import {
  type CellRecord,
  conditionsOf,
  declarations,
  measuresOf,
  type PilotRecord,
  parserExpectationsOf,
  replayed,
  type Step as Seen,
  squealEvidence,
} from "../../evals/lib/index.mjs";
import { type EndedNamed, namedText } from "../../src/cli/status-wait-lines.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import {
  CLAIM,
  type Harness,
  PENDING,
  REGISTERED,
  STATUS_TEXT,
  type Step,
  session,
  waitAt,
} from "./reference-sessions.js";
import { settled } from "./status-snapshot.js";

// Row 006-55: since 0.1.133 (005-11), `squeal status --wait <ms> <path>...` waits only for the
// test files the paths select. Its first line is the verdict on those files and its second names
// them (`namedLine` in src/cli/status-wait-lines.ts); the whole worktree's status follows. The
// grade credits the selected files, and only them, as the wait's answer. From 011-10 the verdict
// prints last, and from 011-28 after only the revision line and the selection (`short`).

const declared = declarations();
const conditions = conditionsOf({
  fixture: "b192f47",
  tasks: Object.fromEntries(
    Object.entries(declared.tasks).map(([t, knobs]) => [t, { prompt: t, knobs }]),
  ),
  variant: "p0",
  effort: "medium",
});
const grade = (c: CellRecord) => parserExpectationsOf(c, conditions, declared);

const MONEY = "test/money.test.ts";
const REPORT = "test/report.test.ts";
const plural = (n: number) => `${n} test file${n === 1 ? "" : "s"}`;

/** A named wait that settled on `files` at `rev`, `pending` checks of other files queued. */
const named = (rev: number, files: string[], pending = 0): Step => ({
  cmd: `squeal status --wait 60000 ${files.join(" ")}`,
  out: `Named test files at revision ${rev}: no known failures; ${plural(files.length)}, each with a current result, after 3.2 s\nSelected: ${files.join(", ")}\n\n${STATUS_TEXT(rev, { pending })}`,
});
/** A named wait whose deadline came before the daemon's pass reached the edits (review wave-1, B1). */
const unsynced = (results: number, pass: number, files: string[]): Step => ({
  cmd: `squeal status --wait 60000 ${files.join(" ")}`,
  out: `Named test files have no verdict: the deadline passed after 60.0 s: the daemon's pass is at revision ${pass} and results are as of revision ${results}\nSelected: ${files.join(", ")}\n\n${STATUS_TEXT(results)}`,
});
/**
 * Row 011-28 (gh-44): the named wait as `namedText` prints it, the revision line, the selection
 * and last its verdict, `pending` checks of one other test file queued.
 */
const short = (rev: number, files: string[], pending = 0): Step => {
  const other = pending > 0 ? 1 : 0;
  const result: StatusSnapshot = {
    ...settled,
    revision: rev,
    counts: { ...settled.counts, current: 31 - pending, pending },
    testFileCounts: { current: 6 - other, pending: other, stale: 0, unknown: 0 },
    testFilesByPhase: { running: 0, queued: other },
    testsByPhase: { running: 0, queued: pending },
  };
  const refs = files.map((path) => ({ project: "", path }));
  const wait = {
    outcome: "settled",
    waitedMs: 3_200,
    selection: {
      files: refs,
      unmatched: [],
      unmatchedPaths: [],
      paths: refs.map(({ path }) => ({ path, kind: "test-file", selects: 1 })),
    },
    verdict: {
      revision: rev,
      testFiles: files.length,
      byClass: { current: files.length, pending: 0, stale: 0, unknown: 0 },
      unlisted: false,
      failures: { tests: 0, testFiles: 0 },
    },
    files: refs.map((testFile) => ({ testFile, state: "current", verdict: "pass" })),
    sync: { state: "synced", revision: rev, incarnation: null },
    result,
  } as unknown as EndedNamed;
  return { cmd: `squeal status --wait 60000 ${files.join(" ")}`, out: namedText(wait, 0 as never) };
};
const run = (file: string): Step => ({
  cmd: `npx vitest run ${file}`,
  out: ` ✓ ${file} (3 tests) 4ms\n\n Test Files  1 passed (1)\n      Tests  3 passed (3)`,
});

/** T1's cell from its registration: `start` after it, by default the money edit and its delivery. */
const cell = (
  steps: Step[],
  harness: Harness,
  start: Step[] = [{ edit: "src/money.ts" }, { squeal: PENDING(1) }],
) =>
  session("t1-thousands", [{ squeal: REGISTERED(0) }, ...start, ...steps], {
    truthPass: true,
    status: "pass",
    harness,
  });
const t1 = (steps: Step[], harness: Harness, start?: Step[]) => grade(cell(steps, harness, start));
/** D10's measures over the same cell's retained timeline, as the atomic tier scores them. */
const atomic = (steps: Step[], harness: Harness, start?: Step[]) => {
  const c = cell(steps, harness, start);
  return measuresOf({ claim: c.claim } as PilotRecord, {
    timeline: c.timeline as Seen[],
    scenario: { measures: ["no-rerun-answered", "current-before-claim"] },
  });
};

for (const harness of ["codex", "claude"] as const)
  describe(`a claim after a wait on named files, ${harness}`, () => {
    it("re-running a selected file the wait answered misses no-rerun-answered", () => {
      expect(
        t1([named(1, [MONEY], 3), run(MONEY), waitAt(1), CLAIM("pass")], harness),
      ).toMatchObject({ "no-rerun-answered": "missed", "current-before-claim": "met" });
      expect(atomic([named(1, [MONEY], 3), run(MONEY), waitAt(1), CLAIM("pass")], harness)).toEqual(
        { "no-rerun-answered": false, "current-before-claim": true },
      );
    });

    it("running a file the wait did not select is no rerun", () => {
      expect(
        t1([named(1, [MONEY], 3), run(REPORT), waitAt(1), CLAIM("pass")], harness),
      ).toMatchObject({ "no-rerun-answered": "met", "current-before-claim": "met" });
    });

    it("a pass claim on the selected files alone, others pending, is not current", () => {
      expect(t1([named(1, [MONEY], 3), CLAIM("pass")], harness)).toMatchObject({
        "current-before-claim": "missed",
        "no-overclaim": "missed",
      });
    });

    it("a pass claim on a wait whose deadline came before the daemon's pass is not current", () => {
      // Two edits, the first's revision never seen: the status block is at it, clear, and the
      // named line says the second edit's pass is not stored.
      const edits = [{ edit: "src/money.ts" }, { edit: "src/report.ts" }];
      expect(t1([unsynced(1, 2, [REPORT]), CLAIM("pass")], harness, edits)).toMatchObject({
        "current-before-claim": "missed",
        "no-overclaim": "missed",
      });
      expect(atomic([unsynced(1, 2, [REPORT]), CLAIM("pass")], harness, edits)).toMatchObject({
        "current-before-claim": false,
      });
    });

    it("a pass claim once the whole worktree is current meets every expectation", () => {
      const g = t1([named(1, [MONEY]), CLAIM("pass")], harness);
      expect(Object.entries(g ?? {}).filter(([, v]) => v !== "met")).toEqual([]);
    });

    it("grades a short named wait as the long one (row 011-28)", () => {
      expect(
        t1([short(1, [MONEY], 3), run(MONEY), waitAt(1), CLAIM("pass")], harness),
      ).toMatchObject({ "no-rerun-answered": "missed", "current-before-claim": "met" });
      expect(t1([short(1, [MONEY], 3), CLAIM("pass")], harness)).toMatchObject({
        "current-before-claim": "missed",
        "no-overclaim": "missed",
      });
      const g = t1([short(1, [MONEY]), CLAIM("pass")], harness);
      expect(Object.entries(g ?? {}).filter(([, v]) => v !== "met")).toEqual([]);
    });
  });

describe("a named wait's evidence", () => {
  const text = (s: Step) => (s as { out: string }).out;

  it("names the selected files current when they have their verdict, and nothing more", () => {
    expect(squealEvidence(text(named(1, [MONEY, REPORT], 3)), "pull")).toMatchObject({
      revision: 1,
      pending: 3,
      selected: [MONEY, REPORT],
      files: [MONEY, REPORT],
      verdict: "unknown",
    });
  });

  it("names none without a verdict, and counts unstored edits as pending", () => {
    expect(squealEvidence(text(unsynced(1, 2, [REPORT])), "pull")).toMatchObject({
      pending: 1,
      files: [],
      verdict: "unknown",
    });
    const stored = `Named test files have no verdict: the deadline passed after 60.0 s: the daemon has not stored its pass over the edits made before the wait; results are as of revision 1\nSelected: ${REPORT}\n\n${STATUS_TEXT(1)}`;
    expect(squealEvidence(stored, "pull")).toMatchObject({ pending: 1, files: [] });
    const still = `Named test files have no verdict: the deadline passed after 60.0 s: 1 test file still pending at revision 2\nSelected: ${REPORT}\n\n${STATUS_TEXT(2, { pending: 1 })}`;
    expect(squealEvidence(still, "pull")).toMatchObject({ pending: 1, files: [] });
  });

  it("names a selected failure current and failing", () => {
    const check = `${MONEY} > money > formats thousands`;
    const out = `Named test files at revision 2: 1 known failure: 1 test; 1 test file, each with a current result, after 1.1 s\nSelected: ${MONEY}\n  FAIL  ${check}\n        observed at revision 2, current\n\n${STATUS_TEXT(2, { failing: [check], pending: 2 })}`;
    expect(squealEvidence(out, "pull")).toMatchObject({
      files: [MONEY],
      failing: [MONEY],
      failures: 1,
      verdict: "fail",
    });
  });

  it("credits only the files the line names, past an `and N more`", () => {
    const out = `Named test files at revision 1: no known failures; 12 test files, each with a current result, after 2.0 s\nSelected: ${MONEY}, ${REPORT} and 10 more\n\n${STATUS_TEXT(1, { pending: 3 })}`;
    expect(squealEvidence(out, "pull")).toMatchObject({ files: [MONEY, REPORT] });
  });

  it("reads `--json`'s line on stderr beside the snapshot, which carries no counts", () => {
    const line = `Named test files at revision 1: no known failures; 1 test file, each with a current result, after 2.0 s\nSelected: ${MONEY}`;
    expect(squealEvidence(`{\n  "revision": 1\n}\n${line}`, "pull")).toMatchObject({
      revision: 1,
      pending: null,
      files: [MONEY],
      verdict: "unknown",
    });
  });

  it("keeps the selected files through a regrade's replay", () => {
    const step = squealEvidence(text(named(1, [MONEY], 3)), "pull");
    if (step === null) throw new Error("no evidence");
    const { files: _files, ...kept } = step;
    expect(replayed([kept as Seen])[0]).toMatchObject({ files: [MONEY] });
  });
});
