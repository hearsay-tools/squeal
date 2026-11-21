import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAt } from "../../src/cli/status-at.js";
import { runLines } from "../../src/cli/status-at-report-run.js";
import { clearlyOver, roundsHold } from "../../src/cli/status-at-run-fit.js";
import { fixture, git, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { check, clean, run, withStore } from "./status-at-kit.js";

/*
 * Row 023-34 (T1, lessons round 5; spec 023 D4.11): when the selection
 * clearly cannot fit, `--run` runs nothing on either side and says how to
 * narrow or force it. In round 5, 1,338 files ran on neither side in
 * time and about 1,300 stayed queued in the agent's daemon. `--timeout`
 * or `--all-missing` runs what fits, as before.
 */

const estimate = (files: number, seconds: number | null, width = 11) =>
  ({ runner: "vitest", files, seconds, known: seconds === null ? 0 : files, width }) as const;

describe("clearlyOver (T1)", () => {
  it("is R4's estimate above the cap, or more files with no duration than the budget's rounds hold", () => {
    // Round 5, s2: 1,338 files, no stored duration, width 11, 300 s: 15 rounds hold 165.
    expect(clearlyOver(estimate(1338, null), 20_000, 300)).toBe(true);
    expect(clearlyOver(estimate(165, null), 20_000, 300)).toBe(false);
    expect(clearlyOver(estimate(166, null), 20_000, 300)).toBe(true);
    // Round 5, s1: 111 files in squawk ran and answered.
    expect(clearlyOver(estimate(111, null), 20_000, 300)).toBe(false);
    // A budget under one round still holds one round.
    expect(clearlyOver(estimate(11, null), 0, 5)).toBe(false);
    // Stored durations: 79 min is over the 600 s cap; 200 s fits it.
    expect(clearlyOver(estimate(1338, 79 * 60), 20_000, 300)).toBe(true);
    expect(clearlyOver(estimate(40, 200), 20_000, 300)).toBe(false);
    expect(clearlyOver(estimate(0, null), 0, 300)).toBe(false);
  });

  it("applies only when the call gave neither --timeout nor --all-missing", () => {
    expect(parseAt(["--at", "a", "--run"])).toMatchObject({ run: { fitCheck: true } });
    const timeout = parseAt(["--at", "a", "--run", "--timeout", "300"]);
    const all = parseAt(["--at", "a", "--run", "--all-missing"]);
    for (const args of [timeout, all])
      expect(typeof args !== "string" && args.run?.fitCheck).toBeUndefined();
  });
});

describe("the refusal's words with no stored duration (T1)", () => {
  it("say about how many files fit here, then R4's line and the forcing call", () => {
    expect(roundsHold(11, 300)).toBe(165);
    const lines = runLines(
      {
        timeoutSeconds: 300,
        usedMs: 20_000,
        gateMs: null,
        selected: 1338,
        ran: 0,
        stored: 0,
        notStored: [],
        changed: null,
        changedBy: null,
        notRun: 1338,
        notComparable: 0,
        timedOut: true,
        estimate: null,
        rerun: null,
        rerunNeeds: { seconds: null, from: "durations" },
        refused: { force: "squeal status --at HEAD~1 --run --timeout 300", fits: 165 },
      },
      "d8abcfe46",
    );
    expect(lines).toEqual([
      "--run ran nothing: the 1338 test files with no result at d8abcfe46 clearly do not fit the 300 s budget (with no stored duration, about 165 fit in 300 s here)",
      "1338 not run (budget); no file ended in this run and none has a stored duration, so the time they need is unknown; name test files or folders to narrow it",
      "To run what fits anyway: squeal status --at HEAD~1 --run --timeout 300; `--all-missing` runs every file with no result",
    ]);
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
