import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  findPython,
  PYTHONS,
  type PytestEnv,
  pythonEnv,
  requireSynced,
  type Synced,
  syncFixture,
} from "../../helpers/pytest-env.js";

/**
 * Runs the pytest fixtures with plain `python -m pytest` in uv environments on both CI
 * Pythons, before any adapter exists: the small project's own suite passes, every
 * outcome file reports what it was designed to, a deadline kills a hung test's child
 * with its process group, and the graph oracle resolves every import form of 007 D4.
 */

const fixtures = resolve(import.meta.dirname, "../../fixtures/pytest");
const small = join(fixtures, "small");
const SLOW = { timeout: 60_000 } as const;
/** Removing a synced fixture copy, `.venv` and all, under a loaded suite. */
const CLEANUP_MS = 60_000;

interface PytestRun {
  readonly code: number | null;
  readonly output: string;
}

/** `python -m pytest -rA <args>` from the fixture root, cache and bytecode off. */
function pytest(env: PytestEnv, args: readonly string[]): PytestRun {
  const run = spawnSync(env.python, ["-m", "pytest", "-p", "no:cacheprovider", "-rA", ...args], {
    cwd: env.root,
    env: env.env,
    encoding: "utf8",
    timeout: 50_000,
  });
  return { code: run.status, output: run.stdout + run.stderr };
}

