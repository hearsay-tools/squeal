import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { namedText } from "../../src/cli/status-wait-lines.js";
import { namedCode, waitForNamed } from "../../src/cli/status-wait-paths.js";
import { namedSnapshot } from "../../src/cli/wait/snapshot.js";
import { recordRefinedApplied } from "../../src/core/scheduler/refined.js";
import type { RevisionNumber } from "../../src/core/types/common.js";
import type { DaemonRecord } from "../../src/core/types/store-records.js";
import { appendRevisions, fakeRepo, seedStore } from "../status/helpers.js";
import { A, B, finish, NOW, repoWith } from "./status-wait-fixture.js";
import { later } from "./wait-clock.js";

/*
 * Row 023-26 (spec 023 lessons, round 3, Q7): in a large repository the
 * daemon took more than 60 s to start, and a first named wait said "no test
 * file's closure holds" of the named test file itself, which the daemon had
 * not listed yet. While the daemon has not listed the worktree's test files,
 * or the latest revision's, a named wait says only that, with the time so
 * far and the next step, never a closure or prefix statement about the path;
 * and it decides nothing before the listing, so the file it lists in time
 * gives its verdict. Listed worktrees read as before.
 */

const STARTING = "Squeal is still starting here (62 s); wait again with the same command";
const CLOSURE = /closure holds|not a file or folder|start with it|no listed test file is under/;

/** A daemon that started 62 s ago and has not listed this worktree's test files. */
const STARTED: DaemonRecord = {
  socketPath: "/tmp/squeal-starting.sock" as never,
  startedAt: (NOW - 62_000) as never,
  heartbeatAt: (NOW - 1_000) as never,
  heartbeatIntervalMs: 5_000,
  squealVersion: "0.0.0-test",
  token: "starting",
};

/** A worktree at revision 1 whose daemon, `daemon`, has listed nothing; `A` is on disk. */
function startingRepo(daemon: DaemonRecord | null = STARTED) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon,
  });
  appendRevisions(store, repo.mainId, 1, { head: null, dirty: false });
  mkdirSync(join(repo.main, "src"), { recursive: true });
  writeFileSync(join(repo.main, A), "");
  return { repo, store };
}

const synced = (revision: number): SyncState => ({
  state: "synced",
  revision: revision as RevisionNumber,
  incarnation: null,
});

function wait(root: string, paths: readonly string[], sync: () => SyncState, timeoutMs = 300) {
  const daemon = (): DaemonSync => ({ current: sync, stop: () => {} });
  return waitForNamed(root as never, paths, {
    timeoutMs,
    pollMs: 20,
    settleMs: 50,
    now: () => NOW,
    sync: daemon,
    ask: async () => [],
    promote: () => {},
  });
}

describe("a named wait while the daemon is starting (row 023-26)", () => {
  it("says only that Squeal is still starting for the unlisted named test file", async () => {
    const { repo } = startingRepo();

    const got = await wait(repo.main, [A, "src/a"], () => synced(1));

    if (got.outcome === "unavailable") throw new Error("unavailable");
    // Before this row: `unmatched` at the first read, "no test file's closure holds src/a.test.ts".
    expect(got.outcome).toBe("timeout");
    expect(namedCode(got)).toBe(3);
    const text = namedText(got, NOW);
    expect(text).toContain(STARTING);
    expect(text).not.toMatch(CLOSURE);
    // Row 011-401: the list may still grow.
    expect(got.selection.partial).toBeDefined();
    expect(got.selection.unlisted).toEqual({ revision: null, forMs: 62_000 });
  });

  it("says it whatever the daemon's sync answered", async () => {
    for (const sync of [{ state: "pending" }, { state: "unsupported" }] as SyncState[]) {
      const { repo } = startingRepo();

      const got = await wait(repo.main, [A], () => sync);

      if (got.outcome === "unavailable") throw new Error("unavailable");
      expect(got.outcome, sync.state).toBe("timeout");
      expect(namedText(got, NOW), sync.state).toContain(STARTING);
      expect(namedText(got, NOW), sync.state).not.toMatch(CLOSURE);
    }
  });

  it("gives the verdict of the named test file the daemon lists before the deadline", async () => {
    const { repo, store } = startingRepo();
    let state: SyncState = synced(1);
    later(150, () => {
      appendRevisions(store, repo.mainId, 4, { head: null, dirty: false });
      finish(store, repo.mainId, A);
      state = synced(4);
    });

    const got = await wait(repo.main, [A], () => state, 3_000);

    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect([got.outcome, namedCode(got)]).toEqual(["settled", 0]);
    expect(got.selection.files.map((f) => f.path)).toEqual([A]);
    expect(got.selection.unlisted).toBeUndefined();
  });

  it("does not say starting without a daemon, and still says nothing of the path", async () => {
    const { repo } = startingRepo(null);

    const got = await wait(repo.main, [A], () => ({ state: "unsupported" }));

    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect(got.outcome).toBe("no-daemon");
    const text = namedText(got, NOW);
    expect(text).toContain("Squeal has not listed the test files here yet");
    expect(text).not.toContain("still starting here");
    expect(text).not.toMatch(CLOSURE);
  });

  it("a snapshot says the listing is not done, not a closure", async () => {
    const { repo } = startingRepo();

    const got = await namedSnapshot(repo.main as never, [A], {
      now: () => NOW,
      settleMs: 0,
      sync: () => ({ current: () => synced(1), stop: () => {} }),
    });

    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect(namedText(got, NOW)).toContain("Squeal has not listed the test files here yet");
    expect(namedText(got, NOW)).not.toMatch(CLOSURE);
  });
});

