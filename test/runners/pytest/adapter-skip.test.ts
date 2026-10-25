import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it, type TestContext } from "vitest";
import { createCompositeRunner } from "../../../src/core/daemon/composite-runner.js";
import { readHead } from "../../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import { createFsHasher } from "../../../src/core/hash/index.js";
import { statCandidates } from "../../../src/core/revision/index.js";
import { createScheduler } from "../../../src/core/scheduler/index.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../../src/core/store/index.js";
import {
  type AbsolutePath,
  DEFAULT_POLICY,
  type Policy,
  type PytestProject,
  type RunnerAdapter,
  type Scheduler,
  type Store,
} from "../../../src/core/types/index.js";
import { createPytestAdapter } from "../../../src/runners/pytest/adapter.js";
import { RUN_MISSING } from "../../helpers/baseline.js";
import { findPython, pythonEnv } from "../../helpers/pytest-env.js";
import { RecordingSink } from "../../scheduler/recording-sink.js";
import { HARNESS_INCARNATION } from "../../scheduler/store-wait.js";

/*
 * Spec 007 D6, task 007-23 (review wave 2, B3): "a module-level skip skips
 * the file's known checks". The scheduler and the store over the real
 * pytest adapter, behind the daemon's composite: after a passing
 * parametrized baseline a module skip records `skip` for `test_param[1]` and
 * `test_param[2]`, never a synthetic `test_param`; a second worktree that
 * inherited those IDs records the same; a file never seen falls back to the
 * checks it lists statically.
 */

const small = resolve(import.meta.dirname, "../../fixtures/pytest/small");
const SLOW = { timeout: 600_000 } as const;
const VERSION = "3.13";
const PROJECT: PytestProject = { name: "small", args: [], env: {}, include: ["tests/test_p*.py"] };
const PARAM = "tests/test_param.py";
const FRESH = "tests/test_param_fresh.py";
const PASSING = `import pytest\n\n\n@pytest.mark.parametrize("x", [1, 2])\ndef test_param(x):\n    assert x > 0\n`;
const skippedBy = (reason: string) =>
  PASSING.replace(
    "import pytest\n",
    `import pytest\npytest.skip("${reason}", allow_module_level=True)\n`,
  );
const SKIPPED = skippedBy("no service");

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-pytest-skip-")));
const cleanups: (() => Promise<void> | void)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  rmSync(scratch, { recursive: true, force: true });
}, 120_000);

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });

/** `uv sync --locked` in `root`; skips the test without uv or the Python, fails on CI. */
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

interface Daemon {
  readonly root: string;
  readonly scheduler: Scheduler;
  readonly sink: RecordingSink;
  readonly ran: string[];
  write(path: string, text: string): Promise<void>;
  /** Each check of `path` known to this worktree, with its outcome. */
  states(path: string): [string, string][];
}

/** One worktree's scheduler, as the daemon assembles it for a pytest project, `policy` over the defaults. */
async function openDaemon(
  root: string,
  store: Store,
  commonDir: string,
  policy: Partial<Policy> = {},
): Promise<Daemon> {
  const worktreeId = worktreeIdFor(root);
  const { PYTHONDONTWRITEBYTECODE: _, ...source } = pythonEnv();
  const adapter = await createPytestAdapter(PROJECT, {
    root: root as AbsolutePath,
    source,
    note: () => {},
    cacheDir: join(scratch, "cache", worktreeId) as AbsolutePath,
  });
  const composite = createCompositeRunner([adapter]);
  const ran: string[] = [];
  const runner: RunnerAdapter = Object.create(composite, {
    run: {
      value: (
        files: Parameters<RunnerAdapter["run"]>[0],
        options: Parameters<RunnerAdapter["run"]>[1],
      ) => {
        ran.push(...files.map((f) => f.path));
        return composite.run(files, options);
      },
    },
  });
  const sink = new RecordingSink(store, worktreeId);
  const errors: Error[] = [];
  const scheduler = createScheduler({
    root,
    worktreeId,
    store,
    runner,
    sink,
    policy: { ...DEFAULT_POLICY, pytest: [PROJECT], ...policy },
    squealVersion: "0.0.0-test",
    runsDir: storePaths(commonDir).runsDir,
    head: () => readHead(root),
    onExtraFiles: () => {},
    onError: (error) => errors.push(error),
    incarnation: HARNESS_INCARNATION,
  });
  cleanups.push(async () => {
    await scheduler.close();
    await runner.close();
    if (errors.length > 0) throw errors[0];
  });
  const hasher = createFsHasher(root, "sha1");
  await scheduler.start();
  await scheduler.idle();
  return {
    root,
    scheduler,
    sink,
    ran,
    async write(path, text) {
      writeFileSync(join(root, path), text);
      await scheduler.handleBatch({
        trigger: "watch",
        paths: await statCandidates([path], hasher),
      });
      await scheduler.idle();
    },
    states: (path) =>
      sink
        .states()
        .filter((s) => s.check.testPath === path)
        .map((s) => [s.check.kind === "test" ? s.check.fullName : "(file)", s.outcome]),
  };
}

