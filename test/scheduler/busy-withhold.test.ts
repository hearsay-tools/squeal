import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readDaemonNotes } from "../../src/core/notes.js";
import { rekeyEnvironments } from "../../src/core/scheduler/environment-growth.js";
import { readMergeHold } from "../../src/core/scheduler/hold-rows.js";
import { prepareObserved } from "../../src/core/scheduler/observed.js";
import type { TestCheckId } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { busyWaits, busyWrite } from "./busy-fixture.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";
import { unmergeIndex } from "./merge-hold-fixture.js";

/*
 * Row 011-128 (review 0.1.273-r2, N2; 011 C9): a record that a busy store
 * held back counted its completion barrier's withholds when it prepared,
 * before a merge hold that began during the wait kept a file out of
 * storage. A merge-held withhold counts toward no withhold limit, so the
 * file's next withhold at the key after the hold came one run early or one
 * run late. Now the count changes only when the write lands, and only for
 * the files the hold leaves free then.
 */

vi.mock("../../src/core/scheduler/environment-growth.js", async (actual) => {
  const real = await actual<typeof import("../../src/core/scheduler/environment-growth.js")>();
  return { ...real, rekeyEnvironments: vi.fn(real.rekeyEnvironments) };
});
vi.mock("../../src/core/scheduler/observed.js", async (actual) => {
  const real = await actual<typeof import("../../src/core/scheduler/observed.js")>();
  return { ...real, prepareObserved: vi.fn(real.prepareObserved) };
});

const MATH = "test/math.test.ts";
const adds: TestCheckId = { kind: "test", project: "", testPath: MATH, fullName: "adds" };

const notes = (h: Harness) => readDaemonNotes(h.store, h.worktreeId).map((note) => note.text);

/** Rewrites `paths` with their own bytes as the `at`-th runs (from 1) of `MATH` start. */
function touchAt(h: Harness, at: readonly number[], paths: readonly string[]): void {
  let started = 0;
  h.runner.beforeRun = (files) => {
    if (!files.some((f) => f.path === MATH)) return;
    started += 1;
    if (!at.includes(started)) return;
    for (const path of paths) h.write(path, readFileSync(join(h.root, path), "utf8"));
  };
}

async function harness(tierSize: number): Promise<Harness> {
  const { main, commonDir } = createRepo();
  const h = await openHarness(main, openRepoStore(commonDir), commonDir, {
    busyWaits: busyWaits(),
    busySliceMs: 50,
    tierSize,
    policy: RUN_MISSING,
  });
  await h.scheduler.start();
  await h.scheduler.idle();
  return h;
}

/**
 * The `nth` record's write from now on gives up on a busy store, and while
 * it waits `path` becomes unmerged and an interval pass reads the index:
 * the merge hold begins during the wait.
 */
async function holdDuringBusyWrite(
  h: Harness,
  path: string,
  nth: number,
  edit: () => Promise<void>,
): Promise<void> {
  let held: Promise<void> | null = null;
  const restore = busyWrite(
    h.store,
    () => {
      unmergeIndex(h.root, path);
      held = h.scheduler.handleBatch({ trigger: "interval", paths: [] });
    },
    nth,
  );
  try {
    await edit();
    await expect.poll(() => held, { timeout: 30_000 }).not.toBeNull();
    await held;
    await h.scheduler.idle();
    expect(readMergeHold(h.store, h.worktreeId, 0)?.paths).toEqual([path]);
  } finally {
    restore();
  }
}

/** `git add` ends the hold; the held file runs once it does. */
async function endHold(h: Harness, path: string): Promise<void> {
  git(h.root, ["add", path]);
  await expect
    .poll(() => readMergeHold(h.store, h.worktreeId, 0)?.paths ?? null, { timeout: 10_000 })
    .toBeNull();
  await expect.poll(() => pendingOf(h, MATH), { timeout: 30_000 }).toBeNull();
  await h.scheduler.idle();
}

const pendingOf = (h: Harness, path: string) =>
  h.store.testFileKeys.list(h.worktreeId).find((r) => r.testFile.path === path)?.pending;

/** The results stored at `path`'s current key. */
const storedAt = (h: Harness, path: string) => {
  const key = h.store.testFileKeys.list(h.worktreeId).find((r) => r.testFile.path === path)?.key;
  return key === null || key === undefined ? [] : h.store.results.byKey(key, 0);
};

const EDIT = "export const add = (a: number, b: number) => b + a;\n";

