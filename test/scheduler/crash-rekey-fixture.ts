import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import type { TestCheckId } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { waitFor } from "../watcher/helpers.js";
import { type createRepo, openHarness, openRepoStore, type RecordedRun } from "./helpers.js";
import { type PhaseTrace, processState } from "./phase-trace.js";

/** A child's poll gives its bound this much room, so the trace's bound runs out first. */
const POLL_SLACK_MS = 2_000;
/** The longest the child's rewrite and exit are polled for, and a held child holds. */
const CHILD_MS = 60_000;

const check = (path: string, fullName: string): TestCheckId => ({
  kind: "test",
  project: "",
  testPath: path,
  fullName,
});

export interface CrashRekeyOptions {
  /**
   * Row 011-289 (`research/ci-crash-rekey-stall.md` 5): after its rewrite
   * the child sleeps, so it answers no graceful cancel, until the crashing
   * run's cancel began; then it kills itself. Vitest has taken its task to
   * cancel, and the worker's end never settles that cancel. Default: the
   * child kills itself at once.
   */
  readonly held?: boolean;
}

/**
 * Row 011-281: a crashing run of `test/kill.test.ts` whose child rewrites
 * the file before it kills itself; the batch for the rewrite arrives during
 * the crashed run and gives the file a new key, so it runs again. Every wait
 * is a phase of `trace`, bounded within its budget. Returns the file's runs.
 */
export async function crashRekey(
  repo: ReturnType<typeof createRepo>,
  trace: PhaseTrace,
  options: CrashRekeyOptions = {},
): Promise<RecordedRun[]> {
  const store = openRepoStore(repo.commonDir);
  const h = await trace.wait("baseline", "open the harness", () =>
    openHarness(repo.main, store, repo.commonDir, { policy: RUN_MISSING, trace }),
  );
  await trace.wait("baseline", "start and idle", async () => {
    await h.scheduler.start();
    await h.scheduler.idle();
  });

  let batch: Promise<void> | null = null;
  let exit: Promise<void> | null = null;
  const fixed = 'import { it } from "vitest";\nit("survives", () => {});\n';
  // Outside the worktree: the child's process id, so its exit is observed (row 011-281).
  const pidFile = join(repo.dir, "kill.pid");
  // Outside the worktree too: written once the crashing run's cancel began (row 011-289).
  const release = join(repo.dir, "kill.release");
  if (options.held === true) {
    h.gate.before = (files, runOptions) => {
      if (!files.some((f) => f.path === "test/kill.test.ts")) return;
      h.gate.before = null;
      // The adapter's cancel follows the abort within the same turn of the event loop: the
      // release is written after it began.
      runOptions.signal?.addEventListener(
        "abort",
        () =>
          setImmediate(() => {
            writeFileSync(release, "go");
            trace.note("child exit", "released after the run's cancel began");
          }),
        { once: true },
      );
    };
  }
  h.runner.beforeRun = (files) => {
    if (batch !== null || !files.some((f) => f.path === "test/kill.test.ts")) return;
    // The agent fixes the file while the crashing run is in flight; the watcher reports it.
    // The crashing test writes the fix itself: the adapter runs the bytes on disk at its
    // start (task 001-146), so a fix written here would never crash.
    const kill = join(h.root, "test/kill.test.ts");
    const rewritten = trace.step(
      "child rewrite",
      "test/kill.test.ts holds the fix",
      (ms) => waitFor(() => readFileSync(kill, "utf8") === fixed, ms + POLL_SLACK_MS),
      CHILD_MS,
    );
    batch = rewritten.then(() =>
      trace.step("batch", "the fix", () => h.batch("test/kill.test.ts"), CHILD_MS),
    );
    exit = rewritten.then(() => {
      const pid = Number(readFileSync(pidFile, "utf8"));
      return trace.step("child exit", `pid ${pid}`, (ms) => exited(trace, pid, ms), CHILD_MS);
    });
    // Each is awaited below; until then a rejection is held, not unhandled.
    batch.catch(() => {});
    exit.catch(() => {});
  };
  h.write("test/kill.test.ts", killing(pidFile, fixed, options.held === true ? release : null));
  await trace.wait("batch", "the crashing file", () => h.batch("test/kill.test.ts"));
  await trace.wait("idle", "after the crashing file's batch", () => h.scheduler.idle());
  await trace.wait("batch", "the fix, after the child's rewrite", async () => {
    await batch;
  });
  await trace.wait("child exit", "the crashing child", async () => {
    await exit;
  });
  await trace.wait("idle", "after the fix's batch", () => h.scheduler.idle());

  const runs = h.runsOf("test/kill.test.ts");
  expect(runs.map((r) => r.report.end)).toEqual(["crashed", "completed"]);
  const key = h.keyOf("test/kill.test.ts");
  expect(store.results.byKey(key).map((r) => [r.check, r.outcome])).toEqual([
    [{ kind: "file", project: "", testPath: "test/kill.test.ts" }, "pass"],
    [check("test/kill.test.ts", "survives"), "pass"],
  ]);
  expect(h.header()).toMatchObject({
    counts: { current: 13, pending: 0, stale: 0, unknown: 0 },
    testFilesWithoutChecks: { pending: 0, unknown: 0 },
  });
  if (options.held === true) expect(existsSync(release)).toBe(true);
  return runs;
}

/** The test that records its process id, writes `fixed` over itself and kills its worker. */
function killing(pidFile: string, fixed: string, release: string | null): string {
  const hold =
    release === null
      ? []
      : [
          `  for (const until = Date.now() + ${CHILD_MS}; !existsSync(${JSON.stringify(release)}) && Date.now() < until; )`,
          "    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);",
        ];
  return [
    `import { ${release === null ? "" : "existsSync, "}writeFileSync } from "node:fs";`,
    'import { it } from "vitest";',
    'it("kills its worker", () => {',
    `  writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
    `  writeFileSync(new URL(import.meta.url), ${JSON.stringify(fixed)});`,
    ...hold,
    '  process.kill(process.pid, "SIGKILL");',
    "});",
    "",
  ].join("\n");
}

/** Polls until `pid` is reaped; marks the first sight of it exited but not reaped. */
async function exited(trace: PhaseTrace, pid: number, ms: number): Promise<void> {
  let zombie = false;
  await waitFor(() => {
    const state = processState(pid);
    if (state === "Z" && !zombie) {
      zombie = true;
      trace.note("child exit", `pid ${pid} exited, not reaped yet`);
    }
    return state === "gone";
  }, ms + POLL_SLACK_MS);
}
