import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { namedText } from "../../src/cli/status-wait-lines.js";
import { waitForNamed } from "../../src/cli/status-wait-paths.js";
import { CLOSURE_METHOD } from "../../src/core/keys/closure.js";
import { testFileId } from "../../src/core/keys/index.js";
import { poolWaitMetaKey, publishPoolWaits } from "../../src/core/scheduler/pool-wait.js";
import { publishPromotions } from "../../src/core/scheduler/promotions.js";
import { timeText } from "../../src/core/text.js";
import type {
  EpochMs,
  PoolWait,
  RevisionNumber,
  Store,
  WorktreeId,
} from "../../src/core/types/index.js";
import { A, NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-309 (spec 011 C15 "A batch on a busy host" as amended 2026-11-07,
 * `tasks/011-308/design.md` D2): a named wait whose source path selects a
 * test file that sits queued behind a backlog tier the pool refused reads
 * when it began to wait for CPU and what the pool read, in its pending line,
 * its deadline line and `--json`. With no `pool-wait` row, as from an older
 * daemon, a predecessor's row, a row not written for 30 s or an entry
 * without every field, the text is today's.
 */

const SINCE = (NOW - 20_000) as EpochMs;
const WAIT: PoolWait = { since: SINCE, busyCores: 21.4, cpus: 24, hostSlots: 12, grants: 7 };
const LINE = `queued, waiting for CPU since ${timeText(SINCE)}: the host is busy (21 of 24 cores in use; Squeal's daemons hold 7 of 12 test slots); the daemon asks again every 2 s`;
const TODAY = "queued; no run is open and nothing recorded holds it";
const SOURCE = "src/a.ts";

const synced = (): SyncState => ({
  state: "synced",
  revision: 4 as RevisionNumber,
  incarnation: null,
});
const sync = () => (): DaemonSync => ({ current: synced, stop: () => {} });

/** A queued and its closure, which holds `src/a.ts`: the source path selects it. */
function sourceRepo() {
  const { repo, store } = repoWith([A]);
  store.testFiles.put({
    testFile: ref(A),
    closure: {
      testFile: ref(A),
      paths: [A, SOURCE] as never,
      complete: false,
      method: CLOSURE_METHOD,
    },
    updatedAt: NOW,
    updatedBy: repo.mainId,
  });
  return { repo, store };
}

function refused(store: Store, worktreeId: WorktreeId, at = NOW - 1_000, wait: unknown = WAIT) {
  publishPoolWaits(store, worktreeId, new Map([["vitest", wait as PoolWait]]), at as EpochMs);
}

async function timedOut(root: string) {
  const wait = await waitForNamed(root, [SOURCE], {
    timeoutMs: 60,
    pollMs: 20,
    settleMs: 0,
    now: () => NOW,
    sync: sync(),
    ask: async () => [],
  });
  if (wait.outcome === "unavailable") throw new Error("unavailable");
  return namedText(wait, NOW);
}

describe("a named wait says when its files wait for CPU (row 011-309)", () => {
  it("a source path's selected file behind a refused tier reads the line, pending and at the deadline", async () => {
    const { repo, store } = sourceRepo();
    refused(store, repo.mainId);

    const text = await timedOut(repo.main);

    expect(text).toContain(`Pending (1):\n  1 ${LINE}: ${A}\n`);
    const last = text.trimEnd().split("\n").at(-1) ?? "";
    expect(last).toContain(`1 test file still pending at revision 4: 1 ${LINE}. Worktree:`);
  });

  it("in `--json`: the entry's reason and the wait's fields, and the snapshot's standing", async () => {
    const { repo, store } = sourceRepo();
    refused(store, repo.mainId);
    let stdout = "";
    const io: CliIo = {
      stdout: (t) => {
        stdout += t;
      },
      stderr: () => {},
      cwd: repo.main,
      now: () => NOW,
      env: {},
    };

    const code = await main(["status", "--json", "--wait", "200", SOURCE], io);

    expect(code).toBe(3);
    const json = JSON.parse(stdout);
    expect(json.wait.testFiles).toEqual([
      expect.objectContaining({ path: A, state: "pending", reason: LINE, pool: WAIT }),
    ]);
    const group = json.outstanding.find(
      (g: { standing: { kind: string } }) => g.standing.kind === "queued",
    );
    expect(group.standing).toEqual({ kind: "queued", lane: "vitest", behind: null, pool: WAIT });
  });

  it("a promoted file is a batch's, which never waits for the pool: its line is unchanged", async () => {
    const { repo, store } = sourceRepo();
    refused(store, repo.mainId);
    publishPromotions(
      store,
      repo.mainId,
      [{ files: [testFileId(ref(A))], until: NOW + 60_000 }],
      NOW as EpochMs,
    );

    const text = await timedOut(repo.main);

    expect(text).toContain(`Pending (1):\n  1 queued, promoted: ${A}`);
    expect(text).not.toContain("waiting for CPU");
  });

  it("with no row, a predecessor's, a row not written for 30 s or an entry without every field, the text is today's", async () => {
    const { repo, store } = sourceRepo();
    const today = await timedOut(repo.main);
    expect(today).toContain(`Pending (1):\n  1 ${TODAY}: ${A}`);

    // Written before the live daemon started (`NOW - 60_000`): its predecessor's.
    refused(store, repo.mainId, NOW - 120_000);
    expect(await timedOut(repo.main)).toEqual(today);
    // The daemon stopped looking: its last write is older than a waiter's freshness.
    refused(store, repo.mainId, NOW - 31_000);
    expect(await timedOut(repo.main)).toEqual(today);
    const { grants: _, ...partial } = WAIT;
    refused(store, repo.mainId, NOW - 1_000, partial);
    expect(await timedOut(repo.main)).toEqual(today);
    store.meta.set(poolWaitMetaKey(repo.mainId), "not json");
    expect(await timedOut(repo.main)).toEqual(today);
    // A wait that ended drops the row.
    publishPoolWaits(store, repo.mainId, new Map(), NOW as EpochMs);
    expect(store.meta.get(poolWaitMetaKey(repo.mainId))).toBeNull();
  });
});
