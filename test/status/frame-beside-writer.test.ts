import { describe, expect, it } from "vitest";
import { createStateSink, describeFailure } from "../../src/core/state/index.js";
import {
  readFailures,
  readStatus,
  readWhy,
  type StatusContext,
  withStatusStore,
} from "../../src/core/status/index.js";
import { storePaths } from "../../src/core/store/index.js";
import type { CheckError, ResultRecord, TestFileRef } from "../../src/core/types/index.js";
import { check, setKey } from "../state/helpers.js";
import { fakeRepo, seedStore } from "./helpers.js";
import { holdLock, type LockHolder } from "./hold-lock.js";

/*
 * Row 011-113 (CI 39781190437): a status read of a failure with a test-file
 * frame looked its row up with `byKey`'s default, which touches
 * `last_used_at`, so it wrote inside its read transaction. SQLite fails that
 * upgrade at once, without its busy handler (SQLITE_BUSY_SNAPSHOT), while
 * another process writes: "store busy, waited 3 ms".
 */

const FILE: TestFileRef = { project: "", path: "test/autosave.test.ts" };
const SAVES = check("saves after idle", FILE);
const HELPER = { path: "test/parity.testkit.ts", line: 823, column: 40 };
const FRAME = { path: FILE.path, line: 84, column: 15 };
const STACK = [
  "AssertionError: expected 'idle' to be 'saved'",
  `    at assertSaved (${HELPER.path}:${HELPER.line}:${HELPER.column})`,
  `    at ${FRAME.path}:${FRAME.line}:${FRAME.column}`,
].join("\n");

/** A store whose worktree holds one failure a helper threw, so status names its test-file frame. */
function seeded() {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const wt = repo.mainId;
  store.worktrees.upsert({
    id: wt,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  setKey(store, "k1", { file: FILE, worktreeId: wt });
  const revision = store.revisions.append({
    worktreeId: wt,
    createdAt: 1,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: [{ path: "src/x.ts", oldHash: null, newHash: "h1" }],
  }).number;
  const errors: CheckError[] = [
    { name: "AssertionError", message: "boom", stack: STACK, location: HELPER, diff: null },
  ];
  const location = { path: FILE.path, line: 80, column: 3 };
  const described = describeFailure(errors, location);
  const row: ResultRecord = {
    check: SAVES,
    key: "k1",
    outcome: "fail",
    durationMs: 5,
    location,
    fingerprint: described.fingerprint,
    summary: described.summary,
    errors,
    provenance: {
      worktreeId: wt,
      revision,
      commit: "c0ffee",
      dirty: false,
      runId: "r1",
      recordedAt: 1,
    },
  };
  store.results.putMany([row]);
  createStateSink(store).applyResults(wt, revision, [row], { checkpointId: null });
  store.close();
  return { root: repo.main, database: storePaths(repo.commonDir).database };
}

async function release(holder: LockHolder): Promise<void> {
  holder.child.kill();
  await holder.released;
}

describe("status reads beside a store writer (011-113, 011 C6, C7)", () => {
  it("reads a failure's test-file frame beside a held write lock, and never waits for it", async () => {
    const { root, database } = seeded();
    const holder = await holdLock(database, "immediate", 3_000);
    try {
      for (let read = 0; read < 3; read++) {
        const started = Date.now();
        const status = readStatus(root);
        expect(status.available && status.knownFailures[0]?.testFileFrame).toEqual(FRAME);
        expect(readFailures(root).available).toBe(true);
        expect(readWhy(root, `${FILE.path} > saves after idle`).available).toBe(true);
        // A read takes no write lock, so a writer never makes it wait.
        expect(Date.now() - started).toBeLessThan(1_000);
      }
    } finally {
      await release(holder);
    }
  });

  /** A read that writes: SQLite fails its upgrade at once, without the busy handler, while another process writes. */
  const writes = ({ store }: StatusContext) => {
    store.meta.get("probe");
    store.meta.set("probe", "written");
    return "read";
  };

  it("tries again a read SQLite fails at once, and reads once the writer commits", async () => {
    const { root, database } = seeded();
    const holder = await holdLock(database, "immediate", 300);
    try {
      expect(withStatusStore(root, { busyTimeoutMs: 5_000 }, writes)).toBe("read");
    } finally {
      await release(holder);
    }
  });

  it("gives up such a read only at its busy timeout, and says how long it waited", async () => {
    const { root, database } = seeded();
    const holder = await holdLock(database, "immediate", 5_000);
    try {
      const started = Date.now();
      const read = withStatusStore(root, { busyTimeoutMs: 500 }, writes);
      const elapsed = Date.now() - started;

      if (typeof read === "string" || read.available) throw new Error("expected unavailable");
      expect(read.reason).toBe("timeout");
      const waited = Number(/store busy, waited (\d+) ms/.exec(read.message)?.[1]);
      expect(waited).toBeGreaterThanOrEqual(500);
      expect(elapsed).toBeLessThan(2_000);
    } finally {
      await release(holder);
    }
  });
});