describe("a module-level skip under the scheduler (spec 007 D6, task 007-23)", () => {
  it(
    "skips the file's known and inherited checks, and a never-seen file's static ones",
    SLOW,
    async (ctx) => {
      const main = join(scratch, "main");
      cpSync(small, main, {
        recursive: true,
        filter: (src) => !/(^|\/)(\.venv[^/]*|__pycache__|\.pytest_cache)$/.test(src),
      });
      writeFileSync(join(main, ".gitignore"), ".venv/\n");
      writeFileSync(join(main, PARAM), PASSING);
      git(main, "init", "-q", "-b", "main");
      git(main, "add", "-A");
      git(main, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture");
      const other = join(scratch, "other");
      git(main, "worktree", "add", "-q", "-b", "other", other);
      uvSync(ctx, main);
      uvSync(ctx, other);
      const commonDir = realpathSync(join(main, ".git"));
      const store = openStore(commonDir, { busyTimeoutMs: 10_000 });
      if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
      cleanups.push(() => store.close());

      const first = await openDaemon(realpathSync(main), store, commonDir, RUN_MISSING);
      expect(first.ran).toEqual([PARAM]);
      const baseline: [string, string][] = [
        ["test_param[1]", "pass"],
        ["test_param[2]", "pass"],
        ["(file)", "pass"],
      ];
      expect(first.states(PARAM)).toEqual(expect.arrayContaining(baseline));
      expect(first.states(PARAM)).toHaveLength(3);

      const skipped: [string, string][] = [
        ["test_param[1]", "skip"],
        ["test_param[2]", "skip"],
        ["(file)", "pass"],
      ];
      await first.write(PARAM, SKIPPED);
      expect(first.ran).toEqual([PARAM, PARAM]);
      expect(first.states(PARAM)).toEqual(expect.arrayContaining(skipped));
      expect(first.states(PARAM)).toHaveLength(3);

      // A file Squeal never saw has no known checks: the adapter's static enumeration stands.
      await first.write(FRESH, SKIPPED);
      expect(first.states(FRESH)).toEqual(
        expect.arrayContaining([
          ["test_param", "skip"],
          ["(file)", "pass"],
        ]),
      );
      expect(first.states(FRESH)).toHaveLength(2);

      // A fresh worktree inherits the baseline, zero runs, then skips the inherited IDs.
      const second = await openDaemon(realpathSync(other), store, commonDir);
      expect(second.ran).toEqual([]);
      expect(second.states(PARAM)).toEqual(expect.arrayContaining(baseline));
      // Another reason, another key: the first worktree's skip cannot stand for this run.
      await second.write(PARAM, skippedBy("no service here"));
      expect(second.ran).toEqual([PARAM]);
      expect(second.states(PARAM)).toEqual(expect.arrayContaining(skipped));
      expect(second.states(PARAM)).toHaveLength(3);
    },
  );
});
