import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readStatus } from "../../src/core/status/index.js";
import type {
  AbsolutePath,
  DaemonLiveness,
  EnsureDaemonResult,
} from "../../src/core/types/index.js";
import type { HookDeps } from "../../src/harness/claude-code/index.js";
import { resume, stoppedItself, testPause } from "../e2e/restart-evidence.js";
import { daemonSuite, delay, ping, SLOW, spawnCli, waitFor, withStore } from "./helpers.js";
import { stepDownKit } from "./step-down-helpers.js";
import { findProcesses } from "./strays.js";

/*
 * Design 011-30's regression (brief question 5), across rows 011-31 to
 * 011-34: the probe's shape, an older daemon whose edit's tier is held when
 * newer hooks arrive, under `baseline.onStart: "lookup-only"`. Before them,
 * six hooks spawned six successors, the step-down waited for the held tier
 * past every successor's 120 s lock wait, `start` printed alive above a
 * snapshot that said no daemon, and the named wait returned on quiet with
 * the edited file stale and unqueued (`research/issue-47.md`, runs 1 to 5).
 *
 * Status is read where the handoff is held, not by sampling: the old daemon
 * stops itself between its socket's unlink and its lock release
 * (`testPause("stop-gap")`). Its shutdown took under 150 ms, and a status
 * read every 50 ms missed it on CI (run 39746558837, review 0.1.259).
 */

const suite = daemonSuite();
const { HOOKS, buildAt, start, sockets, hookDeps, hook, exitWithin } = stepDownKit(suite);
const HOLD = "test/hold.test.ts";
/** Row 011-31: Vitest's cancel forces its workers after 1 s, the shutdown follows (as `step-down`). */
const STEP_DOWN_WITHIN_MS = 15_000;
/** The old daemon stops itself with its record cleared and its lock held (task 001-355). */
const STOP_GAP = testPause("stop-gap");

/** Appends to `started` on each run, then sleeps while `hold` exists. */
function heldTest(dir: string): string {
  const at = (name: string) => JSON.stringify(join(dir, name));
  return `import { appendFileSync, existsSync } from "node:fs";
import { expect, it } from "vitest";
it("holds while the flag exists", async () => {
  appendFileSync(${at("started")}, "x");
  const deadline = Date.now() + 150_000;
  while (existsSync(${at("hold")}) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 100));
  }
  expect(existsSync(${at("hold")})).toBe(false);
}, 170_000);
`;
}

const passing = (name: string) =>
  `import { expect, it } from "vitest";\nit("${name}", () => expect(1).toBe(1));\n`;

