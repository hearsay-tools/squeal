import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SideState } from "../../src/cli/status-at-report.js";
import { type RunUse, runLines } from "../../src/cli/status-at-report-run.js";
import type { RunAnswer } from "../../src/cli/status-at-run-child.js";
import { noFitText, rerunFit } from "../../src/cli/status-at-run-fit.js";
import { runBatches } from "../../src/cli/status-at-run-loop.js";
import { type DaemonPorts, runNow } from "../../src/cli/status-at-run-now.js";
import { setupOf } from "../../src/cli/status-at-run-setup.js";
import { readPolicy } from "../../src/core/daemon/policy.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import type { AbsolutePath, RelativePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";

/*
 * Row 023-29 (lessons round 4, R1, R3, R4) without a runner: the gate
 * note a setup failure is read from, the batch loop's lots and its stop
 * after a failed setup, the rerun's fit from the measured rate, and the
 * working tree's side through a daemon (fake ports).
 */

const ref = (path: string): TestFileRef => ({ project: "", path: path as RelativePath });
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A folder whose policy has `browser`, a group that runs only on request. */
function browserRepo(): AbsolutePath {
  const dir = mkdtempSync(join(tmpdir(), "squeal-at-units-")) as AbsolutePath;
  dirs.push(dir);
  const checks = [{ name: "browser", runner: "vitest", tests: ["test/browser/**"], at: "manual" }];
  writeFileSync(join(dir, "squeal.config.json"), JSON.stringify({ checks }));
  return dir;
}

const CHROME = "Browser E2E environment bootstrap failed; cause: Chrome failed to launch";

describe("setupOf (R3)", () => {
  it("reads the gate's note of a run that failed to start, and nothing else", () => {
    expect(setupOf(`vitest run: the run failed to start: ${CHROME}`)).toEqual({
      runner: "vitest",
      text: CHROME,
    });
    expect(setupOf("vitest run: global setup e2e/setup.ts failed: boom")).toEqual({
      runner: "vitest",
      text: "global setup e2e/setup.ts failed: boom",
    });
    expect(setupOf("vitest run: 3 files withheld")).toBeNull();
    expect(setupOf("the 1 completed test file is kept in the stores")).toBeNull();
  });
});

describe("runBatches (R3)", () => {
  it("runs an on-request group in its own batch and stops it after its setup failed", async () => {
    const root = browserRepo();
    const files = ["test/unit/a.test.ts", "test/browser/b.test.ts", "test/browser/c.test.ts"].map(
      ref,
    );
    const states = new Map<string, SideState>();
    const batches: (readonly RelativePath[])[] = [];
    const end = await runBatches({
      files,
      refOf: (file) => file,
      policy: readPolicy(root),
      timeoutSeconds: 300,
      batchFiles: 2,
      endMs: performance.now() + 300_000,
      secondsOf: () => null,
      run: async ({ paths }): Promise<RunAnswer> => {
        batches.push(paths);
        const browser = paths.some((p) => p.includes("browser"));
        const runs = paths.map((path) => ({
          runner: "vitest" as const,
          path,
          outcome: browser ? ("not-run" as const) : ("passed" as const),
          from: "run" as const,
          failed: [],
          skipped: false,
          ...(browser ? { reason: "budget" as const } : {}),
        }));
        const result = { runs, timedOut: false, budgetSeconds: 1 };
        return browser ? { result, setup: [{ runner: "vitest", text: CHROME }] } : { result };
      },
      readBack: async (read, answer) => {
        if (!("result" in answer)) return;
        for (const file of read) {
          const r = answer.result.runs.find((x) => x.path === file.path);
          if (r?.outcome === "not-run")
            states.set(testFileId(file), { state: "not run", reason: "budget" });
        }
      },
      stateOf: (file) => states.get(testFileId(file)),
      setState: (file, state) => states.set(testFileId(file), state),
    });
    // The unit file is not in a batch with a browser file, though a batch holds two paths.
    expect(batches).toEqual([
      ["test/unit/a.test.ts"],
      ["test/browser/b.test.ts", "test/browser/c.test.ts"],
    ]);
    const setup = `browser: ${CHROME}`;
    for (const path of ["test/browser/b.test.ts", "test/browser/c.test.ts"])
      expect(states.get(testFileId(ref(path)))).toEqual({
        state: "not run",
        reason: "setup",
        setup,
      });
    expect(states.has(testFileId(ref("test/unit/a.test.ts")))).toBe(false);
    expect(end.timedOut).toBe(false);
  });

  it("runs no later batch of a group whose setup failed", async () => {
    const root = browserRepo();
    const files = ["test/browser/b.test.ts", "test/browser/c.test.ts"].map(ref);
    const states = new Map<string, SideState>();
    let calls = 0;
    await runBatches({
      files,
      refOf: (file) => file,
      policy: readPolicy(root),
      timeoutSeconds: 300,
      batchFiles: 1,
      endMs: performance.now() + 300_000,
      secondsOf: () => null,
      run: async ({ paths }): Promise<RunAnswer> => {
        calls++;
        const runs = paths.map((path) => ({
          runner: "vitest" as const,
          path,
          outcome: "not-run" as const,
          from: "run" as const,
          failed: [],
          skipped: false,
          reason: "budget" as const,
        }));
        return {
          result: { runs, timedOut: false, budgetSeconds: 1 },
          setup: [{ runner: "vitest", text: "x" }],
        };
      },
      readBack: async (read) => {
        for (const file of read)
          states.set(testFileId(file), { state: "not run", reason: "budget" });
      },
      stateOf: (file) => states.get(testFileId(file)),
      setState: (file, state) => states.set(testFileId(file), state),
    });
    expect(calls).toBe(1);
    expect(states.get(testFileId(ref("test/browser/c.test.ts")))).toMatchObject({
      reason: "setup",
    });
  });
});

