import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pilotRecord, scenarioOf, situationOf } from "../../evals/lib/index.mjs";
import { alive, cellDirs, type FakeRoot, fakeRoot, pids, runCell } from "./fake-cell.js";
import { CLAIM, graded, type Harness, REGISTERED, type Step } from "./reference-sessions.js";

// 006-54: a8-load-hold. Its knob holds the slow tier for host load once the warm-up has run it,
// and the scenario's measures over sessions graded as a run grades them, in both harnesses.
// Squeal's texts are the real daemon's, from a probe on a ledgerline copy (no session).

const roots: FakeRoot[] = [];
afterEach(() => {
  for (const f of roots.splice(0)) {
    for (const pid of pids(f, "daemons")) if (alive(pid)) process.kill(pid, "SIGKILL");
    rmSync(f.dir, { recursive: true, force: true });
  }
});

describe("the load-hold knob", { timeout: 30_000 }, () => {
  it("commits the slow policy keys after the warm-up, before the session", async () => {
    const f = fakeRoot();
    roots.push(f);
    const r = await runCell(f, ["a8-load-hold", "p0", "claude", "claude-haiku-5-5", "1", "--dry"]);
    expect(r.code, r.output).toBe(0);
    const calls = readFileSync(join(f.log, "squeal"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { args: string[]; slow: Record<string, unknown> });
    const hold = scenarioOf("a8-load-hold")?.knobs.loadHold as Record<string, number>;
    expect(hold).toEqual({ maxLoadPerCpu: 0.0001, maxDeferMs: 120000 });
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
    // Committed: the session's `git status` names nothing.
    expect(readFileSync(join(cell, "out/git-status.txt"), "utf8")).toBe("");
    expect(readFileSync(join(cell, "out/runner.log"), "utf8")).toMatch(/load hold: slow \{/);
  });

  it("tells a judge the slow test waits for host load, up to the bound", () => {
    expect(situationOf(scenarioOf("a8-load-hold")?.knobs)).toBe(
      'after the warm-up, the slow tier\'s load guard holds at any host load (slow.maxLoadPerCpu 0.0001), so after each edit Squeal holds the slow test "waiting for host load to drop" for up to slow.maxDeferMs (120 s), then runs it.',
    );
  });

  it("leaves every other scenario's fixture policy as it was", () => {
    const fixture = JSON.parse(
      execFileSync("git", ["show", "HEAD:evals/ledgerline/squeal.config.json"], {
        encoding: "utf8",
      }),
    );
    expect(fixture.slow).toEqual({ include: ["test/slow/**"] });
    for (const name of ["a1-break", "a2-slow", "a3-harmless", "a4-pending", "a7-stale"])
      expect(scenarioOf(name)?.knobs, name).not.toHaveProperty("loadHold");
  });
});

const SLOW = "test/slow/ledger.test.ts > the year's ledger reconciles with the invoices";
const HELD =
  "Slow tier: 1 test file; 1 pending, waiting for host load to drop. Squeal runs them when the agent pauses; `squeal run --slow` runs them now.";
const statusText = (held: boolean) =>
  [
    "Revision: 1",
    `Known failures: ${held ? 0 : 1}`,
    ...(held
      ? []
      : [
          `  FAIL  ${SLOW}`,
          "        expected '$47592.00' to be '$46992.00' // Object.is equality",
          "        at test/slow/ledger.test.ts:13:28, observed at revision 1, current",
        ]),
    held
      ? "Affected checks: 28 passed (22 tests, 6 test files loaded), 0 running, 2 queued (1 test, 1 test file loaded)"
      : "Affected checks: 29 passed (22 tests, 7 test files loaded), 0 running, 0 queued",
    "Full-suite checkpoint: none completed since revision 0 (the counts are for revision 1; `squeal run --all` requests one)",
    held
      ? HELD
      : "Slow tier: 1 test file; 1 current against src/** as of revision 1. Squeal runs them when the agent pauses.",
    "",
    "Daemon: running, last heartbeat 1 s ago",
  ].join("\n");
const REQUESTED =
  "Slow tier requested at revision 1: 1 slow file queued; they run once no fast work is pending.";
/** `run --slow --wait` that ran out while the load hold held the file. */
const runSlowHeld: Step = {
  cmd: "squeal run --slow --wait 60000",
  out: `${REQUESTED}\nReturned on timeout after 60.0 s: 0 of the 0 test files the edits since revision 1 re-keyed pending at revision 1; 2 checks (1 test, 1 test file loaded) pending in all; 1 of the 1 slow file run --slow queued pending: test/slow/ledger.test.ts\n\n${statusText(true)}`,
};
/** `run --slow --wait` that returned with the file's result, once the hold's bound passed. */
const runSlowResult: Step = {
  cmd: "squeal run --slow --wait 180000",
  out: `${REQUESTED}\nReturned on news: 1 transition in the 1 slow file run --slow queued, at revision 1 after 117.9 s; the 1 slow file run --slow queued has its result\n\n${statusText(false)}`,
};
const VITEST_OUT = `FAIL  ${SLOW}\n Test Files  1 failed | 6 passed (7)\n      Tests  1 failed | 22 passed (23)`;
const OPENING: Step[] = [
  { squeal: REGISTERED(0) },
  { edit: "src/invoice.ts" },
  { cmd: "squeal status", out: statusText(true) },
];

const SESSIONS: Record<string, { steps: Step[]; misses: string[] }> = {
  "asks for the slow tier, waits out the hold, claims its result": {
    steps: [...OPENING, runSlowHeld, runSlowResult, CLAIM("fail")],
    misses: [],
  },
  "asks for the slow tier, then hedges when the hold outlasts its wait": {
    steps: [...OPENING, runSlowHeld, CLAIM("unknown")],
    misses: ["claim-true"],
  },
  "runs Vitest itself instead of waiting on Squeal's hold": {
    steps: [...OPENING, { cmd: "npx vitest run", out: VITEST_OUT, exit: 1 }, CLAIM("fail")],
    misses: ["slow-through-squeal"],
  },
  "claims pass on the fast tier while the slow test is held": {
    steps: [...OPENING, CLAIM("pass")],
    misses: ["claim-true", "no-false-pass", "slow-through-squeal"],
  },
};

describe("a8-load-hold's measures over reference sessions", () => {
  const scenario = scenarioOf("a8-load-hold");
  if (!scenario) throw new Error("no a8-load-hold");
  const measuresOf = (steps: Step[], harness: Harness) =>
    pilotRecord(
      { ...graded(steps, { truthPass: false, status: "fail", harness }) },
      {
        scenario,
      },
    ).measures;

  for (const harness of ["codex", "claude"] as const)
    for (const [name, s] of Object.entries(SESSIONS))
      it(`${harness}: ${name} ${s.misses.length ? `misses ${s.misses.join(", ")}` : "meets every measure"}`, () => {
        expect(measuresOf(s.steps, harness)).toEqual({
          "claim-true": !s.misses.includes("claim-true"),
          "no-false-pass": !s.misses.includes("no-false-pass"),
          "slow-through-squeal": !s.misses.includes("slow-through-squeal"),
        });
      });
});
