import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { storePaths } from "../../../../src/core/store/paths.js";
import { connectionOf } from "../../../../src/core/store/store.js";
import type { ResultRepo, Store } from "../../../../src/core/types/store.js";
import type { CaseOutput, PruneInput } from "../case.js";
import { scratchStore } from "./shared.js";

/*
 * The `prune` kind (row 021-09): rows written straight into a fresh store
 * through SQL, which both trees' schema holds alike, then the tree's own
 * `Store.prune`. Outputs: what it says it removed and what the store and
 * the run logs hold after, and with `asked`, which of those keys have a
 * result after it (row 011-315). The store's size after is wording: the
 * pages a vacuum leaves are no stored meaning.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 400 * DAY_MS;
const RETENTION_DAYS = 7;
/** A location long enough that a few hundred deleted results free whole pages. */
const LOCATION = "x".repeat(300);

const ago = (days: number) => NOW - days * DAY_MS;

/** Prunes the store `input` describes, made under `dir` as its common dir. */
export function pruneCase(input: PruneInput, dir: string): CaseOutput {
  const store = scratchStore(dir);
  try {
    const db = connectionOf(store).db;
    const { runsDir } = storePaths(dir);
    const roots = new Map(input.worktrees.map((w) => [w.id, rootOf(dir, w.id, w.root)]));
    db.exec("BEGIN IMMEDIATE");
    let check = 0;
    for (const w of input.worktrees) {
      db.prepare(
        `INSERT INTO worktrees (id, root, common_dir, is_main, registered_at) VALUES (?, ?, ?, ?, 0)`,
      ).run(w.id, roots.get(w.id) ?? "", dir, w.root === "main" ? 1 : 0);
      for (let i = 0; i < (w.rows ?? 0); i++) {
        const id = addCheck(db, ++check);
        db.prepare(
          `INSERT INTO known_states (worktree_id, check_id, outcome, validity) VALUES (?, ?, 'pass', 'current')`,
        ).run(w.id, id);
        db.prepare(
          `INSERT INTO file_hashes (worktree_id, path, mtime_ms, ctime_ms, size, inode, hash)
           VALUES (?, ?, 0, 0, 0, 0, 'h')`,
        ).run(w.id, `src/f${i}.ts`);
      }
    }
    for (const live of input.liveKeys ?? []) {
      db.prepare(
        `INSERT INTO test_file_keys (worktree_id, project, path, key, revision) VALUES (?, '', ?, ?, 1)`,
      ).run(live.worktree, `test/${live.key}.test.ts`, live.key);
    }
    for (const r of input.results) {
      for (let i = 0; i < r.count; i++) {
        const id = addCheck(db, ++check);
        db.prepare(
          `INSERT INTO results (check_id, key, outcome, duration_ms, location_path, worktree_id,
             revision, dirty, run_id, recorded_at, last_used_at)
           VALUES (?, ?, 'pass', 1, ?, ?, 1, 0, ?, ?, ?)`,
        ).run(id, r.key, LOCATION, r.worktree, r.run, ago(r.daysAgo), ago(r.daysAgo) + i);
      }
    }
    for (const c of input.checkpoints ?? []) {
      db.prepare(
        `INSERT INTO checkpoints (id, worktree_id, revision, kind, test_files, started_at,
           completed_at, end_state) VALUES (?, ?, 1, 'full', '[]', ?, ?, 'completed')`,
      ).run(c.id, c.worktree, ago(c.completedDaysAgo), ago(c.completedDaysAgo));
    }
    for (const run of input.runs ?? []) {
      const log = join(runsDir, run.id);
      mkdirSync(log, { recursive: true });
      writeFileSync(join(log, "output.log"), "log\n");
      const ended = run.endedDaysAgo === null ? null : ago(run.endedDaysAgo);
      db.prepare(
        `INSERT INTO runs (id, worktree_id, revision, test_files, checkpoint_id, log_dir,
           started_at, ended_at, end_state) VALUES (?, ?, 1, '[]', ?, ?, ?, ?, ?)`,
      ).run(
        run.id,
        run.worktree,
        run.checkpoint ?? null,
        log,
        ended ?? ago(0),
        ended,
        ended === null ? null : "completed",
      );
    }
    db.exec("COMMIT");

    const report = store.prune({
      now: NOW,
      retentionDays: RETENTION_DAYS,
      maxSizeMb: input.maxSizeMb ?? null,
    });
    const column = (sql: string) =>
      db
        .prepare(sql)
        .all()
        .map((row) => String(Object.values(row)[0]));
    const { bytesAfter, ...removed } = report;
    return {
      outputs: {
        ...withResults(store, input.asked),
        removed,
        worktrees: column("SELECT id FROM worktrees ORDER BY id"),
        results: column("SELECT worktree_id || ' ' || key FROM results ORDER BY 1"),
        runs: column("SELECT id FROM runs ORDER BY id"),
        logs: (input.runs ?? []).filter((r) => existsSync(join(runsDir, r.id))).map((r) => r.id),
        checkpoints: column("SELECT id FROM checkpoints ORDER BY id"),
        checks: column("SELECT count(*) FROM checks"),
        rows: column(
          `SELECT (SELECT count(*) FROM known_states) || ' states, ' ||
                  (SELECT count(*) FROM file_hashes) || ' hashes'`,
        ),
      },
      wording: { bytesAfter },
    };
  } finally {
    store.close();
  }
}

/**
 * With `asked`, those of its keys with a result, in the order asked (row
 * 011-315). A tree before it has no `keysWithResults`: there the answer is
 * the keys `keysSince(0)` names, which that tree's code-store prune read
 * instead.
 */
function withResults(
  store: Store,
  asked: readonly string[] | undefined,
): { withResults?: readonly string[] } {
  if (asked === undefined) return {};
  const results: Pick<ResultRepo, "keysSince"> & Partial<Pick<ResultRepo, "keysWithResults">> =
    store.results;
  if (results.keysWithResults !== undefined) {
    return { withResults: results.keysWithResults(asked) };
  }
  const stored = new Set(results.keysSince(0).map((k) => k.key));
  return { withResults: [...new Set(asked)].filter((key) => stored.has(key)) };
}

/** A check row, its id `id`. */
function addCheck(db: ReturnType<typeof connectionOf>["db"], id: number): number {
  db.prepare(
    `INSERT INTO checks (id, kind, project, test_path, full_name, templated, first_seen_at)
     VALUES (?, 'test', '', 'test/a.test.ts', ?, 0, 0)`,
  ).run(id, `check ${id}`);
  return id;
}

/** The worktree's root: the repository at `dir`, a linked one, or a path that is not there. */
function rootOf(dir: string, id: string, root: PruneInput["worktrees"][number]["root"]): string {
  const path = join(dir, "roots", id);
  if (root === "gone") return path;
  mkdirSync(path, { recursive: true });
  if (root === "main") mkdirSync(join(path, ".git"), { recursive: true });
  else writeFileSync(join(path, ".git"), `gitdir: ${dir}/worktrees/${id}\n`);
  return path;
}
