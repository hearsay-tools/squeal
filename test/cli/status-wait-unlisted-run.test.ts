import { describe, expect, it } from "vitest";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { namedText } from "../../src/cli/status-wait-lines.js";
import { waitForNamed } from "../../src/cli/status-wait-paths.js";
import { NO_YIELD_ROW } from "../../src/core/scheduler/yield-row.js";
import { writeYieldRow } from "../../src/core/scheduler/yields.js";
import { type RevisionNumber, refinedMetaKey } from "../../src/core/types/index.js";
import { A, B, C, NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-209 (spec 011 C15): while the revision is not listed, a named
 * wait's line names the run its runner part waits for: the open run of the
 * file's lane, its lane, start and, once the runner named one ended, how
 * many of its files did, as the daemon published it.
 */
const STARTED = NOW - 30_000;

/** Local `HH:MM:SS` of `at`, as the line prints it. */
const clock = (at: number) => {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const synced = (): SyncState => ({
  state: "synced",
  revision: 4 as RevisionNumber,
  incarnation: null,
});

describe("an unlisted revision's line names the run its runner part waits for (row 011-209)", () => {
  it("the open run of the file's lane, its start and its ended files", async () => {
    const { repo, store } = repoWith([A], [B, C]);
    store.revisions.append({
      worktreeId: repo.mainId,
      createdAt: NOW - 10_000,
      head: null,
      dirty: false,
      trigger: "watch",
      changes: [{ path: "vitest.config.ts", oldHash: "a", newHash: "b" }],
    });
    store.meta.set(refinedMetaKey(repo.mainId), "4");
    store.runs.start({
      id: "r1",
      worktreeId: repo.mainId,
      revision: 4 as RevisionNumber,
      testFiles: [B, C].map(ref),
      checkpointId: null,
      logDir: "/tmp/r1",
      startedAt: STARTED,
    });
    writeYieldRow(store, repo.mainId, NOW, { ...NO_YIELD_ROW, ended: new Map([["r1", 1]]) });

    const wait = await waitForNamed(repo.main, [A], {
      timeoutMs: 60,
      pollMs: 20,
      settleMs: 0,
      now: () => NOW,
      sync: (): DaemonSync => ({ current: synced, stop: () => {} }),
      ask: async () => [],
    });
    if (wait.outcome === "unavailable") throw new Error("unavailable");

    expect(namedText(wait, NOW)).toContain(
      `  1 revision 5 not listed yet, because the runner part waits for the run in flight (the vitest tier of 2 test files running since ${clock(STARTED)}, 1 of them ended), each of its calls bounded at 666 s: ${A}\n`,
    );
    expect(wait.files[0]?.standing).toMatchObject({
      kind: "unlisted",
      run: { lane: "vitest", since: STARTED, files: 2, ended: 1 },
    });
  });
});
