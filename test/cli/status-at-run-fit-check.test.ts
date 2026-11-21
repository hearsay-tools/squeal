import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseAt } from "../../src/cli/status-at.js";
import type { SideState } from "../../src/cli/status-at-report.js";
import { runLines } from "../../src/cli/status-at-report-run.js";
import type { RunAnswer } from "../../src/cli/status-at-run-child.js";
import { clearlyOver, measuredOver } from "../../src/cli/status-at-run-fit.js";
import { runBatches } from "../../src/cli/status-at-run-loop.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { fixture, git, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { check, clean, run, withStore } from "./status-at-kit.js";

/*
 * Row 023-34 (T1, lessons round 5; spec 023 D4.11): when the selection
 * clearly cannot fit, `--run` stops and says how to narrow or force it:
 * before it runs from stored durations, or (review wave-20 B4) after a
 * measured first batch when none is stored. In round 5, 1,338 files ran on neither side in
 * time and about 1,300 stayed queued in the agent's daemon. `--timeout`
 * or `--all-missing` runs what fits, as before.
 */

const estimate = (files: number, seconds: number | null, width = 11) =>
  ({ runner: "vitest", files, seconds, known: seconds === null ? 0 : files, width }) as const;

describe("clearlyOver and measuredOver (T1, review wave-20 B4)", () => {
  it("before a run: only R4's estimate from stored durations above the cap", () => {
    // Stored durations: 79 min is over the 600 s cap; 200 s fits it.
    expect(clearlyOver(estimate(1338, 79 * 60), 20_000)).toBe(true);
    expect(clearlyOver(estimate(40, 200), 20_000)).toBe(false);
    // B4: no stored duration tells nothing before a run, however many files.
    expect(clearlyOver(estimate(1338, null), 20_000)).toBe(false);
    expect(clearlyOver(estimate(16, null, 1), 0)).toBe(false);
    expect(clearlyOver(estimate(0, null), 0)).toBe(false);
  });

  it("after the first batch: the files left at its rate, over the cap", () => {
    // Round 5, s2: about 11 files in 20 s, 2,665 left on both sides: hours.
    expect(measuredOver(20_000, 11, 20_000, 2665)).toBe(true);
    // Round 5, s1: 111 at the commit, 112 now; 14 s overhead and 11 in 20 s: 400 s.
    expect(measuredOver(14_000, 11, 20_000, 212)).toBe(false);
    // The B4 witness: one file a batch in about 0.6 s, 31 left.
    expect(measuredOver(2_000, 1, 600, 31)).toBe(false);
    // No file ended (a setup failed): nothing is known, the run goes on.
    expect(measuredOver(20_000, 0, 20_000, 2665)).toBe(false);
    expect(measuredOver(20_000, 11, null, 2665)).toBe(false);
  });

  it("applies only when the call gave neither --timeout nor --all-missing", () => {
    expect(parseAt(["--at", "a", "--run"])).toMatchObject({ run: { fitCheck: true } });
    const timeout = parseAt(["--at", "a", "--run", "--timeout", "300"]);
    const all = parseAt(["--at", "a", "--run", "--all-missing"]);
    for (const args of [timeout, all])
      expect(typeof args !== "string" && args.run?.fitCheck).toBeUndefined();
  });
});

describe("runBatches' goOn (B4)", () => {
  it("stops after the batch it says no to; the files not started read not run (budget)", async () => {
    const files = Array.from({ length: 5 }, (_, i) => ref(`test/f${i}.test.ts`));
    const states = new Map<string, SideState>();
    const ran: string[][] = [];
    const told: number[] = [];
    await runBatches({
      files,
      refOf: (f) => f,
      policy: DEFAULT_POLICY,
      timeoutSeconds: 300,
      batchFiles: 2,
      endMs: performance.now() + 60_000,
      secondsOf: () => null,
      run: async (batch) => {
        ran.push([...batch.paths]);
        return { error: "unused" } as RunAnswer;
      },
      readBack: async () => {},
      stateOf: (f) => states.get(f.path),
      setState: (f, state) => states.set(f.path, state),
      goOn: (ms) => {
        told.push(ms);
        return false;
      },
    });
    expect(ran).toEqual([["test/f0.test.ts", "test/f1.test.ts"]]);
    expect(told).toHaveLength(1);
  });
});

