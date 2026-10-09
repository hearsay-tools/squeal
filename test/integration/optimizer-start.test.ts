import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
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
import { childEnv, ping } from "../daemon/helpers.js";
import { until } from "../e2e/support.js";
import { freshOutcomes, NEW, OLD } from "./stamps-repo.js";
import { OPTIMIZED } from "./touched-repo.js";

/*
 * Review wave-13f B4 (task 001-176), under a real daemon run from the
 * sources: the daemon opens its Vitest instance while `src/mod.js` holds
 * NEW, and Vite's optimizer bundles it through the alias at that start. OLD
 * is written back before the scheduler's first key scan, so neither the scan
 * nor a later batch sees a change. A `git` on the daemon's PATH holds the
 * scan's first `git rev-parse --show-object-format` until the bundle holds
 * NEW, restores OLD, and runs the real git. The stored result must be what a
 * fresh adapter gives on OLD.
 */

const REPO = resolve(import.meta.dirname, "../..");
const CLI = join(REPO, "src/cli/index.ts");
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
/** Inside the repository, so the fixture resolves `vitest` from its `node_modules`. Git-ignored. */
const scratch = join(REPO, "test/fixtures/vitest/.tmp", `optimizer-start-${randomUUID()}`);
const runtime = realpathSync(mkdtempSync("/tmp/sq-"));
/** Outside the worktree, so the watcher never sees them. */
const shims = realpathSync(mkdtempSync("/tmp/sq-git-"));
const SLOW = { timeout: 600_000 } as const;
const SETTLE_MS = 300_000;

const daemons: ChildProcess[] = [];
afterAll(async () => {
  for (const daemon of daemons) daemon.kill("SIGTERM");
  await Promise.all(
    daemons.map((d) => (d.exitCode === null ? new Promise((done) => d.once("exit", done)) : null)),
  );
  for (const dir of [scratch, runtime, shims]) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, args: readonly string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });

function createRepo(observe: boolean): string {
  const main = join(scratch, randomUUID());
  const files = {
    ...OPTIMIZED,
    "squeal.config.json": `${JSON.stringify({ observe: { runtimeInputs: observe } })}\n`,
  };
  for (const [path, text] of Object.entries(files)) {
    if (text === "") continue;
    mkdirSync(dirname(join(main, path)), { recursive: true });
    writeFileSync(join(main, path), text);
  }
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["add", "-A"]);
  git(main, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
  return realpathSync(main);
}

/**
 * A directory holding a `git` that, once, at the first object-format query,
 * waits for an optimizer bundle under `root` holding NEW, writes OLD to
 * `src/mod.js` and marks `planted`; every call then runs the real git.
 */
function gitShim(root: string, planted: string): string {
  const dir = join(shims, randomUUID());
  mkdirSync(dir);
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const once = join(dir, "once");
  const script = [
    "#!/bin/sh",
    `if [ "$1 $2" = "rev-parse --show-object-format" ] && [ ! -e '${once}' ]; then`,
    `  : > '${once}'`,
    "  i=0",
    `  while ! grep -rqs '"new"' '${join(root, "node_modules/.vite")}'; do`,
    "    i=$((i+1)); [ $i -gt 1200 ] && break; sleep 0.1",
    "  done",
    `  if [ $i -le 1200 ]; then printf '%s' '${OLD.trimEnd()}' > '${join(root, "src/mod.js")}'; echo >> '${join(root, "src/mod.js")}'; : > '${planted}'; fi`,
    "fi",
    `exec '${real}' "$@"`,
    "",
  ].join("\n");
  writeFileSync(join(dir, "git"), script);
  chmodSync(join(dir, "git"), 0o755);
  return dir;
}

async function startDaemon(root: string, shim: string): Promise<void> {
  const env = { ...childEnv(runtime), PATH: `${shim}:${process.env.PATH ?? ""}` };
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

/** Once a checkpoint completed and nothing is queued or running. */
const settle = (root: string) =>
  until("the daemon to settle", SETTLE_MS, async () => {
    const s = readStatus(root);
    if (!s.available) return null;
    const quiet =
      s.fullSuite.lastCompletedRevision !== null &&
      s.runnerPartPending !== true &&
      s.counts.pending + s.testFilesWithoutChecks.pending === 0;
    return quiet ? s : null;
  });

/** Validity and outcome of each test check of one test file, as the store holds them. */
function stateOf(root: string, testPath: string): string[] {
  const db = new DatabaseSync(join(root, ".git/squeal/store.sqlite"), { readOnly: true });
  try {
    const rows = db
      .prepare(
        "SELECT k.validity, k.outcome FROM known_states k JOIN checks c ON c.id = k.check_id WHERE k.worktree_id = ? AND c.test_path = ? AND c.kind = 'test' ORDER BY c.full_name",
      )
      .all(worktreeIdFor(root), testPath) as { validity: string; outcome: string }[];
    return rows.map((r) => `${r.validity} ${r.outcome}`);
  } finally {
    db.close();
  }
}

describe("an optimizer bundle built before the daemon's first key scan (review wave-13f B4)", () => {
  it.each([true, false])(
    "stores what a fresh adapter gives on the restored bytes (observe %s)",
    SLOW,
    async (observe) => {
      const root = createRepo(observe);
      const planted = join(shims, `planted-${randomUUID()}`);
      writeFileSync(join(root, "src/mod.js"), NEW);
      await startDaemon(root, gitShim(root, planted));
      await settle(root);

      expect(existsSync(planted), "the bundle held NEW before the scan").toBe(true);
      expect(readFileSync(join(root, "src/mod.js"), "utf8")).toBe(OLD);
      expect(stateOf(root, "test/optimized.test.ts")).toEqual(["current fail"]);
      expect(await freshOutcomes(root, [{ project: "", path: "test/optimized.test.ts" }])).toEqual([
        ["", "test/optimized.test.ts", "fail"],
      ]);
    },
  );
});
