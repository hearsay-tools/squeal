import { describe, expect, it } from "vitest";
import { nextStep } from "../../src/core/status/next-step.js";
import { timeText } from "../../src/core/text.js";
import type { LastYield, Standing } from "../../src/core/types/index.js";

/*
 * Row 011-209 (`research/issue-91.md` F2 to F4, spec 011 C15): every line
 * form a running, queued or unlisted file gets from its daemon's `yields`
 * row, as `tasks/011-209/notes.md` lists them. Times print as the host's
 * clock reads them, so the expected lines read them the same way.
 */
const START = Date.UTC(2026, 9, 26, 14, 15, 46);
const CUT = START + 1_000;
const T = timeText;

const LAST: LastYield = {
  at: CUT,
  runId: "r1",
  to: "promoted",
  rule: "remainder",
  remainderMs: 199_000,
  lane: "vitest",
  files: [1, 2, 3, 4].map((i) => ({ project: "", path: `test/s${i}.test.ts` })),
  runStartedAt: START,
  runEndedAt: START + 2_000,
};

const running = (more: Partial<Extract<Standing, { kind: "running" }>> = {}): Standing => ({
  kind: "running",
  lane: "vitest",
  since: START + 2_000,
  files: 4,
  ...more,
});

describe("the lines of a yield kept, a tier's ended files and the run an unlisted revision waits for (row 011-209)", () => {
  it("F4: a several-file tier says how many of its files ended, once the runner named one", () => {
    expect(nextStep(running({ ended: 1 })).reason).toBe(
      `in the vitest tier of 4 test files running since ${T(START + 2_000)}, 1 of them ended`,
    );
    expect(nextStep(running()).reason).toBe(
      `in the vitest tier of 4 test files running since ${T(START + 2_000)}`,
    );
    // A run of its own names no count.
    expect(nextStep(running({ files: 1, ended: 1 })).reason).toBe(
      `running since ${T(START + 2_000)} in the vitest lane`,
    );
  });

  it("F2: the restarted tier names the yield, and the verdict line leaves it out", () => {
    const next = nextStep(running({ lastYield: LAST }));
    expect(next.reason).toBe(
      `in the vitest tier of 4 test files running since ${T(START + 2_000)}; a yield at ${T(CUT)} cut 4 files after 2 s of their run (to a promoted file; estimated remainder 199 s, over 30 s)`,
    );
    expect(next.short).toBe(`in the vitest tier of 4 test files running since ${T(START + 2_000)}`);
    expect(next.step).toEqual({
      kind: "none",
      text: "no command runs {it} sooner (a running tier is not interrupted)",
    });
  });

  it("F2: what the yield ran sooner, its rule, one file, and a run that is still stopping", () => {
    const kept = (last: Partial<LastYield>) =>
      /a yield at .*$/.exec(nextStep(running({ lastYield: { ...LAST, ...last } })).reason)?.[0];
    expect(kept({ to: "edit", rule: "overrun", remainderMs: -31_000 })).toBe(
      `a yield at ${T(CUT)} cut 4 files after 2 s of their run (to an edit's work; 30 s past its estimate)`,
    );
    expect(kept({ to: "runner", files: [{ project: "", path: "a.test.ts" }] })).toBe(
      `a yield at ${T(CUT)} cut 1 file after 2 s of its run (to the runner part; estimated remainder 199 s, over 30 s)`,
    );
    expect(nextStep(running({ lastYield: { ...LAST, runEndedAt: null } })).reason).toMatch(
      new RegExp(
        `; a yield at ${T(CUT)} cut 4 files; their run since ${T(START)} is still stopping \\(to a promoted file; estimated remainder 199 s, over 30 s\\)$`,
      ),
    );
  });

  it("F3: a queued line names the yield after the tier's reason", () => {
    const queued: Standing = {
      kind: "queued",
      lane: "vitest",
      behind: START + 2_000,
      files: 4,
      promoted: true,
      yields: { kind: "cut" },
      lastYield: LAST,
    };
    const next = nextStep(queued);
    expect(next.reason).toBe(
      `queued, promoted, behind the vitest tier of 4 test files running since ${T(START + 2_000)}; the tier does not yield: it holds a file a yield already cut at its key; a yield at ${T(CUT)} cut 4 files after 2 s of their run (to a promoted file; estimated remainder 199 s, over 30 s)`,
    );
    expect(next.short).not.toMatch(/a yield at/);
    expect(next.step).toEqual({
      kind: "none",
      text: "no command runs {it} sooner (a running tier that does not yield is waited for)",
    });
  });

  it("rule C: the first tier a daemon started in a lane says no earlier yield is kept, in a named wait only", () => {
    const first = running({ yieldsSince: START - 6_000 });
    expect(nextStep(first).reason).toBe(
      `in the vitest tier of 4 test files running since ${T(START + 2_000)}; no yield kept since the daemon started at ${T(START - 6_000)}`,
    );
    expect(nextStep(first, { named: false }).reason).toBe(
      `in the vitest tier of 4 test files running since ${T(START + 2_000)}`,
    );
  });

  it("an unlisted revision's line names the run its runner part waits for", () => {
    const unlisted = (run?: Extract<Standing, { kind: "unlisted" }>["run"]) =>
      nextStep({ kind: "unlisted", revision: 5, callBoundMs: 666_000, ...(run ? { run } : {}) })
        .reason;
    expect(unlisted({ lane: "vitest", since: START, files: 4, ended: 1 })).toBe(
      `revision 5 not listed yet, because the runner part waits for the run in flight (the vitest tier of 4 test files running since ${T(START)}, 1 of them ended), each of its calls bounded at 666 s`,
    );
    expect(unlisted({ lane: "vitest", since: START, files: 1 })).toBe(
      `revision 5 not listed yet, because the runner part waits for the run in flight (running since ${T(START)} in the vitest lane), each of its calls bounded at 666 s`,
    );
    // None open in the file's lane: the line as before.
    expect(unlisted()).toBe(
      "revision 5 not listed yet, because the runner part waits for the run in flight, each of its calls bounded at 666 s",
    );
  });
});
