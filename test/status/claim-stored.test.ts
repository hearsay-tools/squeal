import { describe, expect, it } from "vitest";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { readNamedFiles } from "../../src/core/status/standing.js";
import { timeText } from "../../src/core/text.js";
import type {
  CheckKey,
  RevisionNumber,
  StatusSnapshot,
  Store,
  WorktreeId,
} from "../../src/core/types/index.js";
import { C, NOW, ref, repoWith } from "../cli/status-wait-fixture.js";
import { result } from "../store/helpers.js";
import { check } from "./helpers.js";

/*
 * Row 011-124 (011 C7, C15): status names another worktree's claim for a
 * queued file only when the file waits on it, as the scheduler's claim test
 * judges (`peekClaim`): no result is stored at its key. With one stored, the
 * daemon takes it with no run, or runs the file here when it is another
 * worktree's failure it holds, so the file reads what it waits for. An edit's
 * work or a forced file under a claim still reads the claim: only the
 * daemon's queue knows them (`tasks/011-124/notes.md`).
 */

const A = "src/a.test.ts";
const STARTED = NOW - 30_000;
/** C's key in `repoWith`, queued. */
const KEY = `key-${C}-queued` as CheckKey;

function snapshotOf(root: string): StatusSnapshot {
  const status = readStatus(root, { now: () => NOW });
  if (!status.available) throw new Error(status.message);
  return status;
}

/** C queued here; worktree `other`, its daemon heartbeating, runs C's key with an open run. */
function claimed() {
  const { repo, store } = repoWith([C]);
  const other = repo.addWorktree("other");
  store.worktrees.upsert({
    id: other.id,
    root: other.root,
    commonDir: repo.commonDir,
    isMain: false,
    registeredAt: 2,
    daemon: {
      socketPath: "/tmp/other.sock",
      startedAt: NOW - 60_000,
      heartbeatAt: NOW - 1_000,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0-test",
    },
  });
  store.testFileKeys.upsertMany([
    { worktreeId: other.id, testFile: ref(C), key: KEY, revision: 1 as never, pending: "running" },
  ]);
  openRun(store, other.id, "run-other", [C]);
  return { repo, store, other };
}

function openRun(store: Store, worktreeId: WorktreeId, id: string, paths: readonly string[]) {
  store.runs.start({
    id,
    worktreeId,
    revision: 4 as RevisionNumber,
    testFiles: paths.map(ref),
    checkpointId: null,
    logDir: `/tmp/${id}`,
    startedAt: STARTED,
  });
}

/** C's standing in status's `--json` (`outstanding`), its `Outstanding:` line and a named read. */
function readings(root: string, store: Store, worktreeId: WorktreeId) {
  const snapshot = snapshotOf(root);
  const json = JSON.parse(JSON.stringify(snapshot)) as StatusSnapshot;
  const group = json.outstanding?.find((g) => g.files.some((f) => f.path === C));
  const lines = formatStatus(snapshot, NOW).split("\n");
  const line = lines
    .slice(lines.indexOf("Outstanding:") + 1)
    .find((l) => l.endsWith(C) || l.includes(`${C};`));
  const [named] = readNamedFiles(store, worktreeId, root, [ref(C)], snapshot.daemon, NOW);
  return { standing: group?.standing, line, pending: named?.pending };
}

describe("status names a claim only for a queued file that waits on it (011-124)", () => {
  it("no result stored at its key: waits for the claimant's run, as before", () => {
    const { repo, store, other } = claimed();

    const { standing, line, pending } = readings(repo.main, store, repo.mainId);

    expect(standing).toMatchObject({ kind: "claim", worktree: other.root });
    expect(pending).toMatchObject({ kind: "claim", worktree: other.root });
    expect(line).toBe(
      `  1 test file waiting for ${other.root}'s run of its key, at most until ${timeText(NOW + 606_000)}: ${C}; its result is shared here when that run stores it`,
    );
  });

  it("a result stored at its key that stands here: taken with no run, so no claim", () => {
    const { repo, store, other } = claimed();
    store.results.putMany([
      result(check(C, "holds"), KEY, { worktreeId: other.id, runId: "run-before" }),
    ]);

    const { standing, line, pending } = readings(repo.main, store, repo.mainId);

    expect(standing).toMatchObject({ kind: "queued", behind: null });
    expect(pending).toMatchObject({ kind: "queued", behind: null });
    expect(line).not.toContain("'s run of its key");
    expect(line).toContain(
      `1 test file queued; no run is open and nothing recorded holds it: ${C};`,
    );
  });

  it("another worktree's failure it holds: runs here, behind its lane's tier", () => {
    const { repo, store, other } = claimed();
    store.results.putMany([
      result(check(C, "holds"), KEY, {
        outcome: "fail",
        worktreeId: other.id,
        runId: "run-before",
      }),
    ]);
    store.testFileKeys.upsertMany([
      {
        worktreeId: repo.mainId,
        testFile: ref(A),
        key: `key-${A}-running` as CheckKey,
        revision: 4 as RevisionNumber,
        pending: "running",
      },
    ]);
    openRun(store, repo.mainId, "run-a", [A]);

    const { standing, line, pending } = readings(repo.main, store, repo.mainId);

    expect(standing).toMatchObject({ kind: "queued", lane: "vitest", behind: STARTED, files: 1 });
    expect(pending).toMatchObject({ kind: "queued", behind: STARTED });
    expect(line).not.toContain("'s run of its key");
    expect(line).toContain(
      `queued behind the vitest tier of 1 test file running since ${timeText(STARTED)}: ${C}`,
    );
  });
});