/** The short summary as `<OUTCOME> <node id>` lines, reasons cut, sorted. */
function summary(run: PytestRun): string[] {
  const start = run.output.indexOf("short test summary info");
  return run.output
    .slice(start)
    .split("\n")
    .map((line) =>
      /^(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS) (?:\[\d+\] )?(\S+?)(?::\s.*| - .*)?$/.exec(line),
    )
    .flatMap((m) => (m ? [`${m[1]} ${m[2]}`] : []))
    .sort();
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(what: string, ms: number, check: () => boolean): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe.each(PYTHONS)("the small fixture under Python %s", (version) => {
  let synced: Synced = { ok: false, reason: "the sync did not run" };
  beforeAll(() => {
    synced = syncFixture(small, version);
  }, 300_000);
  afterAll(() => {
    if (synced.ok) synced.env.cleanup();
  }, CLEANUP_MS);

  it("syncs a .venv on the requested Python", SLOW, (ctx) => {
    const env = requireSynced(ctx, synced);
    const reported = execFileSync(env.python, ["-c", "import sys; print(sys.version)"], {
      env: env.env,
      encoding: "utf8",
    });
    expect(reported.startsWith(`${version}.`)).toBe(true);
  });

  it(
    "passes its own suite: testpaths, conftest chain, pytest_plugins, pytest11, mocker",
    SLOW,
    (ctx) => {
      const run = pytest(requireSynced(ctx, synced), []);
      expect(run.code, run.output).toBe(0);
      expect(summary(run)).toEqual([
        "PASSED tests/test_entry_plugin.py::test_entry_plugin",
        "PASSED tests/test_resources.py::test_values",
        "PASSED tests/unit/test_core.py::test_computed",
        "PASSED tests/unit/test_core.py::test_data",
        "PASSED tests/unit/test_core.py::test_dynamic",
        "PASSED tests/unit/test_core.py::test_fixtures",
        "PASSED tests/unit/test_core.py::test_total[xs0-6]",
        "PASSED tests/unit/test_core.py::test_total[xs1-0]",
      ]);
    },
  );

  it("reports every designed outcome of outcomes/ in one batch", SLOW, (ctx) => {
    const run = pytest(requireSynced(ctx, synced), [
      "--continue-on-collection-errors",
      "outcomes/test_pass.py",
      "outcomes/test_fail.py",
      "outcomes/test_collection_error.py",
      "outcomes/test_phases.py",
    ]);
    expect(run.code, run.output).toBe(1);
    expect(summary(run)).toEqual([
      "ERROR outcomes/test_collection_error.py",
      "ERROR outcomes/test_phases.py::test_setup_error",
      // the teardown error after a passing call reports both
      "ERROR outcomes/test_phases.py::test_teardown_error",
      "FAILED outcomes/test_fail.py::test_fails",
      // strict xpass fails; non-strict xpass and xfail keep their own outcomes
      "FAILED outcomes/test_phases.py::test_strict_xpass",
      "PASSED outcomes/test_fail.py::test_passes_beside_the_failure",
      "PASSED outcomes/test_pass.py::test_passes",
      "PASSED outcomes/test_phases.py::test_teardown_error",
      "SKIPPED outcomes/test_phases.py:24",
      "XFAIL outcomes/test_phases.py::test_xfail",
      "XPASS outcomes/test_phases.py::test_xpass",
    ]);
    expect(run.output).toMatch(
      /ERROR at setup of test_setup_error[\s\S]*ValueError: fixture setup/,
    );
    expect(run.output).toMatch(
      /ERROR at teardown of test_teardown_error[\s\S]*ValueError: fixture teardown/,
    );
    expect(run.output).toMatch(/ModuleNotFoundError: No module named 'app\.not_there'/);
  });

  it("dies with its spawned child when the deadline kills the process group", SLOW, async (ctx) => {
    const env = requireSynced(ctx, synced);
    const pidFile = join(env.root, "..", "hang.pid");
    const child = spawn(
      env.python,
      ["-m", "pytest", "-p", "no:cacheprovider", "outcomes/test_hang.py"],
      {
        cwd: env.root,
        env: { ...env.env, FIXTURE_HANG_PID_FILE: pidFile },
        detached: true,
        stdio: "ignore",
      },
    );
    const exited = new Promise<NodeJS.Signals | null>((done) =>
      child.on("exit", (_code, signal) => done(signal)),
    );
    const group = -(child.pid ?? 0);
    try {
      await until("the hung test's child", 30_000, () => existsSync(pidFile));
      const grandchild = Number(readFileSync(pidFile, "utf8"));
      expect(alive(grandchild)).toBe(true);
      // the deadline as 007 D6 has it: SIGTERM to the group, SIGKILL two seconds later
      process.kill(group, "SIGTERM");
      const hard = setTimeout(() => alive(child.pid ?? 0) && process.kill(group, "SIGKILL"), 2_000);
      expect(await exited).not.toBeNull();
      clearTimeout(hard);
      await until("the child to die with the group", 5_000, () => !alive(grandchild));
    } finally {
      try {
        process.kill(group, "SIGKILL");
      } catch {
        // the group is already gone
      }
    }
  });

  it(
    "resolves every D4 import form of src/app/core.py with the ast_graph.py oracle",
    SLOW,
    (ctx) => {
      const env = requireSynced(ctx, synced);
      const out = join(env.root, "..", "graph.json");
      execFileSync(
        env.python,
        ["-I", join(fixtures, "ast_graph.py"), env.root, out, "--skip-type-checking"],
        { env: env.env, stdio: "ignore" },
      );
      const files = JSON.parse(readFileSync(out, "utf8")).files;
      const core = files["src/app/core.py"];
      expect(core.edges).toEqual([
        "packages/other/src/acme/ns/mod.py", // namespace package from the workspace member
        "packages/other/src/other/__init__.py", // setuptools editable
        "src/app/__init__.py", // the parent package runs on import
        "src/app/dunder_literal.py", // __import__ with a literal
        "src/app/dyn_literal.py", // import_module with a literal
        "src/app/helpers.py", // relative
        "src/app/lazy.py", // function-local
        "src/app/slow_impl.py", // the except ImportError arm
        "src/app/util/__init__.py", // from a import name
        "src/app/util/numbers.py", // import a.b.c
        "src/app/util/strings.py", // from a import b as the submodule
      ]);
      expect(core.edges).not.toContain("src/app/typing_only.py");
      expect(core.computed).toEqual([35]);
      // the try arm's absent module is a candidate
      expect(core.candidates).toContain("src/app/fast_impl.py");
      expect(files["outcomes/test_collection_error.py"].unresolved).toEqual(["app.not_there"]);
    },
  );
});

describe("gen-big.py", () => {
  const scratch = mkdtempSync(join(tmpdir(), "squeal-pytest-big-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  const digest = (root: string) => {
    const hash = createHash("sha256");
    const files = readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => relative(root, join(e.parentPath, e.name)))
      .sort();
    for (const file of files) hash.update(file).update(readFileSync(join(root, file)));
    return { hash: hash.digest("hex"), files };
  };

  it("writes 1,000 modules and 200 test files, deterministically, under 5 s", SLOW, (ctx) => {
    const found = findPython("3.13");
    if (!found.ok && process.env.CI) throw new Error(found.reason);
    if (!found.ok) return ctx.skip(`uv or the Python version is absent: ${found.reason}`);
    const generate = (out: string) => {
      const started = performance.now();
      execFileSync(found.python, ["-I", join(fixtures, "gen-big.py"), out], {
        env: pythonEnv(),
        stdio: "ignore",
      });
      return performance.now() - started;
    };
    const [a, b] = [join(scratch, "a"), join(scratch, "b")];
    expect(generate(a)).toBeLessThan(5_000);
    generate(b);
    const first = digest(a);
    expect(digest(b).hash).toBe(first.hash);
    const modules = first.files.filter((f) => /\/m\d+\.py$/.test(f));
    const tests = first.files.filter((f) => /^tests\/t\d+\/test_\d+\.py$/.test(f));
    expect([modules.length, tests.length]).toEqual([1_000, 200]);
  });

  it("writes its default output where git ignores it", () => {
    // the trailing slash lets git match the directory pattern before it exists
    const ignored = execFileSync("git", ["check-ignore", "big/"], {
      cwd: fixtures,
      encoding: "utf8",
    });
    expect(ignored.trim()).toBe("big/");
  });
});

describe("the repository tree", () => {
  it("holds no Python artefacts under the pytest fixtures", () => {
    const artefacts = readdirSync(fixtures, { recursive: true, withFileTypes: true })
      .filter((e) => /^(\.venv.*|__pycache__|\.pytest_cache|.*\.egg-info)$/.test(e.name))
      .map((e) => relative(fixtures, join(e.parentPath, e.name)));
    expect(artefacts).toEqual([]);
  });
});
