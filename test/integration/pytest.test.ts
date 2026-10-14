import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { pytestObservedMetaKey, pytestObservedSessionMetaKey } from "../../src/core/types/index.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import { until } from "../e2e/support.js";
import { codexRecorded, sessionOf } from "../harness/codex/helpers.js";
import { recorded } from "../harness/helpers.js";
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
  "squeal.config.json": `${JSON.stringify({ pytest: [PROJECT] }, null, 2)}\n`,
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

/**
 * Why `wt` did not inherit: per test file, its key beside `main`'s, whether
 * any result is stored under it, and every closure path whose hash differs
 * between the two worktrees; the shared observed keys and the runs of `wt`.
 */
function diagnose(main: string, wt: string): string {
  const db = new DatabaseSync(join(main, ".git/squeal/store.sqlite"), { readOnly: true });
  try {
    const [m, w] = [worktreeIdFor(main), worktreeIdFor(wt)];
    const keyOf = (id: string, path: string) =>
      (db
        .prepare(
          "SELECT key, revision, pending FROM test_file_keys WHERE worktree_id = ? AND path = ?",
        )
        .get(id, path) as
        | { key: string | null; revision: number; pending: string | null }
        | undefined) ?? null;
    const hashes = (id: string) =>
      new Map(
        (
          db.prepare("SELECT path, hash FROM file_hashes WHERE worktree_id = ?").all(id) as {
            path: string;
            hash: string;
          }[]
        ).map((r) => [r.path, r.hash]),
      );
    const [hm, hw] = [hashes(m), hashes(w)];
    const files = (
      db.prepare("SELECT project, path, closure_paths, complete, method FROM test_files").all() as {
        project: string;
        path: string;
        closure_paths: string;
        complete: number;
        method: string;
      }[]
    ).map((f) => {
      const km = keyOf(m, f.path);
      const kw = keyOf(w, f.path);
      const closure = JSON.parse(f.closure_paths) as string[];
      return {
        path: f.path,
        complete: f.complete,
        method: f.method,
        main: km,
        wt: kw,
        sameKey: km?.key === kw?.key,
        resultsUnderWtKey:
          kw?.key == null
            ? 0
            : (
                db.prepare("SELECT count(*) AS n FROM results WHERE key = ?").get(kw.key) as {
                  n: number;
                }
              ).n,
        closureDiffers: closure
          .filter((p) => hm.get(p) !== hw.get(p))
          .map((p) => ({ path: p, main: hm.get(p) ?? null, wt: hw.get(p) ?? null })),
      };
    });
    const environmentDiffers = [...new Set([...hm.keys(), ...hw.keys()])]
      .filter((p) => p.startsWith(".venv/") && hm.get(p) !== hw.get(p))
      .map((p) => ({ path: p, main: hm.get(p) ?? null, wt: hw.get(p) ?? null }));
    const q = (sql: string, ...args: (string | number)[]) =>
      db.prepare(sql).all(...args) as Record<string, unknown>[];
    const names = new Map(
      q("SELECT id, root FROM worktrees").map((r) => [r.id, String(r.root).split("/").pop()]),
    );
    const name = (r: Record<string, unknown>) => ({ ...r, worktree_id: names.get(r.worktree_id) });
    const resultRows = files.flatMap((f) =>
      [f.main?.key, f.wt?.key]
        .filter((k): k is string => typeof k === "string")
        .filter((k, i, all) => all.indexOf(k) === i)
        .flatMap((k) =>
          q(
            "SELECT r.key, c.full_name, r.outcome, r.worktree_id, r.revision, r.run_id, r.recorded_at FROM results r JOIN checks c ON c.id = r.check_id WHERE r.key = ? AND c.test_path = ?",
            k,
            f.path,
          ).map((r) => ({ ...name(r), key: String(r.key).slice(0, 8) })),
        ),
    );
    return JSON.stringify(
      {
        files,
        environmentDiffers,
        observed: metaValue(main, pytestObservedMetaKey("small")),
        observedSession: metaValue(main, pytestObservedSessionMetaKey("small")),
        results: resultRows,
        revisions: q(
          "SELECT number, created_at, trigger, substr(changes, 1, 600) AS changes FROM revisions WHERE worktree_id = ? ORDER BY number",
          w,
        ),
        runs: q(
          "SELECT id, revision, test_files, started_at, ended_at, end_state FROM runs WHERE worktree_id = ? ORDER BY started_at",
          w,
        ),
        transitions: q(
          "SELECT t.revision, t.at, c.test_path, c.full_name, t.kind, t.from_outcome, t.to_outcome FROM transitions t JOIN checks c ON c.id = t.check_id WHERE t.worktree_id = ? ORDER BY t.id",
          w,
        ),
        known: q(
          "SELECT c.test_path, c.full_name, k.outcome, k.validity, k.pending_phase, k.origin_kind, k.origin_worktree FROM known_states k JOIN checks c ON c.id = k.check_id WHERE k.worktree_id = ?",
          w,
        ).map((r) => ({ ...r, origin_worktree: names.get(r.origin_worktree) ?? null })),
        notes: status(wt).daemonNotes,
        coreObserved: metaValue(main, "observed.small"),
        coreClosure: q(
          "SELECT closure_paths, updated_by FROM test_files WHERE path = 'tests/unit/test_core.py'",
        ),
        mainRuns: q(
          "SELECT revision, test_files, started_at, ended_at, end_state FROM runs WHERE worktree_id = ? ORDER BY started_at",
          m,
        ).map((r) => ({
          ...r,
          test_files: String(r.test_files).replace(/"project":"small",/g, ""),
        })),
        mainRevisions: q(
          "SELECT number, created_at, trigger, substr(changes, 1, 300) AS changes FROM revisions WHERE worktree_id = ? ORDER BY number",
          m,
        ),
        coreResults: q(
          "SELECT substr(r.key, 1, 8) AS key, c.full_name, r.outcome, r.worktree_id, r.revision, r.recorded_at FROM results r JOIN checks c ON c.id = r.check_id WHERE c.test_path = 'tests/unit/test_core.py' AND c.full_name = '' ORDER BY r.recorded_at",
        ).map(name),
        mainTrace: existsSync(join(main, ".git/squeal/pytest-trace.jsonl"))
          ? readFileSync(join(main, ".git/squeal/pytest-trace.jsonl"), "utf8")
              .split("\n")
              .filter(
                (l) => l.includes('"who":"main"') && /"call":"(run|invalidate|recheck)"/.test(l),
              )
              .map((l) => l.slice(0, 1500))
          : null,
        trace: existsSync(join(main, ".git/squeal/pytest-trace.jsonl"))
          ? readFileSync(join(main, ".git/squeal/pytest-trace.jsonl"), "utf8")
              .split("\n")
              .filter((l) => l.includes(`"who":"${wt.split("/").pop()}"`))
              .map((l) => l.slice(0, 4000))
          : null,
        uv: execFileSync("uv", ["--version"], { encoding: "utf8" }).trim(),
        site: Object.fromEntries(
          [main, wt].map((root) => {
            const site = join(root, ".venv/lib/python3.13/site-packages");
            const listed = existsSync(site) ? readdirSync(site) : [];
            return [
              root === main ? "main" : "wt",
              listed
                .filter((n) => /\.pth$|editable/.test(n))
                .map((n) => [
                  n,
                  statSync(join(site, n)).isFile()
                    ? readFileSync(join(site, n), "utf8").slice(0, 400)
                    : "dir",
                ]),
            ];
          }),
        ),
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
        throw new Error(`${String(error)}\n${diagnose(main, wt3)}`);
      });
      // test_resources.py too: its baseline in main imported `app.data` through
      // `importlib.resources`, observed only, and growth a worktree's own run finds keys its
      // stored result at the next edit (003 D3), so main's result lacks it.
      expect(new Set(ranFiles(main, wt3))).toEqual(new Set([CORE_TEST, RESOURCES_TEST]));
      expect(observedKey(main)[RESOURCES_TEST]).toContain("src/app/data/__init__.py");
      expect(third.knownFailures.map((f) => f.check.testPath)).toEqual([CORE_TEST]);

      // An edit of the observed-only module re-runs its test file, and only it.
      let from = runs(main, main).length;
      let at = status(main).revision;
      writeFileSync(join(main, OBSERVED_ONLY), "# edited\nX = 3\n");
      await settle(main, "the edit of alpha.py", () => true, at);
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

      // Synced, it inherits every result of the commit: zero runs.
      from = runs(main, wt2).length;
      uvSync(ctx, wt2);
      const second = await settle(
        wt2,
        "the synced second worktree",
        (s) => s.counts.current === CHECKS,
      );
      expect(second.inherited.count, diagnose(main, wt2)).toBe(CHECKS);
      expect(second.knownFailures).toEqual([]);
      // Tiers keyed while the sync ran end before starting pytest (D2); none completed.
      expect(runs(main, wt2).slice(from)).toEqual(
        runs(main, wt2)
          .slice(from)
          .filter((r) => r.end === "crashed"),
      );
    },
  );
});
