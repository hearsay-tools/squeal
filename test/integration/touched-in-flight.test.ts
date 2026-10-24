import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { readDaemonNotes } from "../../src/core/notes.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { type Harness, openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";
import {
  BASE,
  createRepo,
  type ScheduledRun,
  scheduledRuns,
  slowOptions,
  stored,
  withSlowLanes,
} from "./stamps-repo.js";

/*
 * Task 001-159: a touch heard while a run is in flight. When something else
 * wrote a file the run loaded, a cache may have served the run its other
 * bytes, so the files that reach it are not stored (task 013-02). When the
 * completion barrier withholds the run too, no revision follows, so the
 * files run once more with a note naming the file (task 007-30). A file
 * the run writes itself on every run and reads with `fs` is in no cache
 * and no key, so it withholds nothing.
 *
 * `test/holds.test.ts` appends to `flags/started` (git-ignored) and waits
 * until `flags/heard` is as long; with `self` it first rewrites
 * `fixtures/data.txt` with the bytes it holds, as a fixture writer does on
 * every run.
 */

const holds = (self: boolean) =>
  [
    'import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";',
    'import { setTimeout as sleep } from "node:timers/promises";',
    'import { expect, it } from "vitest";',
    'import { which } from "../src/mod.ts";',
    "",
    'const at = (path: string) => new URL("../" + path, import.meta.url);',
    'const length = (path: string) => (existsSync(at(path)) ? readFileSync(at(path), "utf8").length : 0);',
    'it("passes on the bytes on disk", async () => {',
    self ? '  writeFileSync(at("fixtures/data.txt"), readFileSync(at("fixtures/data.txt")));' : "",
    '  appendFileSync(at("flags/started"), "x");',
    '  const run = length("flags/started");',
    '  for (let i = 0; i < 600 && length("flags/heard") < run; i++) await sleep(50);',
    '  expect(which).toBe("old");',
    "});",
    "",
  ].join("\n");

const files = (self: boolean): Readonly<Record<string, string>> => ({
  ...BASE,
  ".gitignore": "node_modules/\nflags/\n",
  "flags/.keep": "\n",
  "fixtures/data.txt": "data\n",
  "test/holds.test.ts": holds(self),
  "test/other.test.ts": 'import { it } from "vitest";\nit("passes", () => {});\n',
});

/**
 * Starts the scheduler. Once each of the next `times` runs started, `path`
 * is rewritten with its own bytes (unless the run did it), the batch is
 * handed over, and the run ends once the runner heard the touch. Later runs
 * go through.
 */
async function touchDuringRun(h: Harness, path: string, rewrite: boolean, times = 1) {
  let heard: (() => void) | null = null;
  const invalidate = h.runner.invalidate;
  h.runner.invalidate = (paths) => {
    if (paths.some((p) => p.kind === "touch")) heard?.();
    return invalidate(paths);
  };
  const flag = (name: string) => join(h.root, "flags", name);
  const length = (name: string) =>
    existsSync(flag(name)) ? readFileSync(flag(name), "utf8").length : 0;
  await h.scheduler.start();
  for (let run = 1; run <= times; run++) {
    for (let i = 0; i < 1200 && length("started") < run; i++) await sleep(25);
    expect(length("started")).toBe(run);
    const touch = new Promise<void>((resolve) => {
      heard = resolve;
    });
    if (rewrite) h.write(path, readFileSync(join(h.root, path), "utf8"));
    await h.batch(path);
    await touch;
    appendFileSync(flag("heard"), "x");
  }
  appendFileSync(flag("heard"), "x".repeat(1_000));
  await h.scheduler.idle();
}

/**
 * `withheldByBarrier` for `holds` alone: the barrier withheld its first run
 * and it ran once more, with a note naming `src/mod.ts`; none of that run's
 * results for it reached the store. `other` shared the run and stored it
 * (task 013-02, D2), so the run's id is among the puts.
 */
