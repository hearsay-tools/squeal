import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { readStatus } from "../../src/core/status/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { childEnv, ping } from "../daemon/helpers.js";
import { readRuns, until } from "../e2e/support.js";
import { recorded } from "../harness/helpers.js";

/*
 * Spec 003 goal 8 and Testing, integration: one daemon per worktree, run
 * from the sources, validates a Vitest suite and two node:test projects of
 * one repository. A baseline is inherited by a second worktree with zero
 * runs; an edit runs only the node:test files whose closure holds it and its
 * `PASS -> FAIL` reaches the agent through the Claude Code hooks; a path the
 * static graph cannot see (a computed `import()`) is observed by the first
 * run and keeps a worktree whose copy differs from inheriting a pass.
 */

const REPO = resolve(import.meta.dirname, "../..");
const CLI = join(REPO, "src/cli/index.ts");
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
/**
 * Inside the repository, so the fixture resolves `vitest` and `tsx` from its
 * `node_modules`. The fixture declares no dependencies, so its daemon does not
 * wait for an install (task 001-100); its `vitest.config.ts` makes Vitest detected.
 */
const scratch = join(REPO, "test/fixtures/node-test/.tmp", randomUUID());
const runtime = realpathSync(mkdtempSync("/tmp/sq-"));
const SLOW = { timeout: 300_000 } as const;
const SETTLE_MS = 120_000;

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

const nodeTest = (name: string) => ({
  name,
  cwd: `packages/${name}`,
  node: process.execPath,
  argv: ["--import", "tsx"],
  include: ["test/*.test.ts"],
});

const nodeTestFile = (imports: string, body: string) =>
  `import assert from "node:assert/strict";\nimport { test } from "node:test";\n${imports}\n${body}\n`;