describe(
  "a busy record's withholds and a merge hold that begins during its wait (row 011-128)",
  SLOW,
  () => {
    it("counts no withhold for the held file: its next withhold at the key is its first", async () => {
      const h = await harness(1);
      const before = h.runsOf(MATH).length;
      touchAt(h, [1, 2], ["src/math.ts"]);
      await holdDuringBusyWrite(h, "src/math.ts", 1, async () => {
        h.write("src/math.ts", EDIT);
        await h.batch("src/math.ts");
      });
      expect(h.runsOf(MATH).length - before).toBe(1);
      expect(pendingOf(h, MATH)).toBe("queued");
      expect(storedAt(h, MATH)).toEqual([]);
      expect(notes(h)).toEqual([]);

      await endHold(h, "src/math.ts");
      // The run after the hold is withheld at the same key, its first withhold there: it runs once more.
      expect(h.runsOf(MATH).length - before).toBe(3);
      expect(h.sink.stateOf(adds)).toMatchObject({ outcome: "pass", validity: "current" });
      expect(notes(h)).toEqual([
        expect.stringMatching(
          /src\/math\.ts was written while test\/math\.test\.ts ran.*runs once more/,
        ),
      ]);
    });

    it("clears no withhold for the held file: its next withhold at the key is its second", async () => {
      const h = await harness(1);
      const before = h.runsOf(MATH).length;
      // The first run is withheld; the second, untouched, is held as its write waits; the third is withheld.
      touchAt(h, [1, 3], ["src/math.ts"]);
      await holdDuringBusyWrite(h, "src/math.ts", 2, async () => {
        h.write("src/math.ts", EDIT);
        await h.batch("src/math.ts");
      });
      expect(h.runsOf(MATH).length - before).toBe(2);
      expect(pendingOf(h, MATH)).toBe("queued");

      await endHold(h, "src/math.ts");
      // The run after the hold is withheld at the same key, the second in a row there: it stays unknown.
      expect(h.runsOf(MATH).length - before).toBe(3);
      expect(storedAt(h, MATH)).toEqual([]);
      expect(h.sink.stateOf(adds)).toMatchObject({ validity: "unknown" });
      expect(notes(h).filter((text) => text.includes("stays unknown"))).toEqual([
        expect.stringMatching(
          /src\/math\.ts was written during 2 runs in a row of test\/math\.test\.ts/,
        ),
      ]);
    });

    it("counts another file's withhold once over the retry and prepares the record once", async () => {
      const h = await harness(4);
      vi.mocked(rekeyEnvironments).mockClear();
      vi.mocked(prepareObserved).mockClear();
      const beside = ["test/strings.test.ts", "test/upper.test.ts"];
      const files = [MATH, ...beside];
      const runs = () => files.map((path) => h.runsOf(path).length);
      const before = runs();
      const tiers = h.runner.runs.length;
      touchAt(h, [1], ["src/math.ts", "src/strings.ts"]);
      await holdDuringBusyWrite(h, "src/math.ts", 1, async () => {
        h.write("src/math.ts", EDIT);
        h.write("src/strings.ts", `${readFileSync(join(h.root, "src/strings.ts"), "utf8")}\n`);
        await h.batch("src/math.ts", "src/strings.ts");
      });
      // No tier starts while the hold holds: the withheld files wait for its end beside the held one.
      expect(runs().map((n, i) => n - (before[i] ?? 0))).toEqual([1, 1, 1]);
      expect(files.map((path) => pendingOf(h, path))).toEqual(["queued", "queued", "queued"]);
      // The withhold names only the files the hold left free, and the path that barred them.
      const withheld = notes(h).map((text) => / was written while (.*) ran and ended/.exec(text));
      expect(withheld).toHaveLength(1);
      expect(withheld[0]?.input.startsWith("squeal: src/strings.ts was written")).toBe(true);
      expect(withheld[0]?.[1]?.split(", ").sort()).toEqual(beside);

      await endHold(h, "src/math.ts");
      // Their withhold was each one's first at the key, counted once: each ran once more and is current.
      expect(runs().map((n, i) => n - (before[i] ?? 0))).toEqual([2, 2, 2]);
      expect(files.map((path) => pendingOf(h, path))).toEqual([null, null, null]);
      expect(h.sink.stateOf(adds)).toMatchObject({ outcome: "pass", validity: "current" });
      expect(notes(h).filter((text) => text.includes("stays unknown"))).toEqual([]);
      // Each record, the first tried twice, re-keyed environments and hashed observations once.
      const reports = (calls: readonly (readonly unknown[])[]) => calls.map((call) => call[1]);
      const recorded = h.runner.runs.slice(tiers).map((run) => run.report);
      expect(reports(vi.mocked(rekeyEnvironments).mock.calls)).toEqual(recorded);
      expect(reports(vi.mocked(prepareObserved).mock.calls)).toEqual(recorded);
    });
  },
);
