import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import {
  type DaemonUsed,
  daemonUsedMetaKey,
  readDaemonUsed,
} from "../../src/core/daemon/last-use.js";
import { readHeader } from "../../src/core/delivery/index.js";
import type { AbsolutePath } from "../../src/core/types/index.js";
import { createFixtureRepo, delay, type FixtureRepo, SLOW, waitFor, withStore } from "./helpers.js";

/*
 * Spec 014 D9 (row 014-08), against a real daemon: its `daemon-used` row
 * holds the times its memory holds. Registration writes its start; a socket
 * request moves both times, as `onActivity` moves `#lastUsed` and
 * `#lastActive`; an edit moves only the use, as the unused check moves
 * `#lastUsed` alone. No consumer registers, so nothing else moves them.
 */

/** The row as `ps` reads it, against the start its daemon record holds. */
const read = (repo: FixtureRepo): DaemonUsed | null =>
  withStore(repo, (store) => {
    const startedAt = store.worktrees.get(repo.worktreeId)?.daemon?.startedAt;
    if (startedAt === undefined) return null;
    return readDaemonUsed(store.meta.get(daemonUsedMetaKey(repo.worktreeId)), startedAt);
  });

/** The row once it held one value over 6 heartbeats and checks of 50 ms. */
async function settled(repo: FixtureRepo): Promise<DaemonUsed> {
  let last = read(repo);
  let since = Date.now();
  return waitFor(
    async () => {
      await delay(50);
      const now = read(repo);
      if (JSON.stringify(now) !== JSON.stringify(last)) {
        last = now;
        since = Date.now();
        return false;
      }
      return now !== null && Date.now() - since >= 300 && now;
    },
    60_000,
    "the row settled",
  );
}

describe("a daemon records its last use with each heartbeat (spec 014 D9)", SLOW, () => {
  it("writes its start, moves both times on a request and the use alone on an edit", async () => {
    const repo = createFixtureRepo();
    onTestFinished(repo.cleanup);
    const daemon = await startDaemon({
      root: repo.root,
      env: repo.env,
      timings: { heartbeatMs: 50, checkMs: 50 },
    });
    if ("reason" in daemon) throw new Error(daemon.message);
    onTestFinished(async () => {
      await daemon.stop("stop-requested");
    });
    const startedAt = withStore(repo, (s) => s.worktrees.get(repo.worktreeId)?.daemon?.startedAt);
    expect(startedAt).toBeTypeOf("number");
    expect(read(repo)?.activeAt).toBe(startedAt);

    await daemon.ready;
    await waitFor(
      () =>
        withStore(repo, (store) => {
          const { counts } = readHeader(store, repo.worktreeId);
          return counts.current >= 5 && counts.pending === 0;
        }),
      60_000,
      "the baseline done",
    );
    const quiet = await settled(repo);

    const asked = Date.now();
    const socketPath = repo.socketPath as AbsolutePath;
    expect(await requestDaemon(socketPath, { type: "nudge" }, 2_000)).toMatchObject({ ok: true });
    const requested = await waitFor(
      () => {
        const used = read(repo);
        return used !== null && used.activeAt > quiet.activeAt && used;
      },
      30_000,
      "the request's use",
    );
    expect(requested.activeAt).toBeGreaterThanOrEqual(asked);
    expect(requested.usedAt).toBe(requested.activeAt);
    expect(await settled(repo)).toEqual(requested);

    const edited = Date.now();
    appendFileSync(join(repo.root, "src/math.ts"), "\nexport const edited = 1;\n");
    const used = await waitFor(
      () => {
        const used = read(repo);
        return used !== null && used.usedAt >= edited && used;
      },
      30_000,
      "the edit's use",
    );
    expect(used.activeAt).toBe(requested.activeAt);
  });
});
