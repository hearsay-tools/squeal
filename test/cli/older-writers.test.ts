import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { selectNamedFiles } from "../../src/cli/named-selection.js";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { readHeld, startView } from "../../src/cli/status-wait-held.js";
import { StoredClosures } from "../../src/cli/stored-closures.js";
import { type Every, readEvery } from "../../src/cli/wait/every-state.js";
import { readTransaction } from "../../src/core/store/store.js";
import { registerUnclaimed } from "./closure-trust.js";
import { asThisRelease, olderClosure, olderState } from "./older-writer.js";
import {
  ALL,
  HELPER_READERS,
  keys,
  storeClosures as putClosures,
  READERS,
  START,
  TYPES,
} from "./source-path-fixture.js";
import { A, ADDS, answering, B, fail, options, repoWith } from "./status-wait-fixture.js";

/*
 * Review 0.1.489, B1: a reader keeps what it read only while nothing it
 * kept was written since, whoever wrote it. Two sequences of a release
 * before rows 011-44 and 011-45, which runs no marker code:
 *
 * (a) its daemon registers on another worktree, writes a recovered state and
 *     a closure that adds the source path, and clears its registration
 *     before the next read;
 * (b) its `squeal code` gate writes through `storeResults` with no daemon.
 *
 * After each, the kept read equals a full read, with other work pending.
 */

const saved = { ...process.env };
let runtimeDir: string;
beforeEach(() => {
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});
afterEach(() => {
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/**
 * W (the wait's, its daemon registered) has A's `adds` failing and B
 * pending; X shares the store with no daemon. Every closure is W's, and
 * W lists every test file of the source-path fixture.
 */
function worktrees() {
  const { repo, store } = repoWith([B], [A]);
  fail(store, repo.mainId, ADDS);
  const x = repo.addWorktree("other");
  store.worktrees.upsert({
    id: x.id,
    root: x.root,
    commonDir: repo.commonDir,
    isMain: false,
    registeredAt: 1,
    daemon: null,
  });
  putClosures(store, ALL, repo.mainId);
  keys(store, repo.mainId, ALL, "w1");
  return { repo, store, w: repo.mainId, x };
}

type World = ReturnType<typeof worktrees>;

/** The older writer's work between two reads: (a) inside a registration of X, (b) with none. */
function olderWrites(world: World, registered: boolean, write: () => void): void {
  const { repo, store, x } = world;
  if (registered) registerUnclaimed(store, x.id, x.root, repo.commonDir);
  write();
  // A clean exit clears the registration before the reader reads again.
  if (registered) store.worktrees.setDaemon(x.id, null);
}

const SEQUENCES = [
  ["(a) an older daemon registers, writes and leaves", true],
  ["(b) an older gate writes with no daemon", false],
] as const;

describe.each(SEQUENCES)("an older writer between two reads: %s", (_name, registered) => {
  it("the fallback's kept states equal a full read: the recovery is news", () => {
    const world = worktrees();
    const { store, w } = world;
    asThisRelease(store);
    const view = startView(store.knownStates.list(w));
    const every: Every = {};
    const kept = () => readTransaction(store, () => readEvery(store, w, view, every));
    kept();
    kept();

    olderWrites(world, registered, () => olderState(store, w, "adds", "pass"));

    for (let i = 0; i < 2; i++) {
      const read = kept();
      expect(read).toEqual(readTransaction(store, () => readHeld(store, w, view, null)));
      expect(read.news).toHaveLength(1);
    }
  });

  it("a named wait's kept closures select as a full read, as the path is added and dropped", () => {
    const world = worktrees();
    const { repo, store, w } = world;
    asThisRelease(store);
    const stored = new StoredClosures();
    const kept = () =>
      readTransaction(store, () =>
        selectNamedFiles(store, w, repo.main, repo.main, [START], undefined, stored),
      );
    const full = () => selectNamedFiles(store, w, repo.main, repo.main, [START]);
    expect(kept().files).toHaveLength(READERS.length);

    const [other] = ALL.filter((p) => !READERS.includes(p));
    if (other === undefined) throw new Error("no other file");
    olderWrites(world, registered, () => olderClosure(store, other, [START, TYPES], w));
    expect(kept()).toEqual(full());
    expect(kept().files).toHaveLength(READERS.length + 1);

    const [helped] = HELPER_READERS;
    if (helped === undefined) throw new Error("no helper reader");
    olderWrites(world, registered, () => olderClosure(store, helped, [TYPES], w));
    expect(kept()).toEqual(full());
    expect(kept().files).toHaveLength(READERS.length);
  });

  it("a fallback status --wait ends on the recovery as one that reads every state", async () => {
    const ends = [];
    for (const kept of [true, false]) {
      const world = worktrees();
      const { repo, store, w } = world;
      if (kept) asThisRelease(store);
      setTimeout(
        () => olderWrites(world, registered, () => olderState(store, w, "adds", "pass")),
        150,
      );
      const sync = answering(store, w, null).sync;
      const wait = await waitForStatus(repo.main, options(sync, 3_000));
      if (wait.outcome === "unavailable") throw new Error("unavailable");
      ends.push({ outcome: wait.outcome, transitions: wait.transitions });
    }
    expect(ends[0]).toEqual({ outcome: "news", transitions: 1 });
    expect(ends[0]).toEqual(ends[1]);
  });
});
