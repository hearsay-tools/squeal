import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { readStatus } from "../../src/core/status/snapshot.js";
import { copyJestRuntime } from "../../src/harness/build.js";
import {
  childEnv,
  daemonSuite,
  type FixtureRepo,
  spawnCli,
  stopStrays,
  waitFor,
  waitReady,
} from "../daemon/helpers.js";
import { isAlive } from "../daemon/strays.js";
import { git } from "../hash/git-repo.js";
import { installJest, JEST_MAJORS, type JestMajor } from "../helpers/jest-env.js";
import { buildPluginDist } from "./spec-026-build.js";

/*
 * Spec 028 Testing, proof (row 028-08): the plugin's bundled `squeal` CLI, its
 * hooks and a real daemon on a Jest monorepo, on Jest 29.7.0 and 30.5.2.
 * `squeal setup` seeds both package projects and skips the empty root config
 * (D1.2); a foreground full run passes; an edit to a `packages/core` helper
 * that a `packages/app` test imports by its workspace name selects and fails
 * exactly the two importing files while the third stays current, and its
 * revert passes them again (D3); with `testCommand.denyWhenCurrent` on, the
 * PreToolUse hook denies a plain `jest <file>` once and lets a piped command
 * and an Nx command run (D6.3); `squeal stop` ends the daemon and every
 * process it started, warm Jest workers included (D7). Foreground
 * `run --all --wait` and `status --wait` keep it independent of host load.
 */

/** The plugin's `dist/` with the Jest runtime the runner hosts load (as spec 027's E2E). */
const suite = daemonSuite({}, (options) => {
  const built = buildPluginDist(options);
  copyJestRuntime(dirname(dirname(built.cli)));
  return built;
});

const HELPER = "packages/core/src/helper.js";
const CORE_TEST = "packages/core/test/helper.test.js";
const APP_TEST = "packages/app/test/uses-core.test.js";
const ALONE_TEST = "packages/app/test/alone.test.js";
const helper = (factor: number) => `exports.double = (n) => n * ${factor};\n`;

/** `saas-boilerplate`'s shape in small: an empty root config above two package configs. */
const FILES: Readonly<Record<string, string>> = {
  ".gitignore": "node_modules/\n",
  "package.json": `${JSON.stringify({ name: "mono", private: true })}\n`,
  "jest.config.mjs": "export default {};\n",
  "packages/core/package.json": `${JSON.stringify({ name: "@mono/core", main: "src/helper.js" })}\n`,
  "packages/core/jest.config.js":
    'module.exports = { displayName: "core", testEnvironment: "node" };\n',
  [HELPER]: helper(2),
  [CORE_TEST]:
    'const { double } = require("../src/helper");\ntest("doubles", () => expect(double(2)).toBe(4));\n',
  "packages/app/package.json": `${JSON.stringify({ name: "@mono/app", private: true })}\n`,
  "packages/app/jest.config.js":
    'module.exports = { displayName: "app", testEnvironment: "node" };\n',
  [APP_TEST]:
    'const { double } = require("@mono/core");\ntest("uses core", () => expect(double(3)).toBe(6));\n',
  [ALONE_TEST]: 'test("alone", () => expect(1 + 1).toBe(2));\n',
};

/**
 * A committed copy of `FILES` outside every checkout, with the installed Jest
 * `major` and a pnpm-style workspace link `@mono/core` in `node_modules`, and
 * a private `HOME` and runtime directory. Its daemons stop after the test.
 */
function monorepo(major: JestMajor): FixtureRepo {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sq-jest-e2e-")));
  const root = join(dir, "repo");
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, "node_modules/@mono"), { recursive: true });
  symlinkSync(
    realpathSync(join(installJest(major), "node_modules/jest")),
    join(root, "node_modules/jest"),
  );
  symlinkSync("../../packages/core", join(root, "node_modules/@mono/core"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "fixture"]);
  const worktreeId = worktreeIdFor(root);
  const runtimeDir = realpathSync(mkdtempSync("/tmp/sq-"));
  mkdirSync(join(dir, "home"));
  const env = { ...childEnv(runtimeDir), HOME: join(dir, "home") };
  const repo: FixtureRepo = {
    root,
    commonDir: join(root, ".git"),
    worktreeId,
    runtimeDir,
    socketPath: socketPathFor(worktreeId, { XDG_RUNTIME_DIR: runtimeDir }),
    env,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(runtimeDir, { recursive: true, force: true });
    },
  };
  onTestFinished(async () => {
    await stopStrays(root);
    repo.cleanup();
  });
  return repo;
}

/** `squeal <args>` in `cwd` of `repo` as its own process: exit code and output. */
async function cli(repo: FixtureRepo, args: readonly string[], env = repo.env) {
  const run = spawnCli(suite.cli, args, { cwd: repo.root, env });
  const { code } = await run.exited;
  return { code, out: `${run.stdout()}${run.stderr()}` };
}

/** A PATH holding only `git`: setup sees no harness CLI, so it changes nothing outside the repo. */
function gitOnlyPath(repo: FixtureRepo): string {
  const bin = join(repo.env.HOME as string, "bin");
  mkdirSync(bin, { recursive: true });
  const found = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  symlinkSync(found, join(bin, "git"));
  return bin;
}

/** Runs the plugin's `hook` bundle with `input` as Claude Code sends it: its parsed stdout. */
function hook(repo: FixtureRepo, name: string, input: object): Record<string, unknown> | null {
  const bundle = join(dirname(dirname(suite.cli)), `${name}.mjs`);
  const ran = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", bundle], {
    input: JSON.stringify(input),
    env: repo.env,
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(ran.status, ran.stderr).toBe(0);
  return ran.stdout === "" ? null : (JSON.parse(ran.stdout) as Record<string, unknown>);
}

