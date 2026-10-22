import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";
import { pytestObservedStore } from "../../../src/core/daemon/pytest-runners.js";
import {
  type AbsolutePath,
  type PytestProject,
  pytestObservedMetaKey,
  type TestFileRef,
} from "../../../src/core/types/index.js";
import { createPytestAdapter } from "../../../src/runners/pytest/adapter.js";
import { readEnvironment } from "../../../src/runners/pytest/environment/index.js";
import { runPytest } from "../../../src/runners/pytest/run/run.js";
import { findPython, PYTHONS, pythonEnv } from "../../helpers/pytest-env.js";
import { pytestRepos } from "../../integration/pytest-repo.js";
import { openHarness, openRepoStore } from "../../scheduler/helpers.js";

/*
 * Task 007-55, live: the small fixture's `outcomes/test_spawn_module.py`
 * runs `python -m app` and `outcomes/test_spawn_script.py` the `app-cli`
 * console script; neither imports `app.cli`. Their child processes record
 * what they import under them, so an edit of `src/app/cli.py` re-keys and
 * runs both through the scheduler, and a break there fails both.
 * `outcomes/test_spawn_tool.py` runs `python tool.py`, a script that imports
 * nothing, which its child records at start-up (review 0.1.268 B2).
 */

const SLOW = { timeout: 300_000 } as const;
const MODULE_TEST = "outcomes/test_spawn_module.py";
const SCRIPT_TEST = "outcomes/test_spawn_script.py";
const MARKER_TEST = "outcomes/test_site_marker.py";
const TOOL_TEST = "outcomes/test_spawn_tool.py";
const CLI = "src/app/cli.py";
const TOOL = "outcomes/tool.py";
const PROJECT: PytestProject = {
  name: "small",
  args: [],
  env: {},
  include: [MODULE_TEST, SCRIPT_TEST],
};
const ref = (path: string): TestFileRef => ({ project: "small", path });

const repos = pytestRepos("spawned");

