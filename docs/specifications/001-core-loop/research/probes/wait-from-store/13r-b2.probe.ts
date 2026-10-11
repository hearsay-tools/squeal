// Throwaway probe for research/wait-from-store.md (task 001-256). Not product code.
// reviews/wave-13r.md B2: abandoned sync requests kept retention holds while a
// runner part stalled. From the store: the socket's `sync` without `after`
// (the real handlers and `SyncRequests`) answers the captured revision at
// once while the runner part is held, 40 waits are abandoned at their own
// timeout, and nothing they started outlives them; a commit an hour past the
// catch-up prunes every resolved entry.
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { waitForStatus } from "../../../../../../src/cli/status-wait.js";
import {
  createRepo,
  openHarness,
  openRepoStore,
  SLOW,
} from "../../../../../../test/scheduler/helpers.js";
import { asSync, settle, stallRefinement, syncSocket } from "../../../../../../test/scheduler/held-socket.js";
import { commitShadow, readShadow, SHADOW } from "./shadow.js";
import { type StoreSyncLog, storeSync } from "./store-sync.js";

vi.mock("../../../../../../src/core/scheduler/rekeyed-record.js", async (importOriginal) =>
  (await import("./mock.js")).shadowedRecord(importOriginal as never),
);

const HOUR = 60 * 60_000;

describe("13r B2 from the store: abandoned waits while a runner part stalls", () => {
  it("holds nothing per request, and prunes on age once caught up", SLOW, async () => {
    onTestFinished(() => {
      SHADOW.now = () => Date.now();
    });
    const repo = createRepo();
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir);
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
    // A math edit that resolves, then a strings edit whose runner part stalls.
    h.write("src/math.ts", "export const add = (a: number, b: number) => a - b;\n");
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    const refinement = stallRefinement(h, "src/strings.ts");
    h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase(); // 2\n");
    await h.batch("src/strings.ts");
    const revision = h.scheduler.status().revision;

    // 40 revision-only syncs through the real handlers: each answered with the revision.
    const socket = syncSocket(h);
    const ids = Array.from({ length: 40 }, () => asSync(socket.handle({ type: "sync" })).requestId);
    await settle();
    expect(ids.map((id) => socket.ended.get(id))).toEqual(ids.map(() => "answered"));
    expect(socket.syncs.size).toBe(0);
    // The 32 the socket still remembers carry the revision; nothing waits on the runner part.
    expect(ids.slice(-32).map((id) => socket.status(id).revision)).toEqual(
      ids.slice(-32).map(() => revision),
    );

    // 40 waits from the store, abandoned at their own timeout while the runner part is held.
    const log: StoreSyncLog = { sinceSeqs: [], outcomes: [] };
    const before = readShadow(h.store, h.worktreeId);
    const waits = await Promise.all(
      Array.from({ length: 40 }, () =>
        waitForStatus(h.root, {
          timeoutMs: 300,
          pollMs: 20,
          sync: storeSync(h.store, h.worktreeId, () => revision, undefined, log),
        }),
      ),
    );
    expect(waits.map((wait) => wait.outcome)).toEqual(waits.map(() => "timeout"));
    expect(log.outcomes).toEqual([]);
    // They wrote nothing: the record is what the commits left.
    expect(readShadow(h.store, h.worktreeId)).toEqual(before);
    const resolved = Object.values(before.files).flatMap((entries) =>
      Object.values(entries).filter((entry) => entry !== null),
    );
    expect(resolved.length).toBeGreaterThan(0);

    // Released, the runner part lands and the strings run resolves; caught up after it.
    refinement.release();
    await h.scheduler.idle();
    commitShadow(h.store, h.worktreeId);
    expect(readShadow(h.store, h.worktreeId).caughtUpAt).not.toBeNull();
    // An hour and the grace past the catch-up, the next commit prunes every resolved entry.
    const shift = HOUR + SHADOW.graceMs + 1;
    SHADOW.now = () => Date.now() + shift;
    commitShadow(h.store, h.worktreeId);
    const after = readShadow(h.store, h.worktreeId);
    expect(after.files).toEqual({});
    expect(after.dropped).toBeGreaterThan(0);
  });
});
