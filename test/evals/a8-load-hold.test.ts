import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  atomicConfig,
  type Json,
  pilotRecord,
  regradeAtomic,
  scenarioOf,
  situationOf,
} from "../../evals/lib/index.mjs";
import { cellDirs, type FakeRoot, fakeRoot, removeRoot, runCell } from "./fake-cell.js";
import { CLAIM, graded, type Harness, regradedForms, type Step } from "./reference-sessions.js";
import { HELD_OPENING, runSlowResult, SLOW_SESSIONS } from "./slow-sessions.js";

// 006-54: a8-load-hold. Its knob holds the slow tier for host load once the warm-up has run it,
// and the scenario's measures over sessions graded as a run grades them, in both harnesses
// (slow-sessions.ts), by a new cell's pilot record and by a regrade of what it kept (001-428),
// under `stop.requireSlowSuite` on (policy off: slow-claim.test.ts, 006-91). Since 006-94 its cell
// runs with the policy on (knob `requireSlowSuite`), so `slow-through-squeal` is scored and a8 no
// longer scores what a2 does; a cell is graded under the knobs its run recorded.

const roots: FakeRoot[] = [];
afterEach(() => {
  for (const f of roots.splice(0)) removeRoot(f);
});

describe("the load-hold knob", { timeout: 30_000 }, () => {
  it("commits the slow policy keys and the stop policy after the warm-up, before the session", async () => {
    const f = fakeRoot();
    roots.push(f);
    const r = await runCell(f, ["a8-load-hold", "p0", "claude", "claude-haiku-5-5", "1", "--dry"]);
    expect(r.code, r.output).toBe(0);
    const calls = readFileSync(join(f.log, "squeal"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { args: string[]; slow: Record<string, unknown> });
    const hold = scenarioOf("a8-load-hold")?.knobs.loadHold as Record<string, number>;
    expect(hold).toEqual({ maxLoadPerCpu: 0.0001, maxDeferMs: 600000 });
    // The warm-up ran on the fixture's own policy; the daemon stopped before the keys landed.
    expect(calls.map((c) => c.args.slice(0, 2))).toEqual([
      ["start"],
      ["run", "--all"],
      ["stop", expect.any(String)],
    ]);
    for (const c of calls) expect(c.slow).toEqual({ include: ["test/slow/**"] });
    const [cell] = cellDirs(f);
    if (!cell) throw new Error("no cell");
    const policy = JSON.parse(readFileSync(join(cell, "work/squeal.config.json"), "utf8"));
    expect(policy.slow).toEqual({ include: ["test/slow/**"], ...hold });
    expect(scenarioOf("a8-load-hold")?.knobs.requireSlowSuite).toBe(true);
    expect(policy.stop).toEqual({ requireSlowSuite: true });
    // Committed: the session's `git status` names nothing.
    expect(readFileSync(join(cell, "out/git-status.txt"), "utf8")).toBe("");
    const log = readFileSync(join(cell, "out/runner.log"), "utf8");
    expect(log).toMatch(/load hold: slow \{/);
    expect(log).toMatch(/stop: requireSlowSuite true/);
  });

  it("tells a judge the slow test waits for host load, up to the bound, and is required", () => {
    expect(situationOf(scenarioOf("a8-load-hold")?.knobs)).toBe(
      'after the warm-up, the slow tier\'s load guard holds at any host load (slow.maxLoadPerCpu 0.0001), so after each edit Squeal holds the slow test "waiting for host load to drop" for up to slow.maxDeferMs (600 s); an explicit `squeal run --slow` runs it at once; the repository requires the slow test files before the agent finishes (stop.requireSlowSuite true): Squeal tells the agent to run `squeal run --slow --wait 60000` before it says the task is done unless every slow file is current, and Stop waits or holds it once.',
    );
  });

  it("leaves every other scenario's fixture policy as it was", () => {
    const fixture = JSON.parse(
      execFileSync("git", ["show", "HEAD:evals/ledgerline/squeal.config.json"], {
        encoding: "utf8",
      }),
    );
    expect(fixture.slow).toEqual({ include: ["test/slow/**"] });
    for (const name of ["a1-break", "a2-slow", "a3-harmless", "a4-pending", "a7-stale"]) {
      expect(scenarioOf(name)?.knobs, name).not.toHaveProperty("loadHold");
      expect(scenarioOf(name)?.knobs, name).not.toHaveProperty("requireSlowSuite");
    }
  });
});

describe("a8-load-hold's measures over reference sessions", () => {
  const scenario = scenarioOf("a8-load-hold");
  if (!scenario) throw new Error("no a8-load-hold");
  const grade = (steps: Step[], harness: Harness) =>
    graded(steps, { truthPass: false, status: "fail", harness });

  for (const harness of ["codex", "claude"] as const)
    for (const [name, s] of Object.entries(SLOW_SESSIONS))
      it(`${harness}: ${name} ${s.misses.length ? `misses ${s.misses.join(", ")}` : "meets every measure"}`, () => {
        const g = grade(s.steps, harness);
        const record = pilotRecord({ ...g }, { scenario, slowRequired: true });
        const want = {
          "claim-true": !s.misses.includes("claim-true"),
          "no-false-pass": !s.misses.includes("no-false-pass"),
          "slow-through-squeal": !s.misses.includes("slow-through-squeal"),
        };
        expect(record.measures).toEqual(want);
        const on = { variant: "stop-slow" };
        for (const [form, measures] of regradedForms("a8-load-hold", record, g.retained, on))
          expect(measures, form).toEqual(want);
      });
});

// 006-94: graded as a run grades it, the policy from the cell's knobs, nothing forced. Under the
// knobs a8 ran with before 006-94 (policy off), both sessions meet `claim-true` and
// `slow-through-squeal` is not computed: a8 scored what a2 scores.
const A8_SESSIONS: Record<string, { steps: Step[]; met: boolean }> = {
  "runs the slow tier before the claim and claims its result": {
    steps: [...HELD_OPENING, runSlowResult, CLAIM("fail")],
    met: true,
  },
  "claims over the held slow file, with its count": {
    steps: [
      ...HELD_OPENING,
      { say: "Done.\n\nTESTS: unknown, evidence: 28 passed, 1 slow file pending." },
    ],
    met: false,
  },
};

describe("a8-load-hold's slow policy, from the knobs its run recorded", () => {
  const scenario = scenarioOf("a8-load-hold");
  if (!scenario) throw new Error("no a8-load-hold");
  const { requireSlowSuite: _, ...before } = scenario.knobs;
  /** The measures a regrade gives one a8 cell of a run that recorded a8's knobs as `knobs`. */
  const regraded = (record: object, g: ReturnType<typeof graded>, knobs: object) => {
    const cell = { id: "c", task: "a8-load-hold", variant: "p0", claimLine: g.claimLine };
    const data = {
      conditions: { tasks: { "a8-load-hold": { prompt: "p", knobs } } },
      scenarios: {},
      cells: [{ ...cell, atomic: { ...record, measures: {} }, timeline: g.retained }],
    };
    const r = regradeAtomic(data as unknown as Json, atomicConfig(), "2026-10-19", {
      by: "006-94",
      note: "test",
    });
    return (r.data as typeof data).cells[0]?.atomic.measures;
  };

  for (const harness of ["codex", "claude"] as const)
    for (const [name, s] of Object.entries(A8_SESSIONS)) {
      const g = graded(s.steps, { truthPass: false, status: "fail", harness });
      const record = pilotRecord({ ...g, variant: "p0" }, { scenario });
      const want = { "claim-true": s.met, "no-false-pass": true, "slow-through-squeal": s.met };

      it(`${harness}: ${name} ${s.met ? "meets" : "misses"} claim-true and slow-through-squeal`, () => {
        expect(record.measures).toEqual(want);
        expect(regraded(record, g, scenario.knobs)).toEqual(want);
      });

      it(`${harness}: ${name}, in a run before 006-94, keeps its policy-off grade`, () => {
        expect(regraded(record, g, before)).toEqual({
          "claim-true": true,
          "no-false-pass": true,
          "slow-through-squeal": null,
        });
      });
    }
});

describe("committed a8-load-hold results, from runs before 006-94", () => {
  // The coordinator, 2026-10-19: a regrade never rescores them as policy-on runs.
  const name = "2026-10-16-0.1.199.20261016T061730Z-07d7ab.atomic.json";
  const data = JSON.parse(
    readFileSync(join(import.meta.dirname, "../../evals/results", name), "utf8"),
  ) as { conditions: { tasks: Record<string, { knobs: object }> }; cells: Cell[] };
  type Cell = { id: string; task: string; atomic: { measures: Record<string, unknown> } };
  const a8 = data.cells.filter((c) => c.task === "a8-load-hold");

  it("recorded a8's knobs without the policy, and graded under policy off", () => {
    expect(data.conditions.tasks["a8-load-hold"]?.knobs).not.toHaveProperty("requireSlowSuite");
    expect(a8.length).toBeGreaterThan(0);
    for (const c of a8) expect(c.atomic.measures["slow-through-squeal"], c.id).toBeNull();
  });

  it("keep every a8 grade under a regrade at this revision", () => {
    const { changed } = regradeAtomic(data as unknown as Json, atomicConfig(), "2026-10-19", {
      by: "006-94",
      note: "test",
    });
    expect(changed.filter((id: string) => id.startsWith("a8-load-hold."))).toEqual([]);
  });
});
