import { describe, expect, it, onTestFinished, vi } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import type { DeskEvents } from "../../src/core/daemon/desk.js";
import type { Held } from "../../src/core/daemon/run-group.js";
import { storePaths } from "../../src/core/store/paths.js";
import { longestGap, type ThreadLockHolder, threadLockHolder } from "../helpers/busy-store.js";
import { createFixtureRepo, type FixtureRepo, SLOW } from "./helpers.js";

/*
 * Review 0.1.434, B2 (spec 021 D2, row 021-08): a socket request waited
 * for a free store and then made its own write with the store's one wait;
 * a writer that took the lock in between failed it ("database is locked")
 * or stopped the daemon's event loop until it let go. Another thread takes
 * the write lock here as the request's own task takes the scheduler's
 * lock, after any such check: the request is answered once the holder
 * ends, the event loop runs between its tries, and a request still refused
 * when the daemon stops answers with a busy error. The scheduler's own
 * tests cover `squeal retry` and `run --all` (`test/scheduler/busy-requests.test.ts`).
 */

const HOLD_MS = 1_500;
/** The longest the event loop may stop while a request waits: a slice, a backoff, and load. */
const GAP_MS = 750;

const desk = vi.hoisted(() => ({ events: null as DeskEvents | null }));

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

/** A ready daemon of a fresh fixture, stopped after the test. */
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

/**
 * `held` for a `squeal run <group>` request (row 011-302): told each holder
 * of the scheduler's lock, at once before its task runs, it takes
 * `holder`'s lock when the request's own task takes the scheduler's, after
 * any check the daemon made before.
 */
function takeWhenHeld(holder: ThreadLockHolder, group: string): Held {
  const operation = `taking a squeal run ${group} request`;
  return (by) => {
    if (!holder.taken && by?.kind === "scheduler" && by.operation === operation) holder.take();
  };
}

describe("a socket request whose own write meets a busy store (review 0.1.434 B2)", SLOW, () => {
  it("answers squeal run tests once the holder ends, the event loop running meanwhile", async () => {
    const { repo } = await ready();
    const request = desk.events?.requestGroup;
    if (request === undefined) throw new Error("the daemon's desk takes no squeal run <group>");
    const holder = threadLockHolder(storePaths(repo.commonDir).database, HOLD_MS);

    const answer = request("tests", takeWhenHeld(holder, "tests"));
    const gap = await longestGap(answer);

    expect(holder.taken).toBe(true);
    expect(holder.released).toBe(true);
    expect(await answer).toMatchObject({ queued: expect.any(Number) });
    expect(gap).toBeLessThan(GAP_MS);
  });

  it("answers a request still refused when the daemon stops with a busy error", async () => {
    const { repo, stop } = await ready();
    const request = desk.events?.requestGroup;
    if (request === undefined) throw new Error("the daemon's desk takes no squeal run <group>");
    // Held past the stop and the shutdown's own tries.
    const holder = threadLockHolder(storePaths(repo.commonDir).database, 30_000);

    const answer = request("tests", takeWhenHeld(holder, "tests"));
    await expect.poll(() => holder.taken).toBe(true);
    void stop();

    await expect(answer).rejects.toThrow(/the store was still busy when the daemon stopped/);
    expect(holder.released).toBe(false);
  });
});
