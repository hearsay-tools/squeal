import { describe, expect, it } from "vitest";
import {
  ObservedSets,
  observedMetaKey,
  observedStartupMetaKey,
} from "../../src/core/keys/index.js";
import type { Policy } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpRepo,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { SLOW } from "./helpers.js";
import { ignoring, type Observing, observing } from "./one-write-path-fixture.js";

/*
 * Spec 016 D4: what a runner reports in `RunReport.observed` and
 * `environmentObserved` reaches the store only through the core. A
 * git-ignored path is kept unless the run wrote one of its ancestor
 * directories (the written-directory bound); module loads key whatever
 * `observe.runtimeInputs` says (O8); start-up paths are kept per project and
 * join the environment after a restart.
 */

const A = "test/a.test.ts";
const REF_A = { project: "", path: A };
const FILES: readonly CatchUpFile[] = [{ path: A, ms: 100, imports: [] }];
const BOOT = "setup/boot.mjs";

function open(repo: CatchUpRepo, what: Observing, policy: Partial<Policy> = {}) {
  const side = catchUpSide(repo, repo.main, {
    files: FILES,
    hostSlots: 4,
    policy: { ...RUN_MISSING, ...policy },
  });
  observing(side, what);
  return side;
}

const stored = (side: { store: { meta: { get(key: string): string | null } } }, key: string) =>
  JSON.parse(side.store.meta.get(key) ?? "null") as unknown;

