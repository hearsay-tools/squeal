import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { readStatus } from "../../src/core/status/index.js";
import type { AbsolutePath, StatusSnapshot } from "../../src/core/types/index.js";
import { childEnv, ping } from "../daemon/helpers.js";
import { until } from "../e2e/support.js";

/*
 * Real daemons run from the sources over small Vitest repositories, for the
 * `status --wait` tests (tasks 001-185, 001-186). Each test file that calls
 * `waitDaemons` gets its own scratch and runtime directories, removed with
 * its daemons after the file.
 */

const REPO = resolve(import.meta.dirname, "../..");
const CLI = join(REPO, "src/cli/index.ts");
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
export const SETTLE_MS = 180_000;

export const FILES: Readonly<Record<string, string>> = {
  ".gitignore": "node_modules/\n",
  "package.json": `${JSON.stringify({ name: "wait-sync", private: true, type: "module" })}\n`,
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n`,
  "src/mod.ts": "export const one = 1;\n",
  "test/mod.test.ts": `import { expect, it } from "vitest";\nimport { one } from "../src/mod.ts";\nit("is one", () => expect(one).toBe(1));\n`,
};

export interface WaitDaemons {
  /** A committed git repository holding `files`, inside this repository so it resolves `vitest`. */
  createRepo(name: string, files?: Readonly<Record<string, string>>): AbsolutePath;
  /** Starts a daemon for `root` and resolves with its socket once it answers `ready`. */
  startDaemon(root: string): Promise<AbsolutePath>;
}

export function waitDaemons(prefix: string): WaitDaemons {
  /** Git-ignored. */
  const scratch = join(REPO, "test/fixtures/vitest/.tmp", `${prefix}-${randomUUID()}`);
  const runtime = realpathSync(mkdtempSync("/tmp/sq-"));
  const daemons: ChildProcess[] = [];
  afterAll(async () => {
    for (const daemon of daemons) daemon.kill("SIGTERM");
    await Promise.all(
      daemons.map((d) =>
        d.exitCode === null ? new Promise((done) => d.once("exit", done)) : null,
      ),
    );
    for (const dir of [scratch, runtime]) rmSync(dir, { recursive: true, force: true });
    // A daemon that stops lets its tier in flight end first, a slow file's included.
  }, SETTLE_MS);

  return {
    createRepo(name, files = FILES) {
      const main = join(scratch, name);
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(main, path)), { recursive: true });
        writeFileSync(join(main, path), text);
      }
      const git = (args: readonly string[]) =>
        execFileSync("git", args, { cwd: main, stdio: "pipe" });
      git(["init", "-q", "-b", "main"]);
      git(["add", "-A"]);
      git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
      return realpathSync(main) as AbsolutePath;
    },
    async startDaemon(root) {
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
      return socket;
    },
  };
}

export const status = (root: string): StatusSnapshot => {
  const result = readStatus(root);
  if (!result.available) throw new Error(`status unavailable: ${result.message}`);
  return result;
};

/** Status once `ready` holds for it. */
export const statusWhen = (root: string, what: string, ready: (s: StatusSnapshot) => boolean) =>
  until(what, SETTLE_MS, async () => {
    const s = status(root);
    return ready(s) ? s : null;
  });

/** Status once the baseline is in and nothing is queued or running. */
export const settled = (root: string) =>
  statusWhen(
    root,
    "the daemon to settle",
    (s) =>
      s.runnerPartPending !== true &&
      s.counts.current > 0 &&
      s.counts.pending + s.testFilesWithoutChecks.pending === 0,
  );
