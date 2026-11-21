import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { COVERAGE_RECORD_VERSION } from "../../src/core/code/coverage/record.js";
import { codeStorePath } from "../../src/core/code/store/open.js";
import { noCodeRemoved, pruneCodeSlices } from "../../src/core/code/store/prune.js";
import { Connection, type Params } from "../../src/core/store/connection.js";
import { storePaths } from "../../src/core/store/paths.js";
import { noneRemoved, pruneSlices } from "../../src/core/store/prune.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { CodeKnownState } from "../../src/core/types/code.js";
import type { Store } from "../../src/core/types/store.js";
import * as code from "../code/helpers.js";
import {
  DAY_MS,
  fakeCommonDir,
  knownState,
  open,
  result,
  tempDir,
  testCheck,
  worktree,
} from "./helpers.js";
import { putOldList } from "./loaded-lists.js";

/*
 * Row 021-33 (review 0.1.568 B3): no prune slice scans a table while it
 * holds the write lock. Every statement a full prune of each store runs
 * inside a write transaction is planned again on populated tables, with its
 * own parameters; its plan may search tables by key or index, never scan one.
 */

const NOW = 100 * DAY_MS;
const ago = (days: number) => NOW - days * DAY_MS;
const ROWS = 300;

interface Statement {
  readonly sql: string;
  readonly params: Params;
}

/** Every statement `conn` runs inside a write transaction, from now on. */
function underTheLock(conn: Connection): Statement[] {
  const seen: Statement[] = [];
  let open = 0;
  const transaction = conn.transaction.bind(conn);
  conn.transaction = (<T>(fn: () => T): T =>
    transaction(() => {
      open++;
      try {
        return fn();
      } finally {
        open--;
      }
    })) as Connection["transaction"];
  for (const method of ["run", "get", "all"] as const) {
    const own = conn[method].bind(conn) as (sql: string, ...params: Params) => never;
    conn[method] = ((sql: string, ...params: Params) => {
      if (open > 0) seen.push({ sql, params });
      return own(sql, ...params);
    }) as never;
  }
  return seen;
}

/** The plan lines of each statement that scan a stored table, by statement. */
function scans(db: DatabaseSync, statements: readonly Statement[]): string[] {
  const found = new Set<string>();
  for (const { sql, params } of statements) {
    if (/^\s*PRAGMA/i.test(sql)) continue;
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[];
    for (const { detail } of plan) {
      if (/^SCAN /.test(detail) && !/^SCAN (json_each|CONSTANT ROW|ids)\b/.test(detail)) {
        found.add(`${detail}  <=  ${sql.replace(/\s+/g, " ").slice(0, 160)}`);
      }
    }
  }
  return [...found];
}

/** The tables `statements` delete from. */
function deletedFrom(statements: readonly Statement[]): string[] {
  const tables = statements.flatMap(({ sql }) => /^\s*DELETE FROM (\w+)/.exec(sql)?.[1] ?? []);
  return [...new Set(tables)].sort();
}

/** Prints every plan, for the notes. */
function plans(db: DatabaseSync, statements: readonly Statement[]): string[] {
  const out = new Set<string>();
  for (const { sql, params } of statements) {
    if (/^\s*PRAGMA/i.test(sql)) continue;
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[];
    out.add(
      `${sql.replace(/\s+/g, " ").slice(0, 120)}\n    ${plan.map((p) => p.detail).join("\n    ")}`,
    );
  }
  return [...out];
}

/** A main store with a main, a linked and a removed worktree, and rows of every table the prune reads. */
function mainStore(): { commonDir: string; store: Store } {
  const commonDir = fakeCommonDir();
  const store = open(commonDir);
  const linkedRoot = tempDir();
  writeFileSync(join(linkedRoot, ".git"), `gitdir: ${commonDir}/worktrees/linked\n`);
  const removedRoot = tempDir();
  writeFileSync(join(removedRoot, ".git"), `gitdir: ${commonDir}/worktrees/removed\n`);
  store.worktrees.upsert(worktree("main", dirname(commonDir), { isMain: true, commonDir }));
  store.worktrees.upsert(worktree("linked", linkedRoot, { commonDir }));
  store.worktrees.upsert(worktree("removed", removedRoot, { commonDir }));
  rmSync(removedRoot, { recursive: true });
  const n = Array.from({ length: ROWS }, (_, i) => i);
  store.checks.upsertMany(
    n.map((i) => ({
      check: testCheck(`unused ${i}`),
      location: null,
      templated: false,
      firstSeenAt: 1,
    })),
  );
  store.results.putMany(
    n.flatMap((i) => [
      result(testCheck(`c${i}`), `old${i}`, { worktreeId: "linked", recordedAt: ago(30) }),
      result(testCheck(`c${i}`), `new${i}`, { worktreeId: "main", recordedAt: ago(1) }),
    ]),
  );
  store.knownStates.upsertMany(
    n.map((i) => knownState(i % 2 ? "linked" : "removed", testCheck(`k${i}`))),
  );
  store.views.writeMany(
    { worktreeId: "linked", sessionId: "s", agentId: "main" },
    n.map((i) => ({ check: testCheck(`v${i}`), outcome: "pass", fingerprint: null, toldAt: 1 })),
  );
  store.testFileKeys.upsertMany(
    n.map((i) => ({
      worktreeId: "linked",
      testFile: { project: "", path: `t${i}.test.ts` },
      key: `new${i}`,
      revision: 1,
      pending: null,
    })),
  );
  for (const i of n) {
    const id = `cp${i}`;
    const worktreeId = i % 3 === 0 ? "gone" : "linked";
    store.checkpoints.start({
      id,
      worktreeId,
      revision: 1,
      kind: "run-all",
      testFiles: [],
      startedAt: ago(20 + i),
    });
    store.checkpoints.finish(id, "completed", ago(20 + i));
    store.runs.start({
      id: `run${i}`,
      worktreeId: "linked",
      revision: 1,
      testFiles: [],
      checkpointId: id,
      logDir: "/nowhere",
      startedAt: ago(20),
    });
    store.runs.finish(`run${i}`, "completed", ago(20));
  }
  const conn = connectionOf(store);
  for (const i of n) putOldList(conn, `k${i}`, `t${i}.test.ts`);
  for (const i of n)
    conn.run("INSERT INTO failure_texts (id, summary, errors) VALUES (?, 'x', '[]')", `t${i}`);
  return { commonDir, store };
}