describe.each(PYTHONS)(
  "a test's child Python processes under Python %s (task 007-55)",
  (version) => {
    const repositories = new Map<string, AbsolutePath>();
    /** A fixture repository, committed and synced on `version` once for this block. */
    function synced(ctx: TestContext, name = "main"): AbsolutePath {
      const known = repositories.get(name);
      if (known !== undefined) return known;
      const found = findPython(version);
      if (!found.ok) {
        if (process.env.CI) throw new Error(`pytest fixture unavailable on CI: ${found.reason}`);
        return ctx.skip(`uv or Python ${version} is absent: ${found.reason}`);
      }
      const repo = repos.createRepo(`${name}-${version}`, {}) as AbsolutePath;
      execFileSync("uv", ["sync", "--locked", "--python", found.python], {
        cwd: repo,
        env: pythonEnv(),
        stdio: "pipe",
      });
      repositories.set(name, repo);
      return repo;
    }

    /** The scheduler over the real pytest adapter for `project`, in its own repository `name`. */
    async function open(ctx: TestContext, name: string, project: PytestProject) {
      const root = synced(ctx, name);
      const commonDir = join(root, ".git");
      const store = openRepoStore(commonDir);
      const pytest = await createPytestAdapter(project, {
        root,
        source: pythonEnv(),
        observed: pytestObservedStore(store, project.name),
        cacheDir: join(root, "..", `pytest-cache-${name}-${version}`) as AbsolutePath,
      });
      const h = await openHarness(root, store, commonDir, { adapters: [pytest] });
      const outcome = (path: string) =>
        store.knownStates
          .list(h.worktreeId)
          .find((s) => s.check.testPath === path && s.check.kind === "test")?.outcome;
      const key = (path: string) =>
        store.testFileKeys
          .list(h.worktreeId)
          .find((r) => r.testFile.project === project.name && r.testFile.path === path)?.key;
      return { root, store, pytest, h, outcome, key };
    }

    it(
      "an edit of a module only their `python -m` child or console script imports re-keys and runs them, and a break there fails them",
      SLOW,
      async (ctx) => {
        const { root, store, pytest, h, outcome, key } = await open(ctx, "main", PROJECT);
        await h.scheduler.start();
        await h.scheduler.idle();
        expect([outcome(MODULE_TEST), outcome(SCRIPT_TEST)]).toEqual(["pass", "pass"]);

        // Each file holds what its own child found: only `python -m app` runs `__main__.py`.
        const observed = JSON.parse(store.meta.get(pytestObservedMetaKey(PROJECT.name)) ?? "{}");
        expect(observed[MODULE_TEST]).toEqual(
          expect.arrayContaining(["src/app/__main__.py", CLI, "src/app/version.py"]),
        );
        expect(observed[SCRIPT_TEST]).toEqual(expect.arrayContaining([CLI, "src/app/version.py"]));
        expect(observed[SCRIPT_TEST]).not.toContain("src/app/__main__.py");
        expect((await pytest.closure(ref(SCRIPT_TEST))).paths).toContain(CLI);
        expect(await pytest.affected([CLI])).toEqual({
          direct: [ref(MODULE_TEST), ref(SCRIPT_TEST)],
          transitive: [],
        });

        const keys = () => [MODULE_TEST, SCRIPT_TEST].map(key);
        const before = keys();
        expect(before.every((key) => key !== undefined)).toBe(true);
        const text = readFileSync(join(root, CLI), "utf8");
        try {
          h.write(CLI, `${text}\nraise SystemExit(3)\n`);
          await h.batch(CLI);
          await h.scheduler.idle();
          const after = keys();
          expect(after[0]).not.toBe(before[0]);
          expect(after[1]).not.toBe(before[1]);
          expect([outcome(MODULE_TEST), outcome(SCRIPT_TEST)]).toEqual(["fail", "fail"]);
        } finally {
          h.write(CLI, text);
        }
        await h.batch(CLI);
        await h.scheduler.idle();
        expect([outcome(MODULE_TEST), outcome(SCRIPT_TEST)]).toEqual(["pass", "pass"]);
      },
    );

    it(
      "an edit of a script that imports nothing, which a test runs as `python tool.py`, re-keys and runs it, and a break there fails it",
      SLOW,
      async (ctx) => {
        const project = { ...PROJECT, include: [TOOL_TEST] };
        const { root, pytest, h, outcome, key } = await open(ctx, "tool", project);
        await h.scheduler.start();
        await h.scheduler.idle();
        expect(outcome(TOOL_TEST)).toBe("pass");
        expect((await pytest.closure(ref(TOOL_TEST))).paths).toContain(TOOL);
        expect(await pytest.affected([TOOL])).toEqual({ direct: [ref(TOOL_TEST)], transitive: [] });

        const before = key(TOOL_TEST);
        expect(before).not.toBeUndefined();
        const text = readFileSync(join(root, TOOL), "utf8");
        try {
          h.write(TOOL, 'print("broken")\n');
          await h.batch(TOOL);
          await h.scheduler.idle();
          expect(key(TOOL_TEST)).not.toBe(before);
          expect(outcome(TOOL_TEST)).toBe("fail");
        } finally {
          h.write(TOOL, text);
        }
      },
    );

    it(
      "the environment's own sitecustomize still runs in pytest and in a child, and pytest records nothing as spawned",
      SLOW,
      async (ctx) => {
        const root = synced(ctx);
        const site = join(root, `.venv/lib/python${version}/site-packages`);
        const own = join(site, "sitecustomize.py");
        writeFileSync(own, 'import builtins\n\nbuiltins.FIXTURE_SITECUSTOMIZE = "ran"\n');
        try {
          const project = { ...PROJECT, include: [MARKER_TEST, MODULE_TEST] };
          const environment = await readEnvironment(root, project, pythonEnv());
          if (environment.state !== "ready") throw new Error(`environment: ${environment.state}`);
          const logDir = join(root, "..", `logs-${version}`) as AbsolutePath;
          const { report } = await runPytest({
            root,
            project,
            environment,
            files: [ref(MARKER_TEST), ref(MODULE_TEST)],
            logDir,
            timeoutMs: 60_000,
            cacheDir: join(root, "..", `pytest-cache-${version}`) as AbsolutePath,
          });
          expect(report.completedFiles).toEqual([ref(MARKER_TEST), ref(MODULE_TEST)]);
          expect(report.results.map((r) => [r.check.fullName, r.outcome])).toEqual([
            ["test_environment_sitecustomize_ran", "pass"],
            ["test_module_runs", "pass"],
          ]);
          const events = readFileSync(join(logDir, "events-0.jsonl"), "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as { type: string; pid?: number; ctx?: string });
          const pytestPid = events.find((e) => e.type === "start")?.pid;
          const spawned = events.filter((e) => e.type === "spawned");
          expect(spawned.length).toBeGreaterThan(0);
          expect(spawned.filter((e) => e.pid === pytestPid)).toEqual([]);
          expect(new Set(spawned.map((e) => e.ctx))).toEqual(new Set([join(root, MODULE_TEST)]));
        } finally {
          rmSync(own, { force: true });
        }
      },
    );
  },
);
