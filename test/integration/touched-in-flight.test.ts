import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { MAX_DISCARDS } from "../../src/core/scheduler/ledger.js";
import { type Harness, openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";
import {
  BASE,
  createRepo,
  scheduledRuns,
  slowOptions,
  stored,
  withheldByBarrier,
  withSlowLanes,
} from "./stamps-repo.js";

/*
 * Task 001-159: a touch heard while a run is in flight. When something else
 * wrote the file, the run may have read its other bytes from any cache, so
 * none of its files is stored. When the completion barrier withholds it
 * too, no revision follows, so the files run once more with a note naming
 * the file (task 007-30). A file the run writes itself on every run counts
 * too (review wave-13e B1, task 001-168): each withheld run is queued
 * again, counted toward `MAX_DISCARDS` (issue 10, task 011-06), and at the
 * limit its files are unknown with a reason that names the file, as task
 * 001-146 does for a file that moved during a run. An unknown file has no
 * stored state.
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

const reason = (path: string) =>
  new RegExp(`${path} was written during this run and ended as it was.*task 001-159`);

/** The reasons `markUnknown` stored for `path`. */
const reasons = (h: Harness, path: string) =>
  h.sink
    .callsOf("markUnknown")
    .filter((call) => call.testFiles.some((f) => f.path === path))
    .map((call) => call.reason);

describe("a touch heard during a run (task 001-159)", () => {
  it.each([true, false])(
    "stores none of the run's files when another wrote it (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo(files(false));
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        tierSize: 4,
        runnerPartBesideRun: true,
        observe,
      });
      const runs = scheduledRuns(h);
      await touchDuringRun(h, "src/mod.ts", true);

      // What is stored is the run once more's, on the bytes on disk (task 007-30).
      expect(stored(h)).toEqual([
        ["", "test/holds.test.ts", "current", "pass"],
        ["", "test/other.test.ts", "current", "pass"],
      ]);
      withheldByBarrier(h, runs, "test/holds.test.ts");
      withheldByBarrier(h, runs, "test/other.test.ts");
    },
  );

  // Spec 004 D2: the slow instance hears it at once, not before its next run.
  it("stores none of a slow run's files", SLOW, async () => {
    const repo = createRepo(files(false));
    const { slotDir, ...options } = slowOptions(["test/holds.test.ts", "test/other.test.ts"]);
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      ...options,
      runnerPartBesideRun: true,
    });
    const lanes = withSlowLanes(h, repo.main, slotDir, async () => {});
    const runs = scheduledRuns(h);
    await touchDuringRun(h, "src/mod.ts", true);

    // Spec 004 D2 as amended (004-34): an idle slow tier takes up to `slow.maxParallel` files,
    // so both ran in the one slow run that heard the touch, then once more (task 007-30).
    expect(lanes.made()).toBe(1);
    expect(runs.filter((run) => run.files.length === 2)).toHaveLength(2);
    expect(stored(h)).toEqual([
      ["", "test/holds.test.ts", "current", "pass"],
      ["", "test/other.test.ts", "current", "pass"],
    ]);
    withheldByBarrier(h, runs, "test/holds.test.ts");
    withheldByBarrier(h, runs, "test/other.test.ts");
  });
});

describe("a test file that rewrites a worktree file with its own bytes on every run", () => {
  // Review wave-13e B1: writing the bytes proves nothing about what a cache served the run, so
  // its own touch withholds it like any other (task 001-168). The skill's reports reference
  // names the remedy: write outside the worktree or under an ignored path, or declare the file.
  // Task 011-06: each withheld run is queued again, so its touch is heard during every run.
  it.each([true, false])(
    "is unknown with a reason naming the file when its touch is heard during each run (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo(files(true));
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        tierSize: 4,
        runnerPartBesideRun: true,
        observe,
      });
      await touchDuringRun(h, "fixtures/data.txt", false, MAX_DISCARDS);
      expect(h.runsOf("test/holds.test.ts")).toHaveLength(MAX_DISCARDS);
      expect(stored(h)).toEqual([]);
      expect(reasons(h, "test/holds.test.ts")).toEqual([
        expect.stringMatching(reason("fixtures/data.txt")),
      ]);
    },
  );
});