describe("a named wait while the latest revision is not listed (row 023-26)", () => {
  it("names the revision and gives no prefix hint (row 011-406) for a path that is not on disk", async () => {
    const { repo, store } = repoWith([], [A, B]);
    store.revisions.append({
      worktreeId: repo.mainId,
      createdAt: NOW - 3_000,
      head: null,
      dirty: false,
      trigger: "watch",
      changes: [{ path: "src/new.test.ts", oldHash: null, newHash: "n" }] as never,
    });
    recordRefinedApplied(store, repo.mainId, 4);

    const got = await wait(repo.main, ["src/new"], () => synced(5));

    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect(got.outcome).toBe("timeout");
    const text = namedText(got, NOW);
    expect(text).toContain(
      "Squeal has not listed revision 5 here yet (3 s); wait again with the same command",
    );
    expect(text).not.toMatch(CLOSURE);
  });
});

describe("a named file created after the last listed revision (review wave-16 B2)", () => {
  /** A listed worktree at revision 4, refined, and a new test file on disk no revision records yet. */
  function newFileRepo() {
    const { repo, store } = repoWith([], [A]);
    recordRefinedApplied(store, repo.mainId, 4);
    mkdirSync(join(repo.main, "src"), { recursive: true });
    writeFileSync(join(repo.main, NEW), "");
    return { repo, store };
  }
  const NEW = "src/new.test.ts";
  const NOT_LISTED = `Squeal has not listed ${NEW} here yet`;

  it.each([{ state: "pending" }, { state: "unsupported" }] as SyncState[])(
    "says it is not listed yet and waits to the deadline, sync $state",
    async (sync) => {
      const { repo } = newFileRepo();

      const got = await wait(repo.main, [NEW], () => sync);

      if (got.outcome === "unavailable") throw new Error("unavailable");
      // Before the fix: pending said "no test file's closure holds src/new.test.ts" at the
      // deadline; unsupported returned `unmatched` after the settle time.
      expect(got.outcome).toBe("timeout");
      const text = namedText(got, NOW);
      expect(text).toContain(`${NOT_LISTED} (0 s); wait again with the same command`);
      expect(text).not.toMatch(CLOSURE);
      expect(got.selection.partial).toEqual({ revision: null });
    },
  );

  it("keeps D2's text for another path that selects nothing beside it", async () => {
    const { repo } = newFileRepo();

    const got = await wait(repo.main, [NEW, "src/none.ts"], () => synced(4));

    if (got.outcome === "unavailable") throw new Error("unavailable");
    const text = namedText(got, NOW);
    expect(text).toContain("no test file's closure holds src/none.ts");
    expect(text).toContain(NOT_LISTED);
    expect(text).not.toContain(`closure holds ${NEW}`);
  });

  it("gives the verdict once the daemon records and lists the file", async () => {
    const { repo, store } = newFileRepo();
    let state: SyncState = synced(4);
    later(150, () => {
      store.revisions.append({
        worktreeId: repo.mainId,
        createdAt: Date.now() + 1_000,
        head: null,
        dirty: false,
        trigger: "watch",
        changes: [{ path: NEW, oldHash: null, newHash: "n" }] as never,
      });
      recordRefinedApplied(store, repo.mainId, 5);
      finish(store, repo.mainId, NEW);
      state = synced(5);
    });

    const got = await wait(repo.main, [NEW], () => state, 3_000);

    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect([got.outcome, namedCode(got)]).toEqual(["settled", 0]);
    expect(got.selection.unlisted).toBeUndefined();
  });
});

describe("a listed worktree reads as before (rows 011-27, 011-406)", () => {
  it("says D2's closure text and the prefix hint for a path that selects nothing", async () => {
    const { repo } = repoWith([], [A]);

    const none = await wait(repo.main, ["src/none.ts"], () => synced(4));
    const prefix = await wait(repo.main, ["src/a"], () => synced(4));

    if (none.outcome === "unavailable" || prefix.outcome === "unavailable") {
      throw new Error("unavailable");
    }
    expect([none.outcome, prefix.outcome]).toEqual(["unmatched", "unmatched"]);
    expect(none.selection.unlisted).toBeUndefined();
    expect(namedText(none, NOW)).toContain("no test file's closure holds src/none.ts");
    expect(namedText(prefix, NOW)).toContain(
      `no test file's closure holds src/a; it is not a file or folder; 1 listed test file starts with it: ${A}; name them`,
    );
    expect(namedText(none, NOW)).not.toContain("still starting");
  });
});