function holdsWithheld(h: Harness, runs: readonly ScheduledRun[], puts: () => string[]): void {
  const notes = readDaemonNotes(h.store, h.worktreeId).map((note) => note.text);
  expect(notes).toContainEqual(
    expect.stringMatching(
      /src\/mod\.ts was written while .*test\/holds\.test\.ts.* runs once more.*001-168/,
    ),
  );
  const ran = runs.filter((run) => run.files.some((f) => f.path === "test/holds.test.ts"));
  expect(ran.length).toBe(2);
  expect(puts()).toEqual([ran[1]?.runId]);
  expect(runs.filter((run) => run.files.some((f) => f.path === "test/other.test.ts"))).toEqual([
    ran[0],
  ]);
}

/** The run ids of what `putMany` is given for `holds` from now on. */
function holdsPuts(h: Harness): () => string[] {
  const spy = vi.spyOn(h.store.results, "putMany");
  return () => [
    ...new Set(
      spy.mock.calls.flatMap(([records]) =>
        records
          .filter((r) => r.check.testPath === "test/holds.test.ts")
          .map((r) => r.provenance.runId),
      ),
    ),
  ];
}

/** The reasons `markUnknown` stored for `path`. */
const reasons = (h: Harness, path: string) =>
  h.sink
    .callsOf("markUnknown")
    .filter((call) => call.testFiles.some((f) => f.path === path))
    .map((call) => call.reason);

describe("a touch heard during a run (task 001-159)", () => {
  it.each([true, false])(
    "stores none of the run's files that loaded it when another wrote it (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo(files(false));
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        tierSize: 4,
        runnerPartBesideRun: true,
        observe,
        policy: RUN_MISSING,
      });
      const runs = scheduledRuns(h);
      const puts = holdsPuts(h);
      await touchDuringRun(h, "src/mod.ts", true);

      // What is stored is the run once more's, on the bytes on disk (task 007-30); `other`
      // reaches no module of the path and its key does not name it (task 013-02, D2).
      expect(stored(h)).toEqual([
        ["", "test/holds.test.ts", "current", "pass"],
        ["", "test/other.test.ts", "current", "pass"],
      ]);
      holdsWithheld(h, runs, puts);
    },
  );

  // Spec 004 D2: the slow instance hears it at once, not before its next run.
  it("stores none of a slow run's files that loaded it", SLOW, async () => {
    const repo = createRepo(files(false));
    const { slotDir, ...options } = slowOptions(["test/holds.test.ts", "test/other.test.ts"]);
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      ...options,
      runnerPartBesideRun: true,
      policy: { ...options.policy, ...RUN_MISSING },
    });
    const lanes = withSlowLanes(h, repo.main, slotDir, async () => {});
    const runs = scheduledRuns(h);
    const puts = holdsPuts(h);
    await touchDuringRun(h, "src/mod.ts", true);

    // Spec 004 D2 as amended (004-34): an idle slow tier takes up to `slow.maxParallel` files,
    // so both ran in the one slow run that heard the touch; the one reaching it ran once more
    // (tasks 007-30, 013-02).
    expect(lanes.made()).toBe(1);
    expect(runs.map((run) => run.files.length)).toEqual([2, 1]);
    expect(stored(h)).toEqual([
      ["", "test/holds.test.ts", "current", "pass"],
      ["", "test/other.test.ts", "current", "pass"],
    ]);
    holdsWithheld(h, runs, puts);
  });
});

describe("a test file that rewrites a worktree file with its own bytes on every run", () => {
  // Task 013-02 (V5 as amended 2026-10-20): it reads the file with `fs`, so no module of the
  // instance names it and the runner withholds nothing. Nor does the completion barrier: no key
  // names it, observed or not, since the recorder leaves out a path the test wrote. Review
  // wave-13e B1's own write of a file it loads is `touched-own-write.test.ts`.
  it.each([true, false])(
    "is stored from its first run, no module naming the file (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo(files(true));
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        tierSize: 4,
        runnerPartBesideRun: true,
        observe,
        policy: RUN_MISSING,
      });
      await touchDuringRun(h, "fixtures/data.txt", false);
      expect(h.runsOf("test/holds.test.ts")).toHaveLength(1);
      expect(stored(h)).toEqual([
        ["", "test/holds.test.ts", "current", "pass"],
        ["", "test/other.test.ts", "current", "pass"],
      ]);
      expect(reasons(h, "test/holds.test.ts")).toEqual([]);
    },
  );
});
