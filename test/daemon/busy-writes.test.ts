import { describe, expect, it, onTestFinished, vi } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import type { DeskEvents } from "../../src/core/daemon/desk.js";
import { daemonExitMetaKey } from "../../src/core/presence/stored.js";
import { askNoResultRun, readRetries } from "../../src/core/retry/records.js";
import { storePaths } from "../../src/core/store/paths.js";
import { holdLock } from "../status/hold-lock.js";
import { createFixtureRepo, type FixtureRepo, SLOW, withStore } from "./helpers.js";

/*
 * Spec 021 D2 (row 021-08): a socket request that writes and the
 * shutdown's writes waited the daemon's one busy timeout and, refused,
 * failed: the request with "database is locked", the shutdown without its
 * mark or with its record left. A second process holds the store's write
 * lock past that wait, shortened here so the test stays short; each now
 * lands once the holder ends.
 */

const HOLD_MS = 1_500;

const desk = vi.hoisted(() => ({ events: null as DeskEvents | null }));

vi.mock("../../src/core/daemon/open.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/daemon/open.js")>()),
  // The serving daemon's store wait: shorter than the hold.
  DAEMON_BUSY_TIMEOUT_MS: 200,
}));

vi.mock("../../src/core/daemon/desk.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/daemon/desk.js")>();
  return {
    ...actual,
    prepareFrontDesk: (...args: Parameters<typeof actual.prepareFrontDesk>) => {
      const prepared = actual.prepareFrontDesk(...args);
      return {
        ...prepared,
        open: (identity, events) => {
          desk.events = events;
          return prepared.open(identity, events);
        },
      } satisfies typeof prepared;
    },
  };
});

/** A ready daemon of a fresh fixture, stopped after the test unless the test stopped it. */
async function ready(): Promise<{ repo: FixtureRepo; stop: () => Promise<unknown> }> {
  const repo = createFixtureRepo();
  onTestFinished(repo.cleanup);
  const daemon = await startDaemon({ root: repo.root, env: repo.env });
  if ("reason" in daemon) throw new Error(daemon.message);
  onTestFinished(async () => {
    await daemon.stop("stop-requested");
  });
  await daemon.ready;
  return { repo, stop: () => daemon.stop("stop-requested") };
}

describe("the daemon's writes on a busy store (spec 021 D2)", SLOW, () => {
  it("answers a squeal retry, whose take claims the request, once the holder ends", async () => {
    const { repo } = await ready();
    const take = desk.events?.requestRetries;
    if (take === undefined) throw new Error("the daemon's desk takes no squeal retry");
    // A request to run a file with no result once at its key, as `squeal retry` stores it.
    withStore(repo, (store) => {
      const row = store.testFileKeys
        .list(repo.worktreeId)
        .find((r) => r.testFile.path === "test/math.test.ts");
      if (row?.key == null) throw new Error("test/math.test.ts has no key");
      askNoResultRun(store, {
        testFile: row.testFile,
        key: row.key,
        session: "s1",
        reason: "environment",
        at: Date.now(),
        worktreeId: repo.worktreeId,
      });
    });
    const holder = await holdLock(storePaths(repo.commonDir).database, "immediate", HOLD_MS);
    try {
      await take();
      const claimed = withStore(repo, (store) => readRetries(store).map((r) => r.claim));
      expect(claimed).toMatchObject([{ worktreeId: repo.worktreeId }]);
    } finally {
      holder.child.kill("SIGKILL");
    }
  });

  it("marks its shutdown and clears its record once the holder ends", async () => {
    const { repo, stop } = await ready();
    const holder = await holdLock(storePaths(repo.commonDir).database, "immediate", HOLD_MS);
    try {
      await stop();
      const stored = withStore(repo, (store) => ({
        mark: store.meta.get(daemonExitMetaKey(repo.worktreeId)),
        daemon: store.worktrees.get(repo.worktreeId)?.daemon ?? null,
      }));
      expect(stored.mark).not.toBeNull();
      expect(stored.daemon).toBeNull();
    } finally {
      holder.child.kill("SIGKILL");
    }
  });
});