describe("the refusal's words (T1)", () => {
  const use = (refused: { measured: boolean }, ran: number) => ({
    timeoutSeconds: 300,
    usedMs: 40_000,
    gateMs: ran === 0 ? null : 20_000,
    selected: 1338,
    ran,
    stored: ran,
    notStored: [],
    changed: null,
    changedBy: null,
    notRun: 1338 - ran,
    notComparable: 0,
    timedOut: true,
    estimate: null,
    rerun: null,
    rerunNeeds: {
      seconds: 6000,
      from: refused.measured ? ("rate" as const) : ("durations" as const),
    },
    refused: { force: "squeal status --at HEAD~1 --run --timeout 300", ...refused },
  });

  it("after a measured first batch: what ran, R4's rate line and the forcing call", () => {
    expect(runLines(use({ measured: true }, 11), "d8abcfe46")).toEqual([
      "--run stopped after its first batch: 11 of the 1338 test files with no result at d8abcfe46 ran in its checkout, 11 stored; at the rate it measured, the rest clearly do not fit the 300 s budget",
      "1327 not run (budget); at this run's rate they need about 100 min; name test files or folders to narrow it",
      "To run what fits anyway: squeal status --at HEAD~1 --run --timeout 300; `--all-missing` runs every file with no result",
    ]);
  });

  it("from stored durations: nothing ran", () => {
    expect(runLines(use({ measured: false }, 0), "d8abcfe46")[0]).toBe(
      "--run ran nothing: the 1338 test files with no result at d8abcfe46 clearly do not fit the 300 s budget",
    );
  });
});

const A = ref("test/a.test.ts");
const B = ref("test/b.test.ts");

/** A test that marks in `marks` that it ran. */
const marking = (marks: string, name: string, value: number) =>
  [
    'import { writeFileSync } from "node:fs";',
    'import { expect, it } from "vitest";',
    'import { value } from "../src/a";',
    `it("value", () => { writeFileSync(${JSON.stringify(join(marks, name))}, ""); expect(value).toBe(${value}); });`,
    "",
  ].join("\n");

function longFix() {
  const marks = mkdtempSync(join(tmpdir(), "squeal-t1-"));
  const f = fixture({
    "squeal.config.json": "{}\n",
    "src/a.ts": "export const value = 1;\n",
    [A.path]: marking(marks, "a", 1),
    [B.path]: marking(marks, "b", 1),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", [A.path]: marking(marks, "a", 2) });
  f.commit({ [B.path]: marking(marks, "b", 2) });
  // 900 s each, stored: R4's estimate is above the cap.
  withStore(f, (store) =>
    store.results.putMany(
      [A, B].map((file) => ({ ...result(check(file.path), "elsewhere"), durationMs: 900_000 })),
    ),
  );
  return { f, a, marks };
}

describe("a selection that cannot fit runs nothing (T1)", SLOW, () => {
  it("prints R4's line and the forcing call, runs neither side; --timeout runs it", async () => {
    const { f, a, marks } = longFix();
    try {
      const at = a.slice(0, 9);
      const guard = { allMissing: false, timeoutSeconds: 300, fitCheck: true } as const;
      const refused = await run(f, { commit: a, run: guard });
      expect(refused.out, refused.err).toContain(
        `--run ran nothing: the 2 test files with no result at ${at} clearly do not fit the 300 s budget\n`,
      );
      expect(refused.out).toMatch(/from their stored durations they need about \d+ min/);
      expect(refused.out).toContain(
        `To run what fits anyway: squeal status --at ${a} --run --timeout 300; \`--all-missing\` runs every file with no result\n`,
      );
      expect(existsSync(join(marks, "a")) || existsSync(join(marks, "b"))).toBe(false);
      expect(refused.code).toBe(3);
      clean(f);

      const forced = await run(f, { commit: a, run: { allMissing: false, timeoutSeconds: 300 } });
      expect(forced.out, forced.err).not.toContain("ran nothing");
      expect(existsSync(join(marks, "a")) && existsSync(join(marks, "b"))).toBe(true);
      clean(f);
    } finally {
      rmSync(marks, { recursive: true, force: true });
    }
  });
});
