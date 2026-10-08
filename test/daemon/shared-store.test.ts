import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/index.js";
import { git } from "../hash/git-repo.js";
import {
  daemonSuite,
  type FixtureRepo,
  readNotes,
  type SpawnedProcess,
  stopProcess,
  waitFor,
  waitReady,
} from "./helpers.js";

/*
 * 003 lessons, defect 5 (task 001-141): a second daemon starting on the
 * shared store made the first one's scheduler stop with "database is
 * locked"; its tier's run row never closed and its files ran again. The
 * holder was the second daemon's first prune, which dropped a removed
 * worktree's results in one write transaction. Each round here ends the
 * first daemon's tier while the second one prunes 300,000 results; the old
 * prune held the write lock for 7 s on them, past the daemon's 5 s.
 */

const suite = daemonSuite();
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const PRUNING_DAEMON = join(import.meta.dirname, "pruning-daemon.ts");
const ROUNDS = 3;
const REMOVED_RESULTS = 300_000;
const SEED_BATCH = 10_000;
const LOCKED = /database is locked|store busy|stopped running tiers/;

/**
 * A test that runs until the test writes its `release` marker, so its tier
 * ends while the second daemon prunes; `round` changes its key.
 */
function slowTest(marker: string, round: number): string {
  const at = (name: string) => JSON.stringify(`${marker}.${round}.${name}`);
  return [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { it } from "vitest";',
    `it("waits", async () => {`,
    `  writeFileSync(${at("started")}, "");`,
    `  while (!existsSync(${at("release")})) await new Promise((resolve) => setTimeout(resolve, 20));`,
    `  writeFileSync(${at("done")}, "");`,
    "}, 300_000);",
    "",
  ].join("\n");
}

const MARKERS = ["started", "release", "done"];

function query<T>(repo: FixtureRepo, fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(storePaths(repo.commonDir).database);
  try {
    db.exec("PRAGMA busy_timeout = 60000");
    return fn(db);
  } finally {
    db.close();
  }
}

/** A worktree whose root is gone, owning `REMOVED_RESULTS` results, written in short transactions. */
function seedRemoved(repo: FixtureRepo, id: string): void {
  query(repo, (db) => {
    db.prepare(
      `INSERT INTO worktrees (id, root, common_dir, is_main, registered_at)
       VALUES (?, ?, ?, 0, 1)`,
    ).run(id, `/nonexistent/${id}`, repo.commonDir);
    const insert = db.prepare(
      `WITH RECURSIVE n(i) AS (SELECT ? UNION ALL SELECT i + 1 FROM n WHERE i < ?)
       INSERT INTO results (check_id, key, outcome, duration_ms, worktree_id, revision, dirty,
                            run_id, recorded_at, last_used_at)
       SELECT i, ? || '-' || i, 'pass', 1, ?, 1, 0, ? || '-run', 1000, 1000 FROM n`,
    );
    for (let from = 1; from <= REMOVED_RESULTS; from += SEED_BATCH) {
      insert.run(from, from + SEED_BATCH - 1, id, id, id);
    }
  });
}

function worktreeExists(repo: FixtureRepo, id: string): boolean {
  return query(
    repo,
    (db) => db.prepare("SELECT 1 FROM worktrees WHERE id = ?").get(id) !== undefined,
  );
}

function removedResults(repo: FixtureRepo, id: string): number {
  return query(repo, (db) =>
    Number(db.prepare("SELECT count(*) AS n FROM results WHERE worktree_id = ?").get(id)?.n),
  );
}

function runs(repo: FixtureRepo): { testFiles: string; endedAt: number | null }[] {
  return query(repo, (db) =>
    db
      .prepare("SELECT test_files, ended_at FROM runs WHERE worktree_id = ?")
      .all(repo.worktreeId)
      .map((row) => ({
        testFiles: String(row.test_files),
        endedAt: row.ended_at as number | null,
      })),
  );
}

const slowRuns = (repo: FixtureRepo) =>
  runs(repo).filter((run) => run.testFiles.includes("slow.test.ts")).length;
const openRuns = (repo: FixtureRepo) => runs(repo).filter((run) => run.endedAt === null).length;

function startPruning(root: string, repo: FixtureRepo): SpawnedProcess {
  const child = spawn(process.execPath, ["--import", TSX, PRUNING_DAEMON, root], {
    cwd: root,
    env: repo.env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let err = "";
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
    err += chunk;
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) =>
    child.on("exit", (code, signal) => done({ code, signal })),
  );
  return { child, exited, stdout: () => "", stderr: () => err };
}

describe("a second daemon on the shared store (003 lessons defect 5, task 001-141)", () => {
  it(`never costs the first daemon a tier, ${ROUNDS} starts in a row`, async () => {
    const marker = `/tmp/sq-141-${randomUUID()}`;
    suite.cleanup(() => {
      for (let round = 0; round <= ROUNDS; round++) {
        for (const name of MARKERS) rmSync(`${marker}.${round}.${name}`, { force: true });
      }
    });
    writeFileSync(`${marker}.0.release`, "");
    const repo = suite.fixture({ "test/slow.test.ts": slowTest(marker, 0) });
    const linked = join(dirname(repo.root), "linked");
    git(repo.root, ["worktree", "add", "-q", "-b", "linked", linked]);
    const second = realpathSync(linked);

    const first = suite.daemon(repo);
    await waitReady(repo, first);
    await waitFor(() => slowRuns(repo) > 0 && openRuns(repo) === 0, 120_000, "the baseline");
    const before = slowRuns(repo);

    for (let round = 1; round <= ROUNDS; round++) {
      const removed = `removed-${round}`;
      seedRemoved(repo, removed);
      writeFileSync(join(repo.root, "test/slow.test.ts"), slowTest(marker, round));
      await waitFor(() => existsSync(`${marker}.${round}.started`), 60_000, `tier ${round}`);

      const pruning = startPruning(second, repo);
      try {
        // The prune removes the worktree row first, then its results: the tier ends during that.
        await waitFor(() => !worktreeExists(repo, removed), 120_000, `prune ${round} started`);
        writeFileSync(`${marker}.${round}.release`, "");
        await waitFor(() => removedResults(repo, removed) === 0, 120_000, `prune ${round}`);
      } catch (error) {
        throw new Error(`${(error as Error).message}\n${pruning.stderr().slice(-2_000)}`);
      } finally {
        await stopProcess(pruning);
      }
      await waitFor(() => existsSync(`${marker}.${round}.done`), 60_000, `tier ${round} ending`);
      await waitFor(() => openRuns(repo) === 0, 60_000, `run rows of tier ${round} closed`).catch(
        (error: Error) => {
          throw new Error(`${error.message}; notes: ${readNotes(repo).join("\n")}`);
        },
      );
    }

    expect(readNotes(repo).filter((note) => LOCKED.test(note))).toEqual([]);
    expect(first.stderr()).not.toMatch(LOCKED);
    // One run of the slow file per round: no tier was lost and run again.
    expect(slowRuns(repo) - before).toBe(ROUNDS);
    expect(first.child.exitCode).toBeNull();
  }, 600_000);
});
