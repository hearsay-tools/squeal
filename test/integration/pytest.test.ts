import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { pytestObservedMetaKey } from "../../src/core/types/index.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import { until } from "../e2e/support.js";
import { codexRecorded, sessionOf } from "../harness/codex/helpers.js";
import { recorded } from "../harness/helpers.js";
import { runMissingConfig } from "../helpers/baseline.js";
import {
  CORE_TEST,
  git,
  metaValue,
  PYTEST_FILES,
  pytestRepos,
  RESOURCES_TEST,
  ranFiles,
  ranSince,
  runs,
  SETTLE_MS,
  settle,
  status,
  VITEST_FILE,
} from "./pytest-repo.js";

/*
 * Spec 007 goal 8 and Testing, integration: one daemon per worktree, run from
 * the sources, validates a Vitest suite and the small pytest fixture of one
 * repository. A baseline is inherited by a second worktree with its own
 * `uv sync`, zero runs; an edit runs only the pytest files importing it, and
 * its `PASS -> FAIL` reaches the agent through the Claude Code and Codex
 * hooks. A module the static graph cannot see (a computed `import_module`)
 * is observed by the first run, stored in the project's meta key, re-runs
 * its file when edited and keeps a worktree whose copy differs from
 * inheriting a pass. A worktree without `.venv` is unknown with D2's note
 * until `uv sync` runs there.
 */

const SLOW = { timeout: 600_000 } as const;
const PROJECT = { name: "small", include: ["tests/**/test_*.py"] };
const OBSERVED_ONLY = "src/app/plugins/alpha.py";
/** The pytest fixture's eight tests and the Vitest one, plus each file's file-level check. */
const CHECKS = 9 + 4;

const FILES: Readonly<Record<string, string>> = {
  ".gitignore": "node_modules/\n.venv/\n",
  "squeal.config.json": runMissingConfig(JSON.stringify({ pytest: [PROJECT] })),
};

const { commit, createRepo, addWorktree, uvSync, startDaemon } = pytestRepos("pytest");

const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };
const CODEX_SESSION = sessionOf("exec", "session-start");
const claude = async (name: "session-start" | "post-tool-batch", root: string) =>
  (await runHook(name, recorded(name, root), deps)).stdout;
const codex = async (name: "session-start" | "post-tool-use", root: string) =>
  (await runCodexHook(name, codexRecorded("exec", name, root, CODEX_SESSION), deps)).stdout;

const observedKey = (main: string) =>
  (metaValue(main, pytestObservedMetaKey("small")) ?? {}) as Record<string, string[]>;