function state(worktreeId: string, name: string, blob: string): CodeKnownState {
  return {
    worktreeId,
    check: code.check(name),
    measure: "complexity",
    outcome: "fail",
    value: 23,
    threshold: 20,
    countedAt: 1,
    blob,
    changedAt: 1,
  };
}

describe("the prune under the write lock (row 021-33, review 0.1.568 B3)", () => {
  it("searches the main store's tables by key, never scans one", () => {
    const { commonDir, store } = mainStore();
    const conn = connectionOf(store);
    const seen = underTheLock(conn);
    const counts = noneRemoved();
    const options = { now: NOW, retentionDays: 7, maxSizeMb: null };
    for (const slice of pruneSlices(
      conn,
      store.worktrees,
      storePaths(commonDir),
      options,
      counts,
    )) {
      slice();
    }
    expect(counts.resultsRemoved).toBeGreaterThan(0);
    expect(counts.checksRemoved).toBeGreaterThan(0);
    expect(counts.checkpointsRemoved).toBeGreaterThan(0);
    expect(counts.runsRemoved).toBeGreaterThan(0);
    expect(deletedFrom(seen)).toEqual(
      expect.arrayContaining([
        "checkpoints",
        "checks",
        "failure_texts",
        "loaded_modules",
        "results",
        "runs",
      ]),
    );
    if (process.env.PRUNE_PLANS === "1") console.log(plans(conn.db, seen).join("\n"));
    expect(scans(conn.db, seen)).toEqual([]);
  });

  it("searches the code store's tables by key, never scans one", () => {
    const dir = code.commonDir();
    const store = code.open(dir);
    const n = Array.from({ length: ROWS }, (_, i) => i);
    store.transaction(() => {
      for (const i of n) store.counts.put(code.count(`b${i}`), ago(30));
    });
    store.files.upsertMany(
      "w1",
      n.filter((i) => i % 3 === 0).map((i) => code.file(`src/f${i}.ts`, `b${i}`)),
    );
    store.states.upsertMany(n.map((i) => state(i % 2 ? "w1" : "dead", `F${i}`, `b${i}`)));
    store.views.writeMany(
      { worktreeId: "w1", sessionId: "s", agentId: "main" },
      n.map((i) => ({
        check: code.check(`V${i}`),
        measure: "complexity",
        outcome: "fail",
        threshold: 20,
        told: "x",
        toldAt: 1,
      })) as never,
    );
    const conn = new Connection(new DatabaseSync(codeStorePath(dir)));
    for (const i of n) {
      for (const worktreeId of ["w1", "dead"]) {
        conn.run(
          `INSERT INTO files (worktree_id, path, blob, language, counter_version, size, revision)
           VALUES (?, ?, ?, 'typescript', 1, 1, 1) ON CONFLICT DO NOTHING`,
          worktreeId,
          `src/g${i}.ts`,
          `g${i}`,
        );
        conn.run(
          `INSERT INTO transitions (worktree_id, check_id, measure, kind, revision, at)
           VALUES (?, (SELECT min(id) FROM checks), 'complexity', 'first-seen-fail', 1, 1)`,
          worktreeId,
        );
      }
      conn.run(
        "INSERT INTO coverage (result_key, provider_version, record, recorded_at) VALUES (?, ?, x'00', ?)",
        `r${i}`,
        COVERAGE_RECORD_VERSION,
        ago(30),
      );
      conn.run(
        "INSERT INTO coverage_parts (hash, part, used_at) VALUES (?, x'00', ?)",
        `h${i}`,
        ago(30),
      );
      conn.run("INSERT INTO meta (key, value) VALUES (?, 'x')", `coverage:dead:src/g${i}.ts`);
    }
    const seen = underTheLock(conn);
    const counts = noCodeRemoved();
    const options = { now: NOW, retentionDays: 7, worktrees: ["w1"], consumers: [] };
    for (const slice of pruneCodeSlices(conn, options, counts)) slice();
    expect(counts.countsRemoved).toBeGreaterThan(0);
    expect(counts.checksRemoved).toBeGreaterThan(0);
    expect(counts).toMatchObject({ worktreesRemoved: 1 });
    expect(counts.viewsRemoved * counts.coverageRemoved * counts.partsRemoved).toBeGreaterThan(0);
    expect(deletedFrom(seen)).toEqual([
      "checks",
      "counts",
      "coverage",
      "coverage_parts",
      "files",
      "meta",
      "states",
      "transitions",
      "views",
    ]);
    if (process.env.PRUNE_PLANS === "1") console.log(plans(conn.db, seen).join("\n"));
    expect(scans(conn.db, seen)).toEqual([]);
    conn.close();
  });
});
