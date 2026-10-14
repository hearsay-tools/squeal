import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, type TestContext } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { readStatus } from "../../src/core/status/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import { childEnv, ping } from "../daemon/helpers.js";
import { readRuns, until } from "../e2e/support.js";
import { codexRecorded, sessionOf } from "../harness/codex/helpers.js";
import { recorded } from "../harness/helpers.js";
import { findPython, pythonEnv } from "../helpers/pytest-env.js";

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

const REPO = resolve(import.meta.dirname, "../..");
const CLI = join(REPO, "src/cli/index.ts");
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const SMALL = join(REPO, "test/fixtures/pytest/small");
/**
 * Inside the repository, so the fixture's Vitest suite resolves `vitest` from
 * its `node_modules`; not under `test/fixtures/pytest`, which must hold no `.venv`.
 */
const scratch = join(REPO, "test/fixtures/vitest/.tmp", `pytest-${randomUUID()}`);
const runtime = realpathSync(mkdtempSync("/tmp/sq-"));
const SLOW = { timeout: 600_000 } as const;
const SETTLE_MS = 180_000;
const VERSION = "3.13";

const daemons: ChildProcess[] = [];
afterAll(async () => {
  for (const daemon of daemons) daemon.kill("SIGTERM");
  await Promise.all(
    daemons.map((d) => (d.exitCode === null ? new Promise((done) => d.once("exit", done)) : null)),
  );
  rmSync(scratch, { recursive: true, force: true });
  rmSync(runtime, { recursive: true, force: true });
});

const git = (cwd: string, args: readonly string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
const commit = (cwd: string, message: string) =>
  git(cwd, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message]);

const PROJECT = { name: "small", include: ["tests/**/test_*.py"] };
const CORE_TEST = "tests/unit/test_core.py";
const RESOURCES_TEST = "tests/test_resources.py";
const OBSERVED_ONLY = "src/app/plugins/alpha.py";
const PYTEST_FILES = ["tests/test_entry_plugin.py", RESOURCES_TEST, CORE_TEST];
const VITEST_FILE = "vitest/sum.test.ts";
/** The pytest fixture's eight tests and the Vitest one, plus each file's file-level check. */
const CHECKS = 9 + 4;

const FILES: Readonly<Record<string, string>> = {
  ".gitignore": "node_modules/\n.venv/\n",
  "package.json": `${JSON.stringify({ name: "mixed", private: true, type: "module" })}\n`,
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["vitest/**/*.test.ts"] } });\n`,
  "squeal.config.json": `${JSON.stringify({ pytest: [PROJECT] }, null, 2)}\n`,
  "js/sum.ts": "export const sum = (a: number, b: number) => a + b;\n",
  [VITEST_FILE]: `import { expect, test } from "vitest";\nimport { sum } from "../js/sum.js";\ntest("sums", () => expect(sum(1, 2)).toBe(3));\n`,
};

function createRepo(): string {
  const main = join(scratch, "main");
  cpSync(SMALL, main, {
    recursive: true,
    filter: (src) => !/(^|\/)(\.venv|__pycache__)$/.test(src),
  });
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(main, path)), { recursive: true });
    writeFileSync(join(main, path), text);
  }
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["add", "-A"]);
  commit(main, "fixture");
  return realpathSync(main);
}

function addWorktree(main: string, name: string): string {
  const root = join(scratch, name);
  git(main, ["worktree", "add", "-q", "-b", name, root]);
  return realpathSync(root);
}

/** `uv sync --locked` in `root` on the fixture's Python; skips the test without uv, fails on CI. */
function uvSync(ctx: TestContext, root: string): void {
  const found = findPython(VERSION);
  if (!found.ok) {
    if (process.env.CI) throw new Error(`pytest fixture unavailable on CI: ${found.reason}`);
    ctx.skip(`uv or Python ${VERSION} is absent: ${found.reason}`);
    return;
  }
  execFileSync("uv", ["sync", "--locked", "--python", found.python], {
    cwd: root,
    env: pythonEnv(),
    stdio: "pipe",
  });
}

/** `squeal daemon <root>` from the sources, as the hooks would spawn it from a plugin. */
async function startDaemon(root: string): Promise<void> {
  const env = childEnv(runtime);
  const child = spawn(process.execPath, ["--import", TSX, CLI, "daemon", root], {
    cwd: root,
    env,
    stdio: "ignore",
  });
  daemons.push(child);
  const { socketPathFor } = await import("../../src/core/daemon/paths.js");
  const socket = socketPathFor(worktreeIdFor(root), env);
  await until(`the daemon of ${root}`, SETTLE_MS, async () => {
    const answer = await ping(socket, 1_000);
    return answer?.phase === "ready" ? answer : null;
  });
}

const status = (root: string): StatusSnapshot => {
  const result = readStatus(root);
  if (!result.available) throw new Error(`status unavailable: ${result.message}`);
  return result;
};

/** Status once nothing is pending past revision `after` and `accept` holds. */
const settle = (root: string, what: string, accept: (s: StatusSnapshot) => boolean, after = -1) =>
  until(what, SETTLE_MS, async () => {
    const s = status(root);
    const quiet =
      s.revision > after &&
      s.runnerPartPending !== true &&
      s.counts.pending + s.testFilesWithoutChecks.pending === 0;
    if (quiet && accept(s)) return s;
    const { revision, counts, testFilesWithoutChecks, knownFailures, daemonNotes } = s;
    throw new Error(
      JSON.stringify({ revision, counts, testFilesWithoutChecks, knownFailures, daemonNotes }),
    );
  });

const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };
const CODEX_SESSION = sessionOf("exec", "session-start");
const claude = async (name: "session-start" | "post-tool-batch", root: string) =>
  (await runHook(name, recorded(name, root), deps)).stdout;
const codex = async (name: "session-start" | "post-tool-use", root: string) =>
  (await runCodexHook(name, codexRecorded("exec", name, root, CODEX_SESSION), deps)).stdout;

const storePath = (main: string) => join(main, ".git/squeal/store.sqlite");
const runs = (main: string, root: string) => readRuns(storePath(main), worktreeIdFor(root));
const ranFiles = (main: string, root: string) => runs(main, root).flatMap((r) => r.testFiles);
/** The test files of the runs of `root` after its first `from` runs. */
const ranSince = (main: string, root: string, from: number) =>
  runs(main, root)
    .slice(from)
    .flatMap((r) => r.testFiles);

function observedKey(main: string): Record<string, string[]> {
  const db = new DatabaseSync(storePath(main), { readOnly: true });
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get("pytest.observed.small") as
      | { value: string }
      | undefined;
    return row === undefined ? {} : (JSON.parse(row.value) as Record<string, string[]>);
  } finally {
    db.close();
  }
}

describe("a repository with a Vitest suite and a pytest project (spec 007)", () => {
  it(
    "baselines, inherits into a synced worktree, keys observed paths and delivers a pytest PASS -> FAIL",
    SLOW,
    async (ctx) => {
      mkdirSync(scratch, { recursive: true });
      const main = createRepo();
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
      );
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
      expect(second.inherited.count).toBe(CHECKS);
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