describe.runIf(process.platform === "linux")(
  "an upgrade with the edit's tier held (design 011-30, rows 011-31 to 011-34)",
  SLOW,
  () => {
    it("one successor, the old daemon out within 15 s, the held file handed over and stored, the named wait on its result", async () => {
      const dir = mkdtempSync(join(tmpdir(), "sq-handover-tier-"));
      const flag = join(dir, "hold");
      suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
      const repo = suite.fixture({
        "squeal.config.json": `${JSON.stringify({ baseline: { onStart: "lookup-only" } })}\n`,
        [HOLD]: heldTest(dir),
        "test/a.test.ts": passing("a"),
        "test/b.test.ts": passing("b"),
        "test/c.test.ts": passing("c"),
      });
      const squeal = (...args: string[]) =>
        spawnCli(suite.cli, args, { cwd: repo.root, env: repo.env });
      const starts = () => {
        const path = join(dir, "started");
        return existsSync(path) ? readFileSync(path, "utf8").length : 0;
      };

      const old = start(buildAt("0.1.0"), repo, [], STOP_GAP);
      const first = await waitFor(() => ping(repo.socketPath, 500), 60_000, "0.1.0 serving");
      expect(first.squealVersion).toBe("0.1.0");
      expect((await squeal("run", "--all", "--wait").exited).code).toBe(0);
      expect(starts()).toBe(1);
      // The hold on, then the edit: the old daemon's tier holds the file (run 5).
      writeFileSync(flag, "");
      appendFileSync(join(repo.root, HOLD), "// edit\n");
      await waitFor(() => starts() >= 2, 120_000, "the edited file running, held");

      const ensured: EnsureDaemonResult[] = [];
      const real = hookDeps(repo, ensured);
      const lockWaits: number[] = [];
      const deps: HookDeps = {
        ...real,
        ensureDaemon: (root, options) => {
          if (options.awaitLockMs !== undefined) lockWaits.push(options.awaitLockMs);
          return real.ensureDaemon?.(root, options) ?? Promise.resolve("unavailable");
        },
      };
      sockets.push(repo.socketPath);
      // What status says while the old daemon holds its stop gap, once the claim names the hooks' version.
      const inGap = (async (): Promise<DaemonLiveness | null | "never stopped"> => {
        if (!(await stoppedItself(first.pid, 60_000))) return "never stopped";
        try {
          let last: DaemonLiveness | null = null;
          const deadline = performance.now() + 10_000;
          while (last?.stopping?.to !== HOOKS && performance.now() < deadline) {
            const s = readStatus(repo.root as AbsolutePath);
            if (s.available) last = s.daemon;
            await delay(20);
          }
          return last;
        } finally {
          resume(first.pid);
        }
      })();
      const steppedAt = performance.now();
      let startRun: ReturnType<typeof squeal> | null = null;
      let servedAt = 0;
      const handover = (async () => {
        await Promise.all(["a", "b", "c"].map((s) => hook("session-start", repo, deps, s)));
        startRun = squeal("start");
        for (const s of ["d", "e", "f"]) {
          await delay(1_000);
          await hook("session-start", repo, deps, s);
        }
        await waitFor(
          async () => (await ping(repo.socketPath, 500))?.squealVersion === HOOKS,
          130_000,
          "the successor serving",
        );
        servedAt = performance.now();
      })();
      // Every successor process and every status reading until the successor serves.
      const successors = new Set<number>();
      const readings: DaemonLiveness[] = [];
      let settled = false;
      void handover.finally(() => {
        settled = true;
      });
      while (!settled) {
        for (const { pid } of findProcesses(`daemon ${repo.root}`, "--await-lock")) {
          successors.add(pid);
        }
        const s = readStatus(repo.root as AbsolutePath);
        if (s.available) readings.push(s.daemon);
        await delay(50);
      }
      await handover;

      // One successor (row 011-32).
      expect(lockWaits).toHaveLength(1);
      expect(successors.size).toBe(1);
      // The old daemon out within 15 s with its tier cancelled (row 011-31).
      expect(await exitWithin(old, STEP_DOWN_WITHIN_MS, repo)).toEqual({ code: 0, signal: null });
      // Status said it hands over with the record cleared and the lock held (row 011-34).
      expect(await inGap).toMatchObject({
        state: "down",
        stopping: { from: "0.1.0", to: HOOKS, overdue: false },
      });
      // `start` never printed alive above a snapshot that said no daemon or a handoff.
      const started = startRun as ReturnType<typeof squeal> | null;
      if (started === null) throw new Error("start never ran");
      expect((await started.exited).code, started.stderr()).toBe(0);
      const out = started.stdout();
      console.log(
        `handover-tier: the successor served ${Math.round(servedAt - steppedAt)} ms after the first hook; ${readings.filter((d) => d.stopping !== undefined).length} of ${readings.length} readings stopping; start: ${out.split("\n")[0]}`,
      );
      if (/^Squeal daemon alive/.test(out)) {
        expect(out).not.toMatch(/Daemon: no daemon|no daemon has validated|handing over/);
      }

      // The successor queues the handed-over file and runs it, held again (row 011-33).
      const wait = squeal("status", "--wait", "60000", HOLD);
      const early = await Promise.race([
        wait.exited.then(() => "returned"),
        delay(5_000).then(() => "held"),
      ]);
      expect(early, wait.stdout()).toBe("held");
      await waitFor(() => starts() >= 3, 60_000, "the successor running the held file");
      rmSync(flag);
      expect((await wait.exited).code, wait.stdout()).toBe(0);
      expect(wait.stdout()).toMatch(
        /Named test files at revision \d+: no known failures; 1 test file, each with a current result/,
      );
      const states = withStore(repo, (store) =>
        store.knownStates.list(repo.worktreeId).filter((s) => s.check.testPath === HOLD),
      );
      expect(states.length).toBeGreaterThan(0);
      expect(states.every((s) => s.validity === "current" && s.outcome === "pass")).toBe(true);
    });
  },
);
