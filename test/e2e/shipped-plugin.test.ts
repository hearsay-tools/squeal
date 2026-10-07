import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import type { StatusResult } from "../../src/core/types/index.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { type BundleRun, runNode } from "../harness/bundle-helpers.js";
import { archivePlugin, type HookName, PLUGINS } from "./plugins.js";

/*
 * Review wave 3, S5: the plugin exactly as a marketplace install copies it.
 * `git archive HEAD plugins/claude-code` into a directory with no
 * `node_modules` above it, a fixture project with its own `npm install` of
 * Vitest, no `SQUEAL_CLI` anywhere. The session-start bundle spawns the
 * shipped CLI as the daemon, which loads the project's Vitest; an edit then
 * reaches PostToolBatch as `PASS -> FAIL`. Committed bundles are what this
 * tests, so run `npm run build` and commit before trusting a local result.
 * Spec 002: the same for `plugins/codex`, on PostToolUse, each hook run as
 * Codex runs it (`plugins.ts`).
 */

const VITEST_VERSION = (
  JSON.parse(readFileSync(join(REPO_ROOT, "node_modules/vitest/package.json"), "utf8")) as {
    version: string;
  }
).version;
const ROOT_VERSION = (
  JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { version: string }
).version;

const MATH = (op: string, mark: number) =>
  `// edit ${mark}\nexport const add = (a: number, b: number) => a ${op} b;\n`;
const MATH_TEST = `import { describe, expect, it } from "vitest";
import { add } from "../src/math.js";

describe("math", () => {
  it("adds", () => {
    expect(add(1, 2)).toBe(3);
  });
  it("adds zero", () => {
    expect(add(2, 0)).toBe(2);
  });
});
`;

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });

function hasNodeModulesAbove(dir: string): boolean {
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, "node_modules"))) return true;
    if (dirname(at) === at) return false;
  }
}

async function until<T>(what: string, ms: number, probe: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe().catch(() => null);
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

describe.each(PLUGINS)("the $name plugin as a marketplace install ships it", (kind) => {
  let base: string;
  let plugin: string;
  let project: string;
  let env: Record<string, string>;

  const cliIn = (cwd: string, args: string[]): Promise<BundleRun> =>
    runNode(
      ["--disable-warning=ExperimentalWarning", join(plugin, "dist/cli/squeal.mjs"), ...args],
      "",
      env,
      cwd,
    );

  const hook = (name: HookName): Promise<BundleRun> => kind.run(plugin, name, project, {}, env);

  async function status(): Promise<StatusResult> {
    const run = await cliIn(project, ["status", "--json"]);
    return JSON.parse(run.stdout) as StatusResult;
  }

  beforeAll(() => {
    // Under /tmp: the OS temp dir can sit inside a checkout that has node_modules.
    base = realpathSync(mkdtempSync("/tmp/squeal-ship-"));
    plugin = join(base, "plugin");
    project = join(base, "project");
    archivePlugin(kind, plugin);

    mkdirSync(join(project, "src"), { recursive: true });
    mkdirSync(join(project, "test"));
    writeFileSync(
      join(project, "package.json"),
      `${JSON.stringify({ name: "fixture", private: true, type: "module" })}\n`,
    );
    writeFileSync(join(project, "src/math.ts"), MATH("+", 0));
    writeFileSync(join(project, "test/math.test.ts"), MATH_TEST);
    writeFileSync(join(project, "vitest.config.ts"), "export default { test: {} };\n");
    writeFileSync(join(project, "squeal.config.json"), "{}\n");
    writeFileSync(join(project, ".gitignore"), "node_modules/\n");
    execFileSync(
      "npm",
      [
        "install",
        "--prefer-offline",
        "--no-audit",
        "--no-fund",
        "--loglevel=error",
        `vitest@${VITEST_VERSION}`,
      ],
      { cwd: project, stdio: "pipe" },
    );
    git(project, ["init", "-q", "-b", "main"]);
    git(project, ["add", "-A"]);
    git(project, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);

    const runtime = mkdtempSync("/tmp/sq-");
    env = { XDG_RUNTIME_DIR: runtime };
  }, 120_000);

  afterAll(async () => {
    if (project !== undefined && existsSync(project)) await cliIn(project, ["stop"]);
    if (base !== undefined) rmSync(base, { recursive: true, force: true });
    if (env?.XDG_RUNTIME_DIR !== undefined)
      rmSync(env.XDG_RUNTIME_DIR, { recursive: true, force: true });
  });

  it("has no node_modules above the plugin copy", () => {
    expect(hasNodeModulesAbove(plugin)).toBe(false);
    expect(existsSync(join(plugin, "hooks/hooks.json"))).toBe(true);
  });

  it("runs bin/squeal --version", (ctx) => {
    if (!kind.bin)
      ctx.skip("Codex ships no bin/: the agent's squeal comes from the npm install (spec 002 D1)");
    const bin = execFileSync(join(plugin, "bin/squeal"), ["--version"], {
      cwd: project,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    });
    expect(bin).toBe(`${ROOT_VERSION}\n`);
  });

  it("runs the bundled CLI's status without loading Vitest", async () => {
    const before = await cliIn(project, ["status"]);
    expect(before.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|\n\s+at /);
    expect(before.stdout).not.toBe("");
  });

  it(`starts the shipped daemon from SessionStart and delivers PASS -> FAIL on ${kind.boundary}`, async () => {
    const start = await hook("session-start");
    expect(start).toMatchObject({ stderr: "", code: 0 });

    const socket = socketPathFor(worktreeIdFor(project), env);
    await until("the daemon socket", 30_000, async () => {
      const ping = await requestDaemon(socket, { type: "ping" }, 500);
      return ping.ok && ping.type === "ping" && ping.phase === "ready" ? ping : null;
    });
    const baseline = await until("a passing baseline", 60_000, async () => {
      const s = await status();
      return s.available && s.counts.current >= 2 && s.counts.pending === 0 ? s : null;
    });
    expect(baseline.available && baseline.knownFailures).toEqual([]);

    const registered = await hook("post-tool-batch");
    expect(registered.code).toBe(0);
    expect(registered.stdout).toContain("registered at revision");

    writeFileSync(join(project, "src/math.ts"), MATH("-", 1));
    await until("the failure", 60_000, async () => {
      const s = await status();
      return s.available && s.knownFailures.some((f) => f.validity === "current") ? s : null;
    });

    const batch = await hook("post-tool-batch");
    expect(batch).toMatchObject({ stderr: "", code: 0 });
    const context = (
      JSON.parse(batch.stdout) as { hookSpecificOutput: { additionalContext: string } }
    ).hookSpecificOutput.additionalContext;
    expect(context).toMatch(/^SQUEAL · 1 check changed at revision \d+\n/);
    expect(context).toContain("FAIL  test/math.test.ts > math > adds");
    expect(context).toContain("PASS -> FAIL");

    const end = await hook("session-end");
    expect(end).toMatchObject({ stdout: "", stderr: "", code: 0 });
  }, 180_000);
});
