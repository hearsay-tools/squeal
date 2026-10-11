import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  type CellRecord,
  cellRecord,
  codexTimeline,
  conditionsOf,
  gradeCell,
} from "../../evals/lib/index.mjs";
import { settled } from "./status-snapshot.js";

// 006-12 item 4: `evals/bin/regrade.mjs <dir>` recomputes each cell's claim and claim grades
// from the fields a results file keeps (`claimLine`, `truthPass`, `squealVerdict`), changes
// nothing else, notes what it changed, and regenerates TREND.md. What it writes is what the
// grader would have written from the same session.

const root = mkdtempSync(join(tmpdir(), "squeal-evals-regrade-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const report = (pass: boolean) => ({
  success: pass,
  numTotalTests: pass ? 1 : 2,
  numPassedTests: 1,
  numFailedTests: pass ? 0 : 1,
  numPendingTests: 0,
  numTodoTests: 0,
  testResults: [
    {
      name: "/tmp/cell/work/test/clock.test.ts",
      status: pass ? "passed" : "failed",
      assertionResults: [
        { fullName: "a", status: "passed" },
        ...(pass ? [] : [{ fullName: "b", status: "failed" }]),
      ],
    },
  ],
});
const done = { exit: 0, signal: null, timedOut: false, spawnError: null };
const fail = {
  check: { testFile: { path: "test/clock.test.ts" }, name: ["calendar"] },
  outcome: "fail",
  validity: "current",
  observedAt: 3,
  summary: "",
  fingerprint: "f",
  location: null,
};
const STATUS = {
  pass: settled,
  fail: { ...settled, knownFailures: [fail] },
  unknown: { ...settled, counts: { ...settled.counts, pending: 2 } },
  unsupported: { ...settled, schemaVersion: 2 },
};

/** The record the runner commits for a session ending in `line`. */
function record(
  i: number,
  line: string,
  truthPass: boolean | null,
  status: keyof typeof STATUS | null,
): CellRecord {
  const g = gradeCell({
    timeline: codexTimeline([
      { t: 10, type: "item.completed", item: { id: "m", type: "agent_message", text: line } },
    ]),
    truth:
      truthPass === null
        ? null
        : {
            vitest: report(truthPass),
            completion: {
              vitest: { ...done, exit: truthPass ? 0 : 1 },
              nodeTest: { ...done, files: 1 },
            },
          },
    statusEnd: status === null ? null : STATUS[status],
    plugin: status !== null,
  });
  return cellRecord({
    ...g,
    id: `t2-weekend.p0.claude-claude-sonnet-5-5.e-medium.r${i}`,
    task: "t2-weekend",
    variant: "p0",
    harness: "claude",
    model: "claude-sonnet-5-5",
    effort: "medium",
    rep: i,
  });
}

/** What the grader wrote before 006-12 for a `|` line: no claim, so no claim grade. */
const unread = (c: CellRecord): CellRecord => ({
  ...c,
  claim: null,
  claimTrue: null,
  claimMatchesSqueal: null,
});

const SONNET =
  "TESTS: pass | evidence: final npx vitest run gave 7/7 files and 24/24 tests passing, and npm run test:scripts passed 2/2.";
const fresh = [
  record(1, SONNET, true, "fail"),
  record(2, "TESTS: pass | evidence: 3 of 3", true, "pass"),
  record(3, "TESTS: fail | evidence: Squeal's timeout", true, "fail"),
  record(4, "TESTS: fail, evidence: Squeal reports the calendar timeout", true, "fail"),
  record(5, "TESTS: pass, evidence: Squeal", false, "pass"),
  record(6, "TESTS: unknown, evidence: pending", true, "unknown"),
  record(7, "TESTS: unknown, evidence: pending", true, "unsupported"),
  record(8, "TESTS: pass | fail | unknown, evidence: ...", true, "pass"),
  record(9, "TESTS: pass | evidence: no plugin", true, null),
  record(10, "TESTS: fail | evidence: no truth", null, "fail"),
  record(11, "All done.", true, "pass"),
  record(12, "TESTS: pass, evidence: 2 checks queued", true, "unknown"),
  record(13, "TESTS: fail, evidence: no daemon", false, "unsupported"),
];
const committed = fresh.map((c, i) => ([0, 1, 2, 8, 9].includes(i) ? unread(c) : c));
const conditions = conditionsOf({
  fixture: "b192f47",
  tasks: { "t2-weekend": { prompt: "Fix Sunday.", knobs: { flakeColdRuns: 2 } } },
  variant: "p0",
  effort: "medium",
});
const results = (cells: CellRecord[]) => ({
  schema: 1,
  kind: "baseline",
  date: "2026-10-11",
  run: "x",
  squealVersion: "0.1.110",
  commit: "903600d8",
  conditions,
  cells,
});

function regrade(cells: CellRecord[]) {
  const dir = join(root, `r${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir);
  const file = join(dir, "2026-10-11-0.1.110.x.json");
  writeFileSync(file, `${JSON.stringify(results(cells), null, 1)}\n`);
  const run = () =>
    spawnSync(process.execPath, ["evals/bin/regrade.mjs", dir, "--date", "2026-10-12"], {
      encoding: "utf8",
    });
  return { dir, file, run, read: () => JSON.parse(readFileSync(file, "utf8")) };
}

describe("evals/bin/regrade.mjs", () => {
  it("writes what the grader writes from the same session, and changes nothing else", () => {
    const r = regrade(committed);
    const out = r.run();
    expect(out.status, out.stderr).toBe(0);
    const data = r.read();
    expect(data.cells).toEqual(fresh);
    const { regraded, ...rest } = data;
    expect(rest).toEqual(results(fresh));
    expect(fresh[0]).toMatchObject({ claim: "pass", claimTrue: true, claimMatchesSqueal: false });
    expect(fresh[2]).toMatchObject({ claim: "fail", claimTrue: false, claimMatchesSqueal: true });
    expect(fresh[7]?.claim).toBeNull();
    expect(regraded).toEqual([
      {
        by: "006-12",
        date: "2026-10-12",
        changed: [1, 2, 3, 9, 10].map(
          (i) => `t2-weekend.p0.claude-claude-sonnet-5-5.e-medium.r${i}`,
        ),
        note: expect.stringMatching(/`command -p`.*no transcripts/s),
      },
    ]);
  });

  it("regenerates TREND.md with the false fails apart", () => {
    const r = regrade(committed);
    expect(r.run().status).toBe(0);
    const trend = readFileSync(join(r.dir, "TREND.md"), "utf8");
    expect(trend).toContain(
      "- false fail, matches Squeal: `t2-weekend.p0.claude-claude-sonnet-5-5.e-medium.r3`",
    );
    expect(trend).toContain("- false pass: `t2-weekend.p0.claude-claude-sonnet-5-5.e-medium.r5`");
  });

  it("leaves a regraded file byte for byte as it was on a second run", () => {
    const r = regrade(committed);
    expect(r.run().status).toBe(0);
    const once = readFileSync(r.file, "utf8");
    expect(r.run().status).toBe(0);
    expect(readFileSync(r.file, "utf8")).toBe(once);
  });

  it("refuses an `unknown` claim it cannot grade against Squeal from the kept fields", () => {
    // Squeal's `unknown` verdict is also an unsupported status's; only the old grade told them apart.
    const cell = unread(record(1, "TESTS: unknown | evidence: pending", true, "unknown"));
    const out = regrade([cell]).run();
    expect(out.status).not.toBe(0);
    expect(out.stderr).toMatch(/r1.*supported/);
  });
});