describe("scheduler: one write path for observed paths (016 D4)", SLOW, () => {
  it("keeps a git-ignored path and drops one below a directory the run created", async () => {
    const repo = catchUpRepo(FILES);
    ignoring(repo, ["dist/", ".tmp/"], { "dist/x.json": "1\n", ".tmp/u1/y.txt": "y\n" });
    const side = open(repo, {
      observed: {
        [A]: { paths: [".tmp/u1/y.txt", "dist/x.json"], directories: [], written: [".tmp/u1"] },
      },
    });
    await side.scheduler.start();
    await side.scheduler.idle();
    expect(stored(side, observedMetaKey(""))).toEqual({ [A]: ["dist/x.json"] });
    expect(side.current(A)).toBe(true);

    // The kept path keys the file: its edit runs it again.
    const before = side.runner.runsOf(A).length;
    await side.edit("watch", "dist/x.json");
    await side.scheduler.idle();
    expect(side.runner.runsOf(A).length).toBe(before + 1);
    expect(side.current(A)).toBe(true);
  });

  it("keys module loads with observe.runtimeInputs off, and drops other runners' reads", async () => {
    const off = { observe: { runtimeInputs: false } };
    const loads = catchUpRepo(FILES, ["lib/x.mjs"]);
    const a = open(
      loads,
      { observed: { [A]: { paths: ["lib/x.mjs"], directories: [] } }, loads: true },
      off,
    );
    await a.scheduler.start();
    await a.scheduler.idle();
    expect(stored(a, observedMetaKey(""))).toEqual({ [A]: ["lib/x.mjs"] });
    const before = a.runner.runsOf(A).length;
    await a.edit("watch", "lib/x.mjs");
    await a.scheduler.idle();
    expect(a.runner.runsOf(A).length).toBe(before + 1);

    const reads = catchUpRepo(FILES, ["lib/x.mjs"]);
    const b = open(reads, { observed: { [A]: { paths: ["lib/x.mjs"], directories: [] } } }, off);
    await b.scheduler.start();
    await b.scheduler.idle();
    expect(stored(b, observedMetaKey(""))).toBeNull();
  });

  it("keeps start-up paths per project, and keys the environment with them after a restart", async () => {
    const repo = catchUpRepo(FILES, [BOOT]);
    const what = { startup: { "": [BOOT] }, loads: true };
    const first = open(repo, what);
    await first.scheduler.start();
    await first.scheduler.idle();
    expect(stored(first, observedStartupMetaKey(""))).toEqual([BOOT]);
    // Its key lacked the path the run loaded: it ran again under the key that holds it (003-43).
    expect(first.runner.runsOf(A)).toHaveLength(2);
    await first.scheduler.close();

    const restarted = open(repo, what);
    await restarted.scheduler.start();
    await restarted.scheduler.idle();
    expect(restarted.runner.runs).toEqual([]);
    expect(restarted.current(A)).toBe(true);
    await restarted.edit("watch", BOOT);
    await restarted.scheduler.idle();
    expect(restarted.runner.runsOf(A)).toHaveLength(1);
  });

  // Moved from test/runners/node-test/adapter-shared.test.ts (review wave 2, S2) by 016 D4.
  it("re-keys a file at the next revision of a daemon that started before another worktree observed its path", async () => {
    const repo = catchUpRepo(FILES, ["lib/x.mjs", "notes.md"]);
    const b = catchUpSide(repo, repo.other, { files: FILES, hostSlots: 4, policy: RUN_MISSING });
    observing(b, { loads: true });
    await b.scheduler.start();
    await b.scheduler.idle();
    expect(b.runner.runsOf(A)).toHaveLength(1);

    // A runs its edited copy, whose run loads lib/x.mjs, and stores the path.
    const a = open(repo, {
      observed: { [A]: { paths: ["lib/x.mjs"], directories: [] } },
      loads: true,
    });
    await a.scheduler.start();
    await a.scheduler.idle();
    await a.edit("watch", A);
    await a.scheduler.idle();
    expect(stored(a, observedMetaKey(""))).toEqual({ [A]: ["lib/x.mjs"] });

    // B's next revision, whatever it changed, re-keys the file with the path, which runs it.
    await b.edit("watch", "notes.md");
    await b.scheduler.idle();
    expect(b.runner.runsOf(A)).toHaveLength(2);
    // Once: the next revision finds nothing new.
    await b.edit("watch", "notes.md");
    await b.scheduler.idle();
    expect(b.runner.runsOf(A)).toHaveLength(2);
    // From then on B's edits of the path run the file.
    await b.edit("watch", "lib/x.mjs");
    await b.scheduler.idle();
    expect(b.runner.runsOf(A)).toHaveLength(3);
  });

  it("keys a start-up path the record's rolled-back transaction did not store, and stores it next", async () => {
    const repo = catchUpRepo(FILES, [BOOT]);
    const side = open(repo, { startup: { "": [BOOT] }, loads: true });
    const { meta } = side.store;
    const set = meta.set.bind(meta);
    let thrown = 0;
    meta.set = (key, value) => {
      if (key === observedStartupMetaKey("") && thrown === 0) {
        thrown += 1;
        throw new Error("injected: the record's transaction fails");
      }
      set(key, value);
    };
    await side.scheduler.start();
    await side.scheduler.idle();
    expect(thrown).toBe(1);
    // The transaction rolled back: the store holds no row, while this worktree's view keys the path.
    expect(side.store.meta.get(observedStartupMetaKey(""))).toBeNull();

    // The next batch resumes the pump; the next record stores what the view holds.
    await side.edit("watch", A);
    await side.scheduler.idle();
    expect(stored(side, observedStartupMetaKey(""))).toEqual([BOOT]);
    expect(side.current(A)).toBe(true);
    const before = side.runner.runsOf(A).length;
    await side.edit("watch", BOOT);
    await side.scheduler.idle();
    expect(side.runner.runsOf(A).length).toBe(before + 1);
  });

  // Row 016-29: the observed paths take the start-up paths' write rule.
  describe("an observed path the record's rolled-back transaction did not store", () => {
    const what = { observed: { [A]: { paths: ["lib/x.mjs"], directories: [] } }, loads: true };

    /** A side whose first record's write of the observed paths throws, after that record. */
    async function rolledBack(repo: CatchUpRepo) {
      const side = open(repo, what);
      const { meta } = side.store;
      const set = meta.set.bind(meta);
      let thrown = 0;
      meta.set = (key, value) => {
        if (key === observedMetaKey("") && thrown === 0) {
          thrown += 1;
          throw new Error("injected: the record's transaction fails");
        }
        set(key, value);
      };
      await side.scheduler.start();
      await side.scheduler.idle();
      expect(thrown).toBe(1);
      expect(side.store.meta.get(observedMetaKey(""))).toBeNull();
      // The invariant in the window: no result is stored at a key with the path the store lacks.
      expect(side.store.results.newestForTestFile(REF_A)).toEqual([]);
      return side;
    }

    it("is stored at the next record", async () => {
      const repo = catchUpRepo(FILES, ["lib/x.mjs"]);
      const side = await rolledBack(repo);

      // The next record stores what this worktree's view keys, though its run adds nothing new.
      await side.edit("watch", A);
      await side.scheduler.idle();
      expect(stored(side, observedMetaKey(""))).toEqual({ [A]: ["lib/x.mjs"] });
      expect(side.current(A)).toBe(true);
      // The invariant after it: a daemon that keys from the store alone finds the stored result.
      await side.scheduler.close();
      const restarted = open(repo, what);
      await restarted.scheduler.start();
      await restarted.scheduler.idle();
      expect(restarted.runner.runs).toEqual([]);
      expect(restarted.current(A)).toBe(true);
      await restarted.edit("watch", "lib/x.mjs");
      await restarted.scheduler.idle();
      expect(restarted.runner.runsOf(A)).toHaveLength(1);
    });

    it("is not keyed by a daemon restarted before the next record, which runs the file", async () => {
      const repo = catchUpRepo(FILES, ["lib/x.mjs"]);
      const side = await rolledBack(repo);
      await side.scheduler.close();

      // The restarted view is the stored one: it lacks the path, so no key holds it and A runs.
      const restarted = open(repo, what);
      expect(new ObservedSets(restarted.store).of(REF_A)).toEqual([]);
      await restarted.scheduler.start();
      await restarted.scheduler.idle();
      expect(restarted.runner.runsOf(A).length).toBeGreaterThan(0);
      expect(stored(restarted, observedMetaKey(""))).toEqual({ [A]: ["lib/x.mjs"] });
      expect(restarted.current(A)).toBe(true);
    });
  });
});
