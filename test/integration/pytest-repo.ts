import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { afterAll, type TestContext } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { readStatus } from "../../src/core/status/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { childEnv, ping } from "../daemon/helpers.js";
import { readRuns, until } from "../e2e/support.js";
import { findPython, pythonEnv } from "../helpers/pytest-env.js";

/*
 * The pytest integration tests' repository (spec 007 Testing): the small
 * pytest fixture beside a one-file Vitest suite, committed, with worktrees,
 * `uv sync` and one daemon per worktree run from the sources. Each test
 * file calls `pytestRepos` once at its top level: its scratch directory,
 * runtime directory and daemons are cleaned up after it.
 */

const REPO = resolve(import.meta.dirname, "../..");
const CLI = join(REPO, "src/cli/index.ts");
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const SMALL = join(REPO, "test/fixtures/pytest/small");
export const SETTLE_MS = 180_000;
const VERSION = "3.13";

export const CORE_TEST = "tests/unit/test_core.py";
export const RESOURCES_TEST = "tests/test_resources.py";
export const ENTRY_TEST = "tests/test_entry_plugin.py";
export const PYTEST_FILES = [ENTRY_TEST, RESOURCES_TEST, CORE_TEST];
export const VITEST_FILE = "vitest/sum.test.ts";

const VITEST_FILES: Readonly<Record<string, string>> = {
  "package.json": `${JSON.stringify({ name: "mixed", private: true, type: "module" })}\n`,
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["vitest/**/*.test.ts"] } });\n`,
  "js/sum.ts": "export const sum = (a: number, b: number) => a + b;\n",
  [VITEST_FILE]: `import { expect, test } from "vitest";\nimport { sum } from "../js/sum.js";\ntest("sums", () => expect(sum(1, 2)).toBe(3));\n`,
};

export const git = (cwd: string, args: readonly string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });

export function pytestRepos(name: string) {
  /**
   * Inside the repository, so the fixture's Vitest suite resolves `vitest` from
   * its `node_modules`; not under `test/fixtures/pytest`, which must hold no `.venv`.
   */
  const scratch = join(REPO, "test/fixtures/vitest/.tmp", `${name}-${randomUUID()}`);
  const runtime = realpathSync(mkdtempSync("/tmp/sq-"));
  const daemons: ChildProcess[] = [];
  afterAll(async () => {
    for (const daemon of daemons) daemon.kill("SIGTERM");
    await Promise.all(
      daemons.map((d) =>
        d.exitCode === null ? new Promise((done) => d.once("exit", done)) : null,
      ),
    );
    rmSync(scratch, { recursive: true, force: true });
    rmSync(runtime, { recursive: true, force: true });
    // Stopping daemons and removing synced environments outlasts Vitest's 10 s hook default under load.
  }, 120_000);

  const commit = (cwd: string, message: string) =>
    git(cwd, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message]);

  /** The fixture with the Vitest suite, `files` over both, committed on `main` in `<scratch>/<repo>`. */
  function createRepo(repo: string, files: Readonly<Record<string, string>>): string {
    mkdirSync(scratch, { recursive: true });
    const main = join(scratch, repo);
    cpSync(SMALL, main, {
      recursive: true,
      filter: (src) => !/(^|\/)(\.venv|__pycache__)$/.test(src),
    });
    for (const [path, text] of Object.entries({ ...VITEST_FILES, ...files })) {
      mkdirSync(dirname(join(main, path)), { recursive: true });
      writeFileSync(join(main, path), text);
    }
    git(main, ["init", "-q", "-b", "main"]);
    git(main, ["add", "-A"]);
    commit(main, "fixture");
    return realpathSync(main);
  }

  function addWorktree(main: string, worktree: string): string {
    const root = join(scratch, worktree);
    git(main, ["worktree", "add", "-q", "-b", worktree, root]);
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

  const socketOf = (root: string) => socketPathFor(worktreeIdFor(root), childEnv(runtime));

  /** `squeal daemon <root>` from the sources, as the hooks would spawn it from a plugin. */
  async function startDaemon(root: string): Promise<void> {
    const child = spawn(process.execPath, ["--import", TSX, CLI, "daemon", root], {
      cwd: root,
      env: childEnv(runtime),
      stdio: "ignore",
    });
    daemons.push(child);
    await until(`the daemon of ${root}`, SETTLE_MS, async () => {
      const answer = await ping(socketOf(root), 1_000);
      return answer?.phase === "ready" ? answer : null;
    });
  }

  /** A reconciliation pass of the daemon of `root`, as `squeal sync` asks one; resolves when asked. */
  async function sync(root: string): Promise<void> {
    const response = await requestDaemon(socketOf(root), { type: "sync" }, 10_000);
    if (!response.ok) throw new Error(`sync refused: ${JSON.stringify(response)}`);
  }

  return { commit, createRepo, addWorktree, uvSync, startDaemon, sync };
}

export const status = (root: string): StatusSnapshot => {
  const result = readStatus(root);
  if (!result.available) throw new Error(`status unavailable: ${result.message}`);
  return result;
};

/** Status once nothing is pending past revision `after` and `accept` holds. */
export const settle = (
  root: string,
  what: string,
  accept: (s: StatusSnapshot) => boolean,
  after = -1,
) =>
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

const storePath = (main: string) => join(main, ".git/squeal/store.sqlite");
export const runs = (main: string, root: string) => readRuns(storePath(main), worktreeIdFor(root));
export const ranFiles = (main: string, root: string) =>
  runs(main, root).flatMap((r) => r.testFiles);
/** The test files of the runs of `root` after its first `from` runs. */
export const ranSince = (main: string, root: string, from: number) =>
  runs(main, root)
    .slice(from)
    .flatMap((r) => r.testFiles);

/** A shared meta row of the repository's store, parsed; `null` when absent. */
export function metaValue(main: string, key: string): unknown {
  const db = new DatabaseSync(storePath(main), { readOnly: true });
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row === undefined ? null : JSON.parse(row.value);
  } finally {
    db.close();
  }
}