/** The keys `root` stored results of its own under, per test file and revision. */
function ownResults(main: string, root: string): Record<string, unknown>[] {
  const db = new DatabaseSync(join(main, ".git/squeal/store.sqlite"), { readOnly: true });
  try {
    return db
      .prepare(
        "SELECT c.test_path AS path, r.key, r.revision, COUNT(*) AS results FROM results r JOIN checks c ON c.id = r.check_id WHERE r.worktree_id = ? GROUP BY c.test_path, r.key, r.revision",
      )
      .all(worktreeIdFor(root)) as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

/**
 * Why `root`'s checks are not all current (task 007-28): per test file, its
 * key, who stored the results under it and each check's state there; the
 * runs of `root` and its daemon notes.
 */
function whyNotCurrent(main: string, root: string): string {
  const db = new DatabaseSync(join(main, ".git/squeal/store.sqlite"), { readOnly: true });
  const all = (sql: string, ...args: string[]) =>
    db.prepare(sql).all(...args) as Record<string, unknown>[];
  try {
    const id = worktreeIdFor(root);
    const names = new Map(all("SELECT id, root FROM worktrees").map((r) => [r.id, r.root]));
    const files = all("SELECT path, key FROM test_file_keys WHERE worktree_id = ?", id).map(
      ({ path, key }) => ({
        path,
        key,
        storedBy: all(
          "SELECT DISTINCT worktree_id, revision FROM results WHERE key = ?",
          String(key),
        ).map((r) => `${names.get(r.worktree_id)} at ${r.revision}`),
        states: all(
          "SELECT c.full_name, k.validity, k.origin_kind FROM known_states k JOIN checks c ON c.id = k.check_id WHERE k.worktree_id = ? AND c.test_path = ?",
          id,
          String(path),
        ).map((r) => `${r.full_name || "(file)"}: ${r.validity} ${r.origin_kind ?? ""}`),
      }),
    );
    return JSON.stringify(
      {
        files,
        own: ownResults(main, root),
        runs: runs(main, root),
        notes: status(root).daemonNotes,
      },
      null,
      1,
    );
  } finally {
    db.close();
  }
}

describe("a repository with a Vitest suite and a pytest project (spec 007)", () => {
  it(
    "baselines, inherits into a synced worktree, keys observed paths and delivers a pytest PASS -> FAIL",
    SLOW,
    async (ctx) => {
      const main = createRepo("main", FILES);
      uvSync(ctx, main);
      await startDaemon(main);
      expect(await claude("session-start", main)).toMatch(/SQUEAL · registered at revision \d+/);
      expect(await codex("session-start", main)).toMatch(/SQUEAL/);
      const baseline = await settle(main, "the main baseline", (s) => s.counts.current === CHECKS);
      expect(baseline.knownFailures).toEqual([]);
      expect(new Set(ranFiles(main, main))).toEqual(new Set([...PYTEST_FILES, VITEST_FILE]));

      // D4: the baseline observed the computed import, stored with the closure.
      expect(observedKey(main)[CORE_TEST]).toContain(OBSERVED_ONLY);

      // A worktree whose observed-only module differs keys test_core.py with it, misses, runs it.
      const wt3 = addWorktree(main, "wt3");
      writeFileSync(join(wt3, OBSERVED_ONLY), "X = 2\n");
      uvSync(ctx, wt3);
      await startDaemon(wt3);
      const third = await settle(
        wt3,
        "the third baseline",
        (s) => s.counts.current === CHECKS && ranFiles(main, wt3).length >= 2,
      ).catch((error: unknown) => {
        throw new Error(`${String(error)}\n${whyNotCurrent(main, wt3)}`);
      });
      // test_resources.py too: its baseline in main imported `app.data` through
      // `importlib.resources`, observed only, and growth a worktree's own run finds keys its
      // stored result at the next edit (003 D3), so main's result lacks it.
      expect(new Set(ranFiles(main, wt3))).toEqual(new Set([CORE_TEST, RESOURCES_TEST]));
      expect(observedKey(main)[RESOURCES_TEST]).toContain("src/app/data/__init__.py");
      expect(third.knownFailures.map((f) => f.check.testPath)).toEqual([CORE_TEST]);

      // An edit of the observed-only module re-runs its test file, and only it, and its result
      // stands: under uv's hardlinks a sync elsewhere once withheld it, left unknown (007-28).
      let from = runs(main, main).length;
      let at = status(main).revision;
      writeFileSync(join(main, OBSERVED_ONLY), "# edited\nX = 3\n");
      await settle(main, "the edit of alpha.py", (s) => s.counts.current === CHECKS, at).catch(
        (error: unknown) => {
          throw new Error(`${String(error)}\n${whyNotCurrent(main, main)}`);
        },
      );
      expect(ranSince(main, main, from)).toEqual([CORE_TEST]);
      git(main, ["add", OBSERVED_ONLY]);
      commit(main, "alpha");

      // An edit runs only the pytest file importing it, and both hooks deliver it.
      from = runs(main, main).length;
      at = status(main).revision;
      writeFileSync(join(main, "src/app/resources.py"), 'def values():\n    return {"a": 2}\n');
      await settle(
        main,
        "the edit of resources.py and its re-run",
        (s) => s.knownFailures.length === 1 && ranSince(main, main, from).length >= 2,
        at,
      );
      expect(ranSince(main, main, from)).toEqual([RESOURCES_TEST, RESOURCES_TEST]);
      for (const delivered of [
        await claude("post-tool-batch", main),
        await codex("post-tool-use", main),
      ]) {
        expect(delivered).toContain("PASS -> FAIL");
        expect(delivered).toContain("test_values");
      }
      git(main, ["checkout", "--", "src/app/resources.py"]);
      await settle(main, "the revert", (s) => s.knownFailures.length === 0);

      // A worktree without an environment is unknown with D2's note until `uv sync` runs there.
      const wt2 = addWorktree(main, "wt2");
      await startDaemon(wt2);
      const unsynced = await until("the unsynced worktree's note", SETTLE_MS, async () => {
        const s = status(wt2);
        const noted = s.daemonNotes.some((n) => /no Python environment.*uv sync/.test(n.text));
        if (noted && s.testFilesWithoutChecks.unknown === PYTEST_FILES.length) return s;
        throw new Error(JSON.stringify({ counts: s.counts, files: s.testFilesWithoutChecks }));
      });
      expect(unsynced.counts).toMatchObject({ current: 2, pending: 0 });
      // Nothing ran: every pytest tier of the worktree ended before starting pytest.
      expect(runs(main, wt2).every((r) => r.end === "crashed" || r.testFiles.length === 0)).toBe(
        true,
      );

      // Synced, it inherits every result of the commit: none of its own.
      uvSync(ctx, wt2);
      const second = await settle(
        wt2,
        "the synced second worktree",
        (s) => s.counts.current === CHECKS,
      );
      expect(second.inherited.count, whyNotCurrent(main, wt2)).toBe(CHECKS);
      expect(second.knownFailures).toEqual([]);
      // Task 001-421: a tier keyed while the sync ran stores nothing (D2's sync state). One
      // admitted near the sync's end may start pytest and complete, as on CI once, but nothing
      // of it is kept: every check above is inherited, and no result is the worktree's own.
      expect(ownResults(main, wt2), whyNotCurrent(main, wt2)).toEqual([]);
    },
  );
});
