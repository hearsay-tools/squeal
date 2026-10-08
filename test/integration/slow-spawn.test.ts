import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { readStatus } from "../../src/core/status/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { childEnv, ping } from "../daemon/helpers.js";
import { readRuns, until } from "../e2e/support.js";

/*
 * Spec 004 D5 and goal 3 for a slow node:test project shaped like cezarion's
 * `test:package`: its test spawns the package's CLI in a process of its own,
 * and the CLI loads a helper the test file never imports. 001-132 observes
 * what spawned processes load under Vitest; 004-13 asked whether a node:test
 * file's key holds what its spawned CLI loaded.
 *
 * It does not, and this test pins the gap until a runner row closes it (the
 * 004-13 report). The node:test runner loads its module recorder through argv
 * `--require` (`runNodeTest`), which a spawned `node` does not inherit; it
 * goes into `NODE_OPTIONS` only when the project's own `NODE_OPTIONS` holds a
 * `--require`. 001-132's recorder, which follows spawns, is stripped from a
 * node:test project's environment (`projectEnv`, 003-35). Even with the
 * recorder in the child, `observedClosure` treats the CLI's entry (no parent)
 * as a preload root, so the helper would key the project's environment, not
 * the file. When the edit re-runs the file, flip the last three expectations.
 */

const REPO = resolve(import.meta.dirname, "../..");
const CLI = join(REPO, "src/cli/index.ts");
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const FIXTURE = join(REPO, "test/fixtures/node-test/spawn-cli");
const TEST_FILE = "test/cli.test.mjs";
const HELPER = "lib/helper.mjs";
const SLOW = { timeout: 300_000 } as const;
const SETTLE_MS = 120_000;

const scratch = realpathSync(mkdtempSync("/tmp/sq-spawn-"));
const daemons: ChildProcess[] = [];
afterAll(async () => {
  for (const daemon of daemons) daemon.kill("SIGTERM");
  await Promise.all(
    daemons.map((d) => (d.exitCode === null ? new Promise((done) => d.once("exit", done)) : null)),
  );
  rmSync(scratch, { recursive: true, force: true });
});

const git = (cwd: string, args: readonly string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });

function createRepo(): string {
  const root = join(scratch, "repo");
  cpSync(FIXTURE, root, { recursive: true });
  const project = {
    name: "spawn-cli",
    node: process.execPath,
    include: ["test/*.test.mjs"],
    slow: true,
  };
  writeFileSync(join(root, "squeal.config.json"), `${JSON.stringify({ nodeTest: [project] })}\n`);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
  return realpathSync(root);
}

/** `squeal daemon <root>` from the sources, as the hooks would spawn it from a plugin. */
async function startDaemon(root: string): Promise<void> {
  const env = childEnv(join(scratch, "run"));
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

/** Status once nothing is pending past revision `after`, the runner part included (001 D2). */
const settle = (root: string, what: string, after = -1) =>
  until(what, SETTLE_MS, async () => {
    const s = status(root);
    const pending =
      s.counts.pending + s.testFilesWithoutChecks.pending + s.testFilesWithoutChecks.unknown;
    if (s.revision > after && s.runnerPartPending !== true && pending === 0) return s;
    const { revision, counts, testFilesWithoutChecks, knownFailures, daemonNotes } = s;
    throw new Error(
      JSON.stringify({ revision, counts, testFilesWithoutChecks, knownFailures, daemonNotes }),
    );
  });

const ranFiles = (root: string) =>
  readRuns(join(root, ".git/squeal/store.sqlite"), worktreeIdFor(root)).flatMap((r) => r.testFiles);

describe("a slow node:test file whose test spawns the package's CLI", () => {
  it(
    "keeps a stale pass when only the spawned CLI loaded the edited helper (the gap)",
    SLOW,
    async () => {
      const root = createRepo();
      await startDaemon(root);
      const baseline = await settle(root, "the baseline");
      expect(baseline.knownFailures).toEqual([]);
      expect(ranFiles(root)).toEqual([TEST_FILE]);

      // The CLI now prints "hi": the file would fail if it ran again. It does not run, and its
      // pass stays current at the new revision.
      const at = baseline.revision;
      writeFileSync(join(root, HELPER), `export const greeting = "hi";\n`);
      const edited = await settle(root, "the edit of the helper", at);
      expect(edited.revision).toBeGreaterThan(at);
      expect(ranFiles(root)).toEqual([TEST_FILE]);
      expect(edited.knownFailures).toEqual([]);
      expect(
        execFileSync(process.execPath, [join(root, "bin/cli.mjs")], { encoding: "utf8" }),
      ).toBe("hi\n");
    },
  );
});