describe("rerunFit (R4)", () => {
  it("offers no --timeout when this run's rate says the files need hours", () => {
    // Round 4, s2: 31 of 1,338 ran in about 250 s of gate time, after 50 s of checkout and keying.
    const fit = rerunFit(50_000, [{ left: 1307, ran: 31, gateMs: 250_000, estimate: null }]);
    expect(fit).toMatchObject({ from: "rate" });
    expect("needs" in fit && fit.needs !== null && fit.needs > 2.5 * 3600).toBe(true);
    if (!("needs" in fit)) throw new Error("a fit");
    expect(noFitText("1307 not run (budget)", fit)).toBe(
      "1307 not run (budget); at this run's rate they need about 3 h; name test files or folders to narrow it",
    );
  });

  it("fits from the rate of each side, both sides in one rerun", () => {
    // 10 files in 20 s at the commit, 10 in 20 s now; 5 left each: 10 s + 10 s, times 1.5, after 30 s.
    const sides = [
      { left: 5, ran: 10, gateMs: 20_000, estimate: null },
      { left: 5, ran: 10, gateMs: 20_000, estimate: null },
    ];
    expect(rerunFit(30_000, sides)).toEqual({ seconds: 60 });
    // 200 left at 0.5 per second: 400 s, 30 + 1.5 * 400 = 630 s, over the 600 s cap.
    expect(rerunFit(30_000, [{ left: 200, ran: 10, gateMs: 20_000, estimate: null }])).toEqual({
      needs: 430,
      from: "rate",
    });
  });

  it("says the time is unknown when nothing ended and nothing is stored", () => {
    const fit = rerunFit(5_000, [{ left: 2, ran: 0, gateMs: 1_000, estimate: null }]);
    expect(fit).toEqual({ needs: null, from: "durations" });
  });

  it("prints the budget line per side, with the fit or what the files need", () => {
    const base: RunUse = {
      timeoutSeconds: 300,
      usedMs: 300_000,
      gateMs: 250_000,
      selected: 1338,
      ran: 31,
      stored: 31,
      notStored: [],
      changed: null,
      changedBy: null,
      notRun: 1307,
      notComparable: 0,
      timedOut: true,
      estimate: null,
      rerun: null,
      rerunNeeds: { seconds: 10_590, from: "rate" },
    };
    const lines = runLines(base, "abc123456");
    expect(lines.at(-1)).toBe(
      "1307 not run (budget); at this run's rate they need about 3 h; name test files or folders to narrow it",
    );
    expect(lines.join("\n")).not.toContain("--timeout");
    const both = runLines(
      {
        ...base,
        notRun: 2,
        rerun: "squeal status --at abc --run --timeout 120",
        now: {
          how: "gate",
          selected: 3,
          ran: 2,
          notRun: 1,
          gateMs: 1,
          setupFailed: [],
          problem: null,
        },
      },
      "abc123456",
    );
    expect(both.at(-1)).toBe(
      "3 not run (budget: 2 at abc123456, 1 now). A rerun that fits: squeal status --at abc --run --timeout 120",
    );
  });
});

describe("runNow through the daemon (R1)", () => {
  it("asks the daemon per group, waits for the files, and reads what it says", async () => {
    const root = browserRepo();
    const asked: [string, readonly RelativePath[]][] = [];
    let waited: readonly TestFileRef[] = [];
    const ports: DaemonPorts = {
      ask: async (group, paths) => {
        asked.push([group, paths]);
        return group === "browser" ? "squeal run browser failed: no Chrome" : true;
      },
      wait: async (files) => {
        waited = files;
        return "the budget ended; their runs go on in the daemon";
      },
    };
    const files = ["test/unit/a.test.ts", "test/browser/b.test.ts"].map(ref);
    const end = await runNow({
      root,
      commonDir: root,
      files,
      daemon: true,
      endMs: performance.now() + 60_000,
      timeoutSeconds: 60,
      env: {},
      relaunch: undefined,
      forward: () => {},
      ports,
    });
    expect(asked).toEqual([
      ["tests", ["test/unit/a.test.ts"]],
      ["browser", ["test/browser/b.test.ts"]],
    ]);
    expect(waited).toEqual(files);
    expect(end).toMatchObject({
      how: "daemon",
      problem:
        "group browser: squeal run browser failed: no Chrome; the budget ended; their runs go on in the daemon",
    });
  });
});