const FILES: Readonly<Record<string, string>> = {
  ".gitignore": "node_modules/\n",
  "package.json": `${JSON.stringify({ name: "mixed", private: true, type: "module" })}\n`,
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["vitest/**/*.test.ts"] } });\n`,
  "squeal.config.json": `${JSON.stringify({ nodeTest: [nodeTest("a"), nodeTest("b")] }, null, 2)}\n`,
  "src/sum.ts": "export const sum = (a: number, b: number) => a + b;\n",
  "vitest/sum.test.ts": `import { expect, test } from "vitest";\nimport { sum } from "../src/sum.js";\ntest("sums", () => expect(sum(1, 2)).toBe(3));\n`,
  "packages/a/src/one.ts": "export const one = () => 1;\n",
  "packages/a/src/two.ts": "export const two = () => 2;\n",
  "packages/a/src/hidden.ts": "export const hidden = 1;\n",
  "packages/a/test/one.test.ts": nodeTestFile(
    `import { one } from "../src/one.js";`,
    `test("one is 1", () => assert.equal(one(), 1));`,
  ),
  "packages/a/test/two.test.ts": nodeTestFile(
    `import { two } from "../src/two.js";`,
    `test("two is 2", () => assert.equal(two(), 2));`,
  ),
  "packages/a/test/hidden.test.ts": nodeTestFile(
    `const target = "../src/hidden.ts";`,
    `test("hidden is 1", async () => assert.equal((await import(target)).hidden, 1));`,
  ),
  "packages/b/src/b.ts": "export const b = () => 'b';\n",
  "packages/b/test/b.test.ts": nodeTestFile(
    `import { b } from "../src/b.js";`,
    `test("b is b", () => assert.equal(b(), "b"));`,
  ),
};
const TEST_FILES = Object.keys(FILES).filter((p) => p.endsWith(".test.ts"));
/** One test per file, plus each file's file-level check (001 D4). */
const CHECKS = 2 * TEST_FILES.length;

function createRepo(): string {
  const main = join(scratch, "main");
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(main, path)), { recursive: true });
    writeFileSync(join(main, path), text);
  }
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["add", "-A"]);
  git(main, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
  return realpathSync(main);
}

function addWorktree(main: string, name: string): string {
  const root = join(scratch, name);
  git(main, ["worktree", "add", "-q", "-b", name, root]);
  return realpathSync(root);
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
      s.counts.pending + s.testFilesWithoutChecks.pending + s.testFilesWithoutChecks.unknown === 0;
    if (quiet && accept(s)) return s;
    // The last of these is the timeout's message.
    const { revision, counts, testFilesWithoutChecks, knownFailures, daemonNotes } = s;
    throw new Error(
      JSON.stringify({ revision, counts, testFilesWithoutChecks, knownFailures, daemonNotes }),
    );
  });

const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };
const hookText = async (name: "session-start" | "post-tool-batch", root: string) => {
  const out = await runHook(name, recorded(name, root), deps);
  if (out.stdout === "") return "";
  return (JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } })
    .hookSpecificOutput.additionalContext;
};

const runs = (main: string, root: string) =>
  readRuns(join(main, ".git/squeal/store.sqlite"), worktreeIdFor(root));
const ranFiles = (main: string, root: string) => runs(main, root).flatMap((r) => r.testFiles);

/** The test files of the runs of `root` after its first `from` runs. */
const ranSince = (main: string, root: string, from: number) =>
  runs(main, root)
    .slice(from)
    .flatMap((r) => r.testFiles);

describe("a repository with a Vitest suite and two node:test projects", () => {
  it(
    "baselines, delivers a node:test PASS -> FAIL, keys observed paths and inherits",
    SLOW,
    async () => {
      const main = createRepo();
      await startDaemon(main);
      expect(await hookText("session-start", main)).toMatch(/^SQUEAL · registered at revision \d+/);
      const baseline = await settle(main, "the main baseline", (s) => s.counts.current === CHECKS);
      expect(baseline.knownFailures).toEqual([]);
      expect(new Set(ranFiles(main, main))).toEqual(new Set(TEST_FILES));

      // The baseline observed the computed import: a worktree whose copy of it differs
      // keys hidden.test.ts with it, misses, runs it and fails, where a key from the
      // static closure alone would have inherited main's pass.
      const wt3 = addWorktree(main, "wt3");
      writeFileSync(join(wt3, "packages/a/src/hidden.ts"), "export const hidden = 2;\n");
      await startDaemon(wt3);
      const third = await settle(wt3, "the third baseline", (s) => s.counts.current === CHECKS);
      expect(ranFiles(main, wt3)).toEqual(["packages/a/test/hidden.test.ts"]);
      expect(third.knownFailures.map((f) => f.check)).toEqual([
        expect.objectContaining({ project: "a", testPath: "packages/a/test/hidden.test.ts" }),
      ]);

      // An edit of the observed-only path re-runs its test file, and only it, here.
      let from = runs(main, main).length;
      let at = status(main).revision;
      writeFileSync(
        join(main, "packages/a/src/hidden.ts"),
        "// edited\nexport const hidden = 1;\n",
      );
      await settle(main, "the edit of hidden.ts", () => true, at);
      expect(ranSince(main, main, from)).toEqual(["packages/a/test/hidden.test.ts"]);
      git(main, ["add", "packages/a/src/hidden.ts"]);
      git(main, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "hidden"]);

      // An edit runs only the node:test file whose closure holds it, and the hooks deliver it.
      from = runs(main, main).length;
      at = status(main).revision;
      writeFileSync(join(main, "packages/a/src/one.ts"), "export const one = () => 0;\n");
      await settle(main, "the edit of one.ts", (s) => s.knownFailures.length === 1, at);
      expect(ranSince(main, main, from)).toEqual(["packages/a/test/one.test.ts"]);
      const delivered = await hookText("post-tool-batch", main);
      expect(delivered).toContain("PASS -> FAIL");
      expect(delivered).toContain("one is 1");

      // A worktree of the commit inherits every result, node:test and Vitest alike,
      // hidden.test.ts included, since main ran it under the observed path: zero runs.
      const wt2 = addWorktree(main, "wt2");
      await startDaemon(wt2);
      const second = await settle(wt2, "the second baseline", (s) => s.counts.current === CHECKS);
      expect(second.inherited.count).toBe(CHECKS);
      expect(second.knownFailures).toEqual([]);
      expect(runs(main, wt2)).toEqual([]);
    },
  );
});
