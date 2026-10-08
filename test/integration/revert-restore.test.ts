import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { readStatus } from "../../src/core/status/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { childEnv, ping } from "../daemon/helpers.js";
import { until } from "../e2e/support.js";

/*
 * Task 001-146, under a real daemon run from the sources: a test file
 * reverts `src/mod.ts`, imports it by a specifier Vite cannot see, and
 * restores it within milliseconds, the way a rebase reverted and restored
 * `src/cli/run.ts` within one second (evidence-001-146). The watcher folds
 * the two writes into one batch with no change, so no revision names the
 * file. A test file added next imports the module: its stored result must be
 * what a fresh `vitest run` gives, and the reverting run's own result is not
 * stored as current.
 */

const REPO = resolve(import.meta.dirname, "../..");
const CLI = join(REPO, "src/cli/index.ts");
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const VITEST = join(REPO, "node_modules/vitest/vitest.mjs");
/** Inside the repository, so the fixture resolves `vitest` from its `node_modules`. Git-ignored. */
const scratch = join(REPO, "test/fixtures/vitest/.tmp", `revert-${randomUUID()}`);
const runtime = realpathSync(mkdtempSync("/tmp/sq-"));
/** Outside the worktree, so the watcher never sees them. */
const markers = realpathSync(mkdtempSync("/tmp/sq-markers-"));
const ARM = join(markers, "arm");
const LOADED = join(markers, "loaded");
const SLOW = { timeout: 600_000 } as const;
const SETTLE_MS = 180_000;
/** An attempt the watcher split into two revisions proves nothing; try again. */
const ATTEMPTS = 8;

const daemons: ChildProcess[] = [];
afterAll(async () => {
  for (const daemon of daemons) daemon.kill("SIGTERM");
  await Promise.all(
    daemons.map((d) => (d.exitCode === null ? new Promise((done) => d.once("exit", done)) : null)),
  );
  for (const dir of [scratch, runtime, markers]) rmSync(dir, { recursive: true, force: true });
});

const NEW = 'export const which = "new";\n';
const OLD = 'export const which = "old";\n';

/** Armed by `ARM`: reverts the module, loads it, restores it, and writes what it loaded to `LOADED`. */
const reverting = (attempt: number) =>
  [
    'import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";',
    'import { expect, it } from "vitest";',
    `// attempt ${attempt}`,
    'it("reverts the module while it loads it", async () => {',
    `  if (!existsSync(${JSON.stringify(ARM)})) return;`,
    `  rmSync(${JSON.stringify(ARM)});`,
    '  const file = new URL("../src/mod.ts", import.meta.url);',
    '  const restored = readFileSync(file, "utf8");',
    `  writeFileSync(file, ${JSON.stringify(OLD)});`,
    '  const target = "../src/mod" + ".ts";',
    "  const { which } = await import(/* @vite-ignore */ target);",
    "  writeFileSync(file, restored);",
    `  writeFileSync(${JSON.stringify(LOADED)}, which);`,
    '  expect(typeof which).toBe("string");',
    "});",
    "",
  ].join("\n");

const READS = [
  'import { expect, it } from "vitest";',
  'import { which } from "../src/mod.ts";',
  'it("reads the restored module", () => expect(which).toBe("new"));',
  "",
].join("\n");

const FILES: Readonly<Record<string, string>> = {
  ".gitignore": "node_modules/\n",
  "package.json": `${JSON.stringify({ name: "revert", private: true, type: "module" })}\n`,
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n`,
  "src/mod.ts": NEW,
  "test/reverting.test.ts": reverting(0),
};

const git = (cwd: string, args: readonly string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });

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

/** Status once a revision after `after` is refined and nothing is queued or running. */
const settle = (root: string, after: number) =>
  until("the daemon to settle", SETTLE_MS, async () => {
    const s = status(root);
    const quiet =
      s.revision > after &&
      s.runnerPartPending !== true &&
      s.counts.pending + s.testFilesWithoutChecks.pending === 0;
    return quiet ? s : null;
  });

function query<T>(root: string, sql: string, ...params: (string | number)[]): T[] {
  const db = new DatabaseSync(join(root, ".git/squeal/store.sqlite"), { readOnly: true });
  try {
    return db.prepare(sql).all(worktreeIdFor(root), ...params) as T[];
  } finally {
    db.close();
  }
}

/** Validity and outcome of each check of one test file, as the store holds them. */
const stateOf = (root: string, testPath: string) =>
  query<{ validity: string; outcome: string }>(
    root,
    "SELECT k.validity, k.outcome FROM known_states k JOIN checks c ON c.id = k.check_id WHERE k.worktree_id = ? AND c.test_path = ? ORDER BY c.kind, c.full_name",
    testPath,
  ).map((r) => `${r.validity} ${r.outcome}`);

/** Whether a revision after `after` named `path`: then the watcher saw the reverted bytes. */
const revised = (root: string, path: string, after: number) =>
  query<{ changes: string }>(
    root,
    "SELECT changes FROM revisions WHERE worktree_id = ? AND number > ?",
    after,
  ).some((r) => (JSON.parse(r.changes) as { path: string }[]).some((c) => c.path === path));

/** Exit code of a fresh `vitest run` of `testPath` in `root`. */
const freshRun = (root: string, testPath: string) =>
  spawnSync(process.execPath, [VITEST, "run", testPath], { cwd: root, stdio: "ignore" }).status;

describe("a sub-second revert-and-restore of an imported module (001-146)", () => {
  it("stores what a fresh run of the restored bytes gives", SLOW, async () => {
    const root = createRepo();
    await startDaemon(root);
    await settle(root, -1);

    // Plant a transform of the reverted bytes, until the watcher folds the revert and the restore.
    let planted = false;
    for (let attempt = 1; attempt <= ATTEMPTS && !planted; attempt++) {
      rmSync(LOADED, { force: true });
      writeFileSync(ARM, "");
      const at = status(root).revision;
      writeFileSync(join(root, "test/reverting.test.ts"), reverting(attempt));
      await settle(root, at);
      const loaded = existsSync(LOADED) ? readFileSync(LOADED, "utf8") : null;
      planted = loaded === "old" && !revised(root, "src/mod.ts", at);
    }
    expect(planted, "a run loaded the reverted bytes and no revision named them").toBe(true);
    expect(readFileSync(join(root, "src/mod.ts"), "utf8")).toBe(NEW);
    // The reverting run executed bytes no key names: not stored as current.
    expect(stateOf(root, "test/reverting.test.ts")).not.toContain("current pass");

    const at = status(root).revision;
    writeFileSync(join(root, "test/reads.test.ts"), READS);
    const s = await settle(root, at);
    expect(freshRun(root, "test/reads.test.ts")).toBe(0);
    expect(s.knownFailures).toEqual([]);
    expect(stateOf(root, "test/reads.test.ts")).toEqual(["current pass", "current pass"]);
  });
});
