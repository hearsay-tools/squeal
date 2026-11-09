import { realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { ObservedSets } from "../../src/core/keys/observed.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import type { WorktreeId } from "../../src/core/types/common.js";
import type { DaemonExit } from "../../src/core/types/daemon.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { git } from "../hash/git-repo.js";
import { CODE_OFF } from "../helpers/policy.js";
import {
  createFixtureRepo,
  type FixtureRepo,
  readNotes,
  SLOW,
  waitFor,
  withStore,
} from "./helpers.js";

/*
 * Row 011-310 (issue #166), through real daemons: one stored observed path
 * that is not worktree-relative stopped every start of the repository, on a
 * restart and in another worktree sharing the store, from 2026-11-07 on
 * cezar. Each start now lists and keys the file, and names the path in its
 * own notes; a clean store is the control.
 */

const TEST = "nt/test/read.test.mjs";
const REF: TestFileRef = { project: "nt", path: TEST };
const BAD = String.raw`\home\agent\AppData\Local\Hearsay Squawk\cache`;
const LEFT_OUT = `observed path left out of nt:${TEST}: "${BAD}"`;

function fixture(): FixtureRepo {
  const repo = createFixtureRepo({
    files: {
      "squeal.config.json": JSON.stringify({
        ...CODE_OFF,
        nodeTest: [{ name: "nt", cwd: "nt", include: ["test/*.test.mjs"], argv: [], env: {} }],
      }),
      "nt/package.json": `${JSON.stringify({ name: "nt", private: true, type: "module" })}\n`,
      [TEST]: 'import { test } from "node:test";\ntest("reads", () => {});\n',
    },
  });
  onTestFinished(repo.cleanup);
  return repo;
}

/** Starts the daemon of `root`, waits until it keyed `REF`, stops it; returns the key. */
async function keyedByDaemon(repo: FixtureRepo, root: string): Promise<CheckKey> {
  const daemon = await startDaemon({ root, env: repo.env });
  if ("reason" in daemon) throw new Error(daemon.message);
  let exit = null as DaemonExit | null;
  void daemon.exited.then((e) => {
    exit = e;
  });
  try {
    await daemon.ready;
    return await waitFor(
      () => {
        if (exit !== null) throw new Error(`daemon exited: ${exit.reason}: ${exit.message}`);
        return withStore(repo, (store) => {
          const rows = store.testFileKeys.list(daemon.worktreeId);
          return rows.find((row) => row.testFile.path === REF.path)?.key ?? null;
        });
      },
      120_000,
      `${REF.path} keyed`,
    );
  } finally {
    await daemon.stop("stop-requested");
  }
}

/** Stores `BAD` in the shared observed set of `REF`, as a run of a test that fakes win32 did. */
function seed(repo: FixtureRepo): void {
  const store = openStore(repo.commonDir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
  try {
    new ObservedSets(store).add(REF, [BAD]);
  } finally {
    store.close();
  }
}

const leftOut = (repo: FixtureRepo, worktreeId: WorktreeId) =>
  readNotes({ commonDir: repo.commonDir, worktreeId }).filter((t) => t.startsWith(LEFT_OUT));

describe(
  "a stored observed path that is not worktree-relative (row 011-310, issue #166)",
  SLOW,
  () => {
    it("stops no start, restart or other worktree, and each names it; a clean store is the control", async () => {
      const control = fixture();
      const clean = await keyedByDaemon(control, control.root);
      expect(leftOut(control, control.worktreeId)).toEqual([]);

      const repo = fixture();
      seed(repo);
      const first = await keyedByDaemon(repo, repo.root);
      expect(first).not.toBe(clean);
      expect(leftOut(repo, repo.worktreeId)).toHaveLength(1);

      // A restart over the unchanged store keys alike and writes no second note.
      expect(await keyedByDaemon(repo, repo.root)).toBe(first);
      expect(leftOut(repo, repo.worktreeId)).toHaveLength(1);

      // A second worktree sharing the store starts, keys alike and names the path itself.
      git(repo.root, ["worktree", "add", "-q", "../second"]);
      const second = realpathSync(join(repo.root, "../second"));
      expect(await keyedByDaemon(repo, second)).toBe(first);
      expect(leftOut(repo, worktreeIdFor(second))).toHaveLength(1);
    });
  },
);
