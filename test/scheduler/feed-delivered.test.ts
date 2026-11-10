import { utimesSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDaemonLoop } from "../../src/core/daemon-loop/index.js";
import { headerLines } from "../../src/core/delivery/header.js";
import { readLiveHeader } from "../../src/core/delivery/liveness.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { feedDeliveredMetaKey, readFeedDelivered } from "../../src/core/presence/stored.js";
import { formatStatus } from "../../src/core/status/format-status.js";
import { readStatus } from "../../src/core/status/snapshot.js";
import { storePaths } from "../../src/core/store/paths.js";
import { timeText } from "../../src/core/text.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import type { WatcherBackend, WatchListener } from "../../src/core/types/watcher.js";
import { statusText } from "../../src/harness/shared/text.js";
import { createVitestAdapter } from "../../src/runners/vitest/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { waitFor } from "../watcher/helpers.js";
import { SLOW } from "./cleanup.js";
import { RecordingSink } from "./recording-sink.js";
import { createRepo, openRepoStore } from "./repo.js";

/*
 * Row 011-200 through the daemon loop: the feed hands each delivered batch's start to the store,
 * a watch batch's too, so steady hints keep status quiet without an idle pass; a feed held past
 * 60 s makes status and the headers name the lag.
 */

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("the feed's last delivery, stored by the daemon loop (011-200)", SLOW, () => {
  it("90 s of hints that change no content leave status and the headers as they were; a held feed is named", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const root = repo.main;
    const worktreeId = worktreeIdFor(root);
    const runner = await createVitestAdapter({ root });
    const watch: { listener: WatchListener | null } = { listener: null };
    // Reports only what the test pushes; the idle pass is ten minutes away.
    const backend: WatcherBackend = {
      name: "chokidar",
      watch: async (_spec, listener) => {
        watch.listener = listener;
        return { update: async () => {}, close: async () => {} };
      },
    };
    let clock = Date.now();
    const startedAt = clock - 1_000;
    const errors: Error[] = [];
    const loop = createDaemonLoop({
      root,
      worktreeId,
      store,
      runner,
      sink: new RecordingSink(store, worktreeId),
      policy: { ...DEFAULT_POLICY, ...RUN_MISSING },
      squealVersion: "0.0.0-test",
      runsDir: storePaths(repo.commonDir).runsDir,
      onError: (error) => errors.push(error),
      backend,
      timings: { reconcileIntervalMs: 600_000 },
      now: () => clock,
    });
    const writes: string[] = [];
    const set = store.meta.set.bind(store.meta);
    store.meta.set = (key, value) => {
      if (key === feedDeliveredMetaKey(worktreeId)) writes.push(value);
      set(key, value);
    };
    let watched = 0;
    const handle = loop.scheduler.handleBatch.bind(loop.scheduler);
    loop.scheduler.handleBatch = async (batch) => {
      await handle(batch);
      if (batch.trigger === "watch") watched += 1;
    };
    // The daemon's record, as its heartbeat keeps it: the loop alone writes none.
    const alive = () =>
      store.worktrees.upsert({
        id: worktreeId,
        root: root as AbsolutePath,
        commonDir: repo.commonDir as AbsolutePath,
        isMain: true,
        registeredAt: startedAt,
        daemon: {
          socketPath: join(root, "daemon.sock") as AbsolutePath,
          startedAt,
          heartbeatAt: clock,
          heartbeatIntervalMs: 5_000,
          squealVersion: "0.0.0-test",
          token: "t",
        },
      });
    /** Status, Stop and a news header at the clock's time, and the same without the stored row. */
    const outputs = () => {
      const status = readStatus(root, { now: () => clock });
      if (!status.available) throw new Error(status.message);
      const header = readLiveHeader(store, worktreeId, clock);
      return {
        status: formatStatus(status, clock),
        stop: statusText(header, []),
        news: headerLines(header, "squeal", "news").join("\n"),
      };
    };
    const withoutRow = () => {
      const kept = store.meta.get(feedDeliveredMetaKey(worktreeId));
      store.meta.delete(feedDeliveredMetaKey(worktreeId));
      const out = outputs();
      if (kept !== null) set(feedDeliveredMetaKey(worktreeId), kept);
      return out;
    };
    try {
      alive();
      await loop.start();
      await loop.scheduler.idle();
      await turn();
      expect(readFeedDelivered(store, worktreeId)).toBe(clock);
      const math = join(root, "src/math.ts");
      expect(readStatus(root, { now: () => clock })).toMatchObject({ daemon: { state: "alive" } });
      for (let step = 1; step <= 9; step++) {
        clock += 10_000;
        alive();
        const now = new Date();
        utimesSync(math, now, now);
        watch.listener?.onHints([{ path: math as AbsolutePath, kind: "change" }]);
        await waitFor(() => watched === step, 10_000);
        await turn();
        expect(outputs()).toEqual(withoutRow());
      }
      // The start pass, then every 15 s: at most seven writes in 90 s.
      expect(writes.length).toBeLessThanOrEqual(7);
      const since = readFeedDelivered(store, worktreeId) ?? 0;
      expect(clock - since).toBeLessThan(15_000);

      // Held: no batch for more than 60 s since the stored one.
      clock = since + 61_000;
      alive();
      const sentence = `Squeal has not yet read edits made after ${timeText(since)}; these counts cover revision ${loop.scheduler.status().revision} and earlier.`;
      const held = outputs();
      expect(held.status.split("\n")).toContain(sentence);
      expect(held.stop).toContain(` ${sentence}`);
      expect(held.news).toContain(` ${sentence}`);
      expect(errors).toEqual([]);
    } finally {
      await loop.close();
      await runner.close();
    }
  });
});
