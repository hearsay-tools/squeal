import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { durationOf } from "../../src/core/scheduler/files.js";
import { readSlowActivity } from "../../src/core/slow/state.js";
import { DEFAULT_POLICY, type TestFileRef } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { waitFor } from "../watcher/helpers.js";
import {
  createRepo,
  type Harness,
  type HarnessOptions,
  openHarness,
  openRepoStore,
  SLOW,
} from "./helpers.js";

/*
 * Spec 004 `lessons.md` defect 17 (task 004-54): a daemon that starts after
 * an edit re-keyed the slow files, before they ran at the new key, keeps
 * their last durations. The slow-tier line names them, and D5 runs the
 * shortest first. In the `basic` fixture `test/strings.test.ts` and
 * `test/upper.test.ts` import `src/strings.ts`; here the first takes longer,
 * so shortest first runs them against their listing order.
 */

const STRINGS = "test/strings.test.ts";
const UPPER = "test/upper.test.ts";
const SLOW_FILES = [STRINGS, UPPER];

const slotDirs: string[] = [];
afterEach(() => {
  for (const dir of slotDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** One slow file at a time, under a slot directory of its own per daemon. */
function options(): HarnessOptions {
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-004-54-slot-"));
  slotDirs.push(slotDir);
  return {
    tierSize: 4,
    policy: { slow: { ...DEFAULT_POLICY.slow, include: SLOW_FILES, maxParallel: 1 } },
    slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
  };
}

const isSlow = (files: readonly TestFileRef[]) => files.some((f) => SLOW_FILES.includes(f.path));
const slowRuns = (h: Harness) => h.runner.runs.filter((run) => isSlow(run.files));

/** A first daemon has run both slow files; returns it with each file's duration from its results. */
async function ranOnce() {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  const first = await openHarness(repo.main, store, repo.commonDir, options());
  first.write(
    STRINGS,
    [
      'import { expect, it } from "vitest";',
      'import { upper } from "../src/strings.ts";',
      "",
      'it("uppercases", async () => {',
      "  await new Promise((resolve) => setTimeout(resolve, 400));",
      '  expect(upper("a")).toBe("A");',
      "});",
      "",
    ].join("\n"),
  );
  git(repo.main, ["commit", "-qam", "slower strings"]);
  await first.scheduler.start();
  await waitFor(() => slowRuns(first).length === 2, 60_000);
  await first.scheduler.idle();
  const durations = new Map(
    SLOW_FILES.map((path) => [path, durationOf(store.results.byKey(first.keyOf(path), 0))]),
  );
  expect(durations.get(STRINGS)).toBeGreaterThan(durations.get(UPPER) ?? Number.POSITIVE_INFINITY);
  return { repo, store, first, durations };
}

/** The edit that moves both slow files' keys. */
async function rekey(first: Harness) {
  const before = SLOW_FILES.map((path) => first.keyOf(path));
  first.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase(); // edited\n");
  await first.batch("src/strings.ts");
  return before;
}

/** The second daemon's slow runs, each with the duration its slow-tier activity named. */
async function restart(repo: ReturnType<typeof createRepo>, store: Harness["store"]) {
  const second = await openHarness(repo.main, store, repo.commonDir, options());
  const named: { path: string; lastDurationMs: number | null }[] = [];
  second.runner.beforeRun = (files) => {
    if (!isSlow(files)) return;
    const activity = readSlowActivity(store, second.worktreeId);
    named.push({
      path: files[0]?.path ?? "",
      lastDurationMs: activity?.kind === "running" ? activity.lastDurationMs : null,
    });
  };
  await second.scheduler.start();
  await waitFor(() => named.length === 2, 60_000);
  await second.scheduler.idle();
  return named;
}

describe("a restarted daemon keeps the slow files' last durations across a key move", SLOW, () => {
  it("after a kill during the slow tier at the new keys: the line names them, shortest first", async () => {
    const { repo, store, first, durations } = await ranOnce();
    let reached = () => {};
    const atRun = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The first daemon starts its slow tier at the new keys and never records it, as a kill leaves it.
    first.runner.beforeRun = async (files) => {
      if (!isSlow(files)) return;
      reached();
      await held;
    };
    const before = await rekey(first);
    await atRun;
    expect(SLOW_FILES.map((path) => first.keyOf(path))).not.toEqual(before);

    try {
      const named = await restart(repo, store);
      expect(named).toEqual([
        { path: UPPER, lastDurationMs: durations.get(UPPER) },
        { path: STRINGS, lastDurationMs: durations.get(STRINGS) },
      ]);
    } finally {
      release();
    }
  });

  it("after a graceful stop with the slow files pending at the new keys: the same", async () => {
    const { repo, store, first, durations } = await ranOnce();
    // A consumer in a turn holds the slow tier, so the new keys are stored and never run.
    const { delivery, consumer } = await first.consumer();
    await delivery.startTurn(consumer);
    const before = await rekey(first);
    await first.scheduler.idle();
    expect(SLOW_FILES.map((path) => first.keyOf(path))).not.toEqual(before);
    expect(slowRuns(first)).toHaveLength(2);
    await first.scheduler.close();
    await delivery.endTurn(consumer);

    const named = await restart(repo, store);
    expect(named).toEqual([
      { path: UPPER, lastDurationMs: durations.get(UPPER) },
      { path: STRINGS, lastDurationMs: durations.get(STRINGS) },
    ]);
  });
});
