import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { removeCommandHold } from "../../src/core/scheduler/hold-rows.js";
import { readSlowActivity } from "../../src/core/slow/state.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { hold, liveProcess, settle } from "./command-hold-fixture.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";
import { unmergeIndex } from "./merge-hold-fixture.js";

/*
 * Row 011-211 (004 D2, 013 V1; gh-78): the slow lane's Vitest instance
 * closes while its slow files are still queued, at once when a hold begins
 * and once no slow tier started for `slow.releaseMs` (60 s by default) after
 * the last slow run, so a project's `globalSetup` teardown frees what it
 * holds (either hold of 011 C9, a command's or a merge's); the next slow tier makes a new instance, which runs the setup again.
 * A pass that drains closes it as before. The fixture is `basic` in two
 * Vitest projects, as a browser suite is in cezarion: `e2e` holds the two
 * slow files and a `globalSetup` that writes a mark at setup and teardown,
 * `unit` the fast ones, so only the slow instance writes marks.
 */

const A = "test/strings.test.ts";
const B = "test/upper.test.ts";
const M = "test/math.test.ts";

const CONFIG = `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60_000,
    projects: [
      { test: { name: "unit", include: ["test/math.test.ts", "test/plain.test.ts"] } },
      {
        test: {
          name: "e2e",
          include: ["${A}", "${B}"],
          globalSetup: ["./global-setup.ts"],
        },
      },
    ],
  },
});
`;

const setupFile = (marks: string) => `import { appendFileSync } from "node:fs";

export function setup() {
  appendFileSync(${JSON.stringify(marks)}, "setup\\n");
  return () => appendFileSync(${JSON.stringify(marks)}, "teardown\\n");
}
`;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The fixture's scheduler, one slow file per tier, the slow lane on its own instance. */
async function open(releaseMs?: number) {
  const repo = createRepo();
  const marks = join(tempDir("squeal-011-211-marks-"), "marks");
  writeFileSync(join(repo.main, "vitest.config.ts"), CONFIG);
  writeFileSync(join(repo.main, "global-setup.ts"), setupFile(marks));
  git(repo.main, ["add", "-A"]);
  git(repo.main, ["commit", "-qm", "global setup"]);
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 4,
    policy: {
      ...RUN_MISSING,
      slow: { ...DEFAULT_POLICY.slow, trigger: "idle", include: [A, B], maxParallel: 1 },
    },
    slow: {
      slotDir: tempDir("squeal-011-211-slot-"),
      recheckMs: 50,
      load: () => [0],
      cpus: () => 1,
      ...(releaseMs === undefined ? {} : { releaseMs }),
    },
    runnerPartBesideRun: true,
    slowInstance: true,
  });
  const read = () =>
    existsSync(marks) ? readFileSync(marks, "utf8").split("\n").filter(Boolean) : [];
  const activity = () => readSlowActivity(store, h.worktreeId);
  return { h, marks: read, activity };
}

/** Holds every run of one of `paths` until `release`; `held` counts the runs waiting. */
function gate(h: Harness, paths: readonly string[]) {
  let release = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = { held: 0, release: () => release() };
  onTestFinished(() => release());
  const before = h.runner.beforeRun;
  h.runner.beforeRun = async (files) => {
    await before?.(files);
    if (!files.some((f) => paths.includes(f.path))) return;
    state.held += 1;
    await opened;
    state.held -= 1;
  };
  return state;
}

const slowRuns = (h: Harness) => h.runsOf(A).length + h.runsOf(B).length;
const PAIR = ["setup", "teardown"];

/**
 * One slow file ran in the agent's turn; under `slow.trigger: "idle"` the
 * other waits for the pause, its instance open (the 60 s bound unreached).
 */
async function waitingForIdle() {
  const { h, marks, activity } = await open();
  const { delivery, consumer } = await h.consumer();
  const slow = gate(h, [A, B]);
  await h.scheduler.start();
  await expect.poll(() => slow.held, { timeout: 60_000 }).toBe(1);
  await delivery.startTurn(consumer);
  slow.release();
  await expect.poll(activity, { timeout: 60_000 }).toEqual({ kind: "waiting", for: "idle" });
  expect(slowRuns(h)).toBe(1);
  await settle(500);
  expect(marks()).toEqual(["setup"]);
  return { h, marks, pause: () => delivery.endTurn(consumer) };
}

describe("the slow instance frees its environment when its lane stops (row 011-211)", SLOW, () => {
  it("a pass that drains closes it once, as before", async () => {
    const { h, marks } = await open(1_000);
    await h.scheduler.start();
    await expect.poll(marks, { timeout: 60_000 }).toEqual(PAIR);
    await h.scheduler.idle();
    expect(slowRuns(h)).toBe(2);
    expect(marks()).toEqual(PAIR);
  });

  it("a command hold closes it at once; after the hold the next slow tier runs the setup again", async () => {
    const { h, marks, pause } = await waitingForIdle();
    const entry = hold(h, (await liveProcess()).identity);
    expect(await h.scheduler.commandHold()).toBe(true);
    // Well within the 60 s bound: the hold closed it.
    await expect.poll(marks, { timeout: 5_000 }).toEqual(PAIR);

    removeCommandHold(h.store, h.worktreeId, entry.token);
    expect(await h.scheduler.commandHold()).toBe(false);
    await pause();
    await expect.poll(marks, { timeout: 60_000 }).toEqual([...PAIR, ...PAIR]);
    expect(slowRuns(h)).toBe(2);
  });

  it("a merge hold closes it too, once the scheduler reads the index; its end lets the next tier set up again", async () => {
    const { h, marks, pause } = await waitingForIdle();
    unmergeIndex(h.root, "src/math.ts");
    await expect.poll(marks, { timeout: 5_000 }).toEqual(PAIR);

    git(h.root, ["reset", "-q"]);
    await pause();
    await expect.poll(marks, { timeout: 60_000 }).toEqual([...PAIR, ...PAIR]);
    expect(slowRuns(h)).toBe(2);
  });

  it("a slow tier that yields to an edit's fast work closes it after the bound; the next runs the setup again", async () => {
    const { h, marks, activity } = await open(1_000);
    const slow = gate(h, [A, B]);
    await h.scheduler.start();
    await expect.poll(() => slow.held, { timeout: 60_000 }).toBe(1);
    const fast = gate(h, [M]);
    h.write("src/math.ts", "export const add = (a: number, b: number) => a + b + 1;\n");
    await h.batch("src/math.ts");
    await expect.poll(() => fast.held, { timeout: 60_000 }).toBe(1);

    slow.release();
    await expect.poll(activity, { timeout: 60_000 }).toEqual({ kind: "waiting", for: "fast" });
    expect(marks()).toEqual(["setup"]);
    await expect.poll(marks, { timeout: 10_000 }).toEqual(PAIR);
    expect(fast.held).toBe(1);
    expect(slowRuns(h)).toBe(1);

    fast.release();
    await expect.poll(marks, { timeout: 60_000 }).toEqual([...PAIR, ...PAIR]);
    expect(slowRuns(h)).toBe(2);
  });
});
