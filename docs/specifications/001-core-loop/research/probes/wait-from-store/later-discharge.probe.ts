// Throwaway probe for research/wait-from-store.md (task 001-256). Not product code.
// The reproduction of reviews/wave-13l.md S1 (test/scheduler/later-discharge-wait.test.ts),
// answered from the store, with the boundaries of 13q S1 (count, age), 13s B2
// (an hour with no other operation) and 13t S1 (a pause, then one commit).
// Revisions: 1 and 2 warm math's cache, 3 breaks math (run held), 4 edits
// strings (runner part held); the wait captures 4.
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { waitForStatus } from "../../../../../../src/cli/status-wait.js";
import { testFileId } from "../../../../../../src/core/keys/index.js";
import {
  createRepo,
  openHarness,
  openRepoStore,
  SLOW,
} from "../../../../../../test/scheduler/helpers.js";
import { commitShadow, floodShadow, readShadow, SHADOW } from "./shadow.js";
import { type StoreSyncLog, storeSync } from "./store-sync.js";

vi.mock("../../../../../../src/core/scheduler/rekeyed-record.js", async (importOriginal) =>
  (await import("./mock.js")).shadowedRecord(importOriginal as never),
);

const MATH = "src/math.ts";
const MATH_ID = testFileId({ project: "", path: "test/math.test.ts" });
const CACHED = "export const add = (a: number, b: number) => a - b; // cached\n";
const PASSING = "export const add = (a: number, b: number) => a + b;\n";
const TARGET = "export const add = (a: number, b: number) => a - b; // target\n";
const HOUR = 60 * 60_000;

type Expect = "own" | "lost" | "fallback";

interface Case {
  readonly name: string;
  readonly cached?: boolean;
  readonly perFile?: boolean;
  readonly flood?: number;
  /** Shift the commit clock by this much while the runner part is held. */
  readonly clock?: number;
  /** Then commit once (a prune), or not. */
  readonly commit?: boolean;
  /** Control: prune by age alone (`SHADOW.ageOnly`). */
  readonly ageOnly?: boolean;
  readonly expect: Expect;
}

const CASES: Case[] = [
  { name: "13l S1: a later cached discharge", cached: true, expect: "own" },
  { name: "13l S1 control: one discharge", expect: "own" },
  {
    name: "13l S1 control: one entry per file, as open/last",
    cached: true,
    perFile: true,
    expect: "lost",
  },
  { name: "13q S1 count: 10,050 later resolved entries", flood: 10_050, expect: "own" },
  { name: "13s B2: two hours pass with no commit", clock: 2 * HOUR, expect: "own" },
  {
    name: "13q S1 age / 13t S1: past the hour, a commit while the runner part is held",
    clock: HOUR + 1,
    commit: true,
    expect: "own",
  },
  {
    name: "control: prune by age alone, past the hour, a commit while held",
    clock: HOUR + 1,
    commit: true,
    ageOnly: true,
    expect: "fallback",
  },
];

describe("later discharges from the store (13l S1, 13q S1, 13s B2, 13t S1)", () => {
  it.each(CASES)("$name", SLOW, async (c) => {
    SHADOW.perFile = c.perFile === true;
    SHADOW.ageOnly = c.ageOnly === true;
    onTestFinished(() => {
      SHADOW.perFile = false;
      SHADOW.ageOnly = false;
      SHADOW.now = () => Date.now();
    });
    const repo = createRepo();
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      runnerPartBesideRun: true,
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    h.store.worktrees.upsert({
      id: h.worktreeId,
      root: h.root,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: Date.now(),
      daemon: {
        socketPath: "/tmp/squeal-test.sock",
        startedAt: Date.now(),
        heartbeatAt: Date.now(),
        heartbeatIntervalMs: 600_000,
        squealVersion: "0.0.0-test",
      },
    });
    h.write(MATH, CACHED);
    await h.batch(MATH);
    await h.scheduler.idle();
    h.write(MATH, PASSING);
    await h.batch(MATH);
    await h.scheduler.idle();
    const mathFails = () =>
      h.store.knownStates
        .list(h.worktreeId)
        .some((state) => state.check.testPath === "test/math.test.ts" && state.outcome === "fail");
    expect(mathFails()).toBe(false);

    let releaseRun = () => {};
    const run = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    let started = () => {};
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    h.runner.beforeRun = () => {
      started();
      return run;
    };
    onTestFinished(releaseRun);
    h.write(MATH, TARGET);
    await h.batch(MATH);
    const target = h.scheduler.status().revision;
    await running;

    let releaseRefinement = () => {};
    const refinement = new Promise<void>((resolve) => {
      releaseRefinement = resolve;
    });
    onTestFinished(releaseRefinement);
    const invalidate = h.runner.invalidate;
    h.runner.invalidate = async (paths) => {
      if (paths.some((path) => path.path === "src/strings.ts")) await refinement;
      return invalidate(paths);
    };
    h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase(); // 4\n");
    await h.batch("src/strings.ts");

    const log: StoreSyncLog = { sinceSeqs: [], outcomes: [] };
    const math = () => readShadow(h.store, h.worktreeId).files[MATH_ID] ?? {};
    const sync = storeSync(
      h.store,
      h.worktreeId,
      () => h.scheduler.status().revision,
      async (upTo) => {
        releaseRun();
        await expect.poll(mathFails, { timeout: 60_000 }).toBe(true);
        // Math's revision-3 move is resolved after the wait's start.
        expect(math()[String(target)]?.seq).toBeGreaterThan(log.sinceSeqs[0] ?? 0);
        if (c.cached === true) {
          h.write(MATH, CACHED);
          await h.batch(MATH);
          expect(h.scheduler.status().revision).toBe(upTo + 1);
          // Resolved by the cached failure without a run or the held runner part.
          await expect
            .poll(() => math()[String(upTo + 1)] ?? null, { timeout: 60_000 })
            .not.toBeNull();
        }
        if (c.flood !== undefined) floodShadow(h.store, h.worktreeId, c.flood, upTo + 1);
        if (c.clock !== undefined) {
          const shift = c.clock;
          SHADOW.now = () => Date.now() + shift;
          if (c.commit === true) commitShadow(h.store, h.worktreeId);
        }
        releaseRefinement();
      },
      log,
    );

    const wait = await waitForStatus(h.root, { timeoutMs: 60_000, pollMs: 20, sync });

    expect(mathFails()).toBe(true);
    if (c.expect === "fallback") {
      // An entry resolved after the start was pruned: the answer is incomplete, never quiet.
      expect(log.outcomes).toEqual(["incomplete"]);
      expect(wait).toMatchObject({ outcome: "news", transitions: 1 });
      expect(wait).not.toHaveProperty("edit");
      return;
    }
    expect(log.outcomes).toEqual(["answered"]);
    if (c.expect === "lost") {
      // The 13l S1 failure: quiet, the edit's failure counted as another check's news.
      expect(wait).toMatchObject({
        outcome: "quiet",
        transitions: 0,
        edit: { testFiles: 2, otherTransitions: 1 },
      });
      return;
    }
    expect(wait).toMatchObject({
      outcome: "news",
      transitions: 1,
      edit: { testFiles: 3, otherTransitions: 0 },
    });
  });
});