/** Every process below `pid`, with its arguments, from `ps`. */
function descendants(pid: number): { pid: number; args: string }[] {
  const table = execFileSync("ps", ["-A", "-o", "pid=,ppid=,args="], { encoding: "utf8" });
  const rows = table.split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return m === null ? [] : [{ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] as string }];
  });
  const found: { pid: number; args: string }[] = [];
  const queue = [pid];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const row of rows.filter((r) => r.ppid === next)) {
      found.push({ pid: row.pid, args: row.args });
      queue.push(row.pid);
    }
  }
  return found;
}

const SESSION = "28082808-0000-4000-8000-000000000028";

describe.each(JEST_MAJORS)(
  "spec 028 end to end on Jest %i (row 028-08)",
  { timeout: 180_000 },
  (major) => {
    it("seeds, validates, selects across packages, denies once and stops clean", async () => {
      const repo = monorepo(major);

      // D1.2: setup seeds both package projects and skips the empty root catch-all.
      const setup = await cli(repo, ["setup", "--yes", "--no-warmup"], {
        ...repo.env,
        PATH: gitOnlyPath(repo),
      });
      expect(setup.code, setup.out).toBe(0);
      const config = JSON.parse(readFileSync(join(repo.root, "squeal.config.json"), "utf8"));
      expect(config.jest).toEqual([
        { name: "app", config: "packages/app/jest.config.js" },
        { name: "core", config: "packages/core/jest.config.js" },
      ]);
      expect(setup.out).toContain(
        "skipped Jest config jest.config.mjs: it lists no projects and sits above packages/app/jest.config.js, packages/core/jest.config.js",
      );
      config.testCommand = { ...config.testCommand, denyWhenCurrent: true };
      writeFileSync(join(repo.root, "squeal.config.json"), `${JSON.stringify(config, null, 2)}\n`);
      git(repo.root, ["add", "squeal.config.json"]);
      git(repo.root, ["commit", "-qm", "squeal setup"]);

      // A foreground full run: every file passes and is current.
      const daemon = suite.daemon(repo);
      await waitReady(repo, daemon);
      const all = await cli(repo, ["run", "--all", "--wait"]);
      expect(all.code, all.out).toBe(0);
      expect(all.out).toContain("no known failures; 3 test files, 0 already current, 3 run now");
      const base = readStatus(repo.root as never);
      expect(base.available && base.knownFailures).toEqual([]);
      expect(base.available && base.breakdown.currentByOutcome.pass).toBe(6);

      // D3: the core helper's edit selects its own test and the app test that imports it by name.
      writeFileSync(join(repo.root, HELPER), helper(3));
      const broken = await cli(repo, ["status", "--wait", "60000", HELPER]);
      expect(broken.code, broken.out).toBe(1);
      expect(broken.out).toContain(`Selected: ${APP_TEST}, ${CORE_TEST}\n`);
      expect(broken.out).toContain(`FAIL  [app] ${APP_TEST} > uses core`);
      expect(broken.out).toContain(`FAIL  [core] ${CORE_TEST} > doubles`);
      expect(broken.out).toContain(
        "Worktree: known failures 2 (2 tests); all 3 test files current",
      );
      expect(broken.out).not.toContain(ALONE_TEST);

      writeFileSync(join(repo.root, HELPER), helper(2));
      const fixed = await cli(repo, ["status", "--wait", "60000", HELPER]);
      expect(fixed.code, fixed.out).toBe(0);
      expect(fixed.out).toContain(`Selected: ${APP_TEST}, ${CORE_TEST}\n`);
      expect(fixed.out).toContain("Worktree: known failures 0; all 3 test files current");

      // D6.3: a plain `jest <file>` whose results are current is denied once; a pipe and Nx run.
      const started = hook(repo, "session-start", {
        session_id: SESSION,
        cwd: repo.root,
        hook_event_name: "SessionStart",
        source: "startup",
      });
      expect(JSON.stringify(started)).toContain("SQUEAL · registered at revision");
      const bash = (command: string) =>
        hook(repo, "pre-tool-use", {
          session_id: SESSION,
          cwd: join(repo.root, "packages/app"),
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command },
          tool_use_id: "toolu_028",
        });
      const denied = bash("jest test/alone.test.js") as {
        hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
      };
      expect(denied.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(denied.hookSpecificOutput?.permissionDecisionReason).toContain(
        `for the 1 test file it runs (${ALONE_TEST}): 2 checks passed, no known failures`,
      );
      expect(bash("jest test/alone.test.js | tail")).toBeNull();
      expect(bash("pnpm nx run app:test")).toBeNull();
      expect(bash("jest test/alone.test.js")).toBeNull();

      // D7: `squeal stop` ends the daemon and every process below it, warm Jest workers included.
      const pid = daemon.child.pid as number;
      const below = descendants(pid);
      const kinds = (match: string) => below.filter((p) => p.args.includes(match)).length;
      expect(
        kinds(`runner-host ${repo.root} --runner jest`),
        JSON.stringify(below),
      ).toBeGreaterThan(0);
      expect(kinds("/jest/warm-worker.cjs"), JSON.stringify(below)).toBeGreaterThan(0);
      const stop = await cli(repo, ["stop"]);
      expect(stop.code, stop.out).toBe(0);
      expect(await daemon.exited).toMatchObject({ code: 0 });
      await waitFor(
        () => below.every((p) => !isAlive(p.pid)),
        20_000,
        `processes below the daemon gone: ${JSON.stringify(below)}`,
      );
    });
  },
);
