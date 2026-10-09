import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { SyncState } from "../../src/cli/status-sync.js";
import { STATUS_WAIT_SETTLE_MS, waitForStatus } from "../../src/cli/status-wait.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { readStatus } from "../../src/core/status/index.js";
import type { AbsolutePath, StatusSnapshot } from "../../src/core/types/index.js";
import { childEnv, LOADED, ping } from "../daemon/helpers.js";
import { until } from "../e2e/support.js";

/*
 * Lessons, defect 30, under a real daemon run from the sources: on cezar at
 * load 95 to 120, 15 of 18 waits started right after an edit returned
 * "nothing pending at revision N-1", since the edit's revision committed up
 * to 3.1 s after the edit. Here a second connection holds the store's write
 * lock 3 s from just before the edit, so the daemon cannot store the edit's
 * revision until then, and a wait started right after the edit must not end
 * quiet at the revision before it.
 */

const REPO = resolve(import.meta.dirname, "../..");
const CLI = join(REPO, "src/cli/index.ts");
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
/** Inside the repository, so the fixture resolves `vitest` from its `node_modules`. Git-ignored. */
const scratch = join(REPO, "test/fixtures/vitest/.tmp", `wait-sync-${randomUUID()}`);
const runtime = realpathSync(mkdtempSync("/tmp/sq-"));
const SLOW = { timeout: 600_000 } as const;
const SETTLE_MS = 180_000;
const HOLD_MS = 3_000;

const daemons: ChildProcess[] = [];
afterAll(async () => {
  for (const daemon of daemons) daemon.kill("SIGTERM");
  await Promise.all(
    daemons.map((d) => (d.exitCode === null ? new Promise((done) => d.once("exit", done)) : null)),
  );
  for (const dir of [scratch, runtime]) rmSync(dir, { recursive: true, force: true });
});

const FILES: Readonly<Record<string, string>> = {
  ".gitignore": "node_modules/\n",
  "package.json": `${JSON.stringify({ name: "wait-sync", private: true, type: "module" })}\n`,
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n`,
  "src/mod.ts": "export const one = 1;\n",
  "test/mod.test.ts": `import { expect, it } from "vitest";\nimport { one } from "../src/mod.ts";\nit("is one", () => expect(one).toBe(1));\n`,
};

function createRepo(name: string): AbsolutePath {
  const main = join(scratch, name);
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(main, path)), { recursive: true });
    writeFileSync(join(main, path), text);
  }
  const git = (args: readonly string[]) => execFileSync("git", args, { cwd: main, stdio: "pipe" });
  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
  return realpathSync(main) as AbsolutePath;
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

/** Status once the baseline is in and nothing is queued or running. */
const settled = (root: string) =>
  until("the daemon to settle", SETTLE_MS, async () => {
    const s = status(root);
    const quiet =
      s.runnerPartPending !== true &&
      s.counts.current > 0 &&
      s.counts.pending + s.testFilesWithoutChecks.pending === 0;
    return quiet ? s : null;
  });

/** Takes the store's write lock from a connection of its own, and gives it back after `ms`. */
function holdWriteLock(root: string, ms: number): Promise<void> {
  const db = new DatabaseSync(join(root, ".git/squeal/store.sqlite"));
  db.exec("PRAGMA busy_timeout = 30000");
  db.exec("BEGIN IMMEDIATE");
  return new Promise((done) =>
    setTimeout(() => {
      db.exec("COMMIT");
      db.close();
      done();
    }, ms),
  );
}

/** A daemon from before the `sync` request, as the wait sees it. */
const cannotSync = () => ({
  current: (): SyncState => ({ state: "unsupported" }),
  stop: () => {},
});

describe("status --wait right after an edit whose revision commits late (defect 30)", () => {
  it("never ends quiet at the revision before the edit", SLOW, async () => {
    const root = createRepo("synced");
    await startDaemon(root);
    const before = (await settled(root)).revision;

    const released = holdWriteLock(root, HOLD_MS);
    appendFileSync(join(root, "src/mod.ts"), "// touched\n");
    const wait = await waitForStatus(root, { timeoutMs: 120_000 });
    await released;

    expect(wait.outcome).toBe("quiet");
    expect(wait.result).toMatchObject({ revision: before + 1 });
    expect(wait.waitedMs).toBeGreaterThanOrEqual(HOLD_MS - 100);
  });

  it("returns promptly when nothing was edited", SLOW, async () => {
    const root = createRepo("idle");
    await startDaemon(root);
    const before = (await settled(root)).revision;

    const wait = await waitForStatus(root, { timeoutMs: 120_000 });

    expect(wait.outcome).toBe("quiet");
    expect(wait.result).toMatchObject({ revision: before });
    if (!LOADED) expect(wait.waitedMs).toBeLessThan(2 * STATUS_WAIT_SETTLE_MS);
  });

  it(
    "without a sync, the held revision reads as quiet at the earlier one (the defect)",
    SLOW,
    async () => {
      const root = createRepo("unsynced");
      await startDaemon(root);
      const before = (await settled(root)).revision;

      const released = holdWriteLock(root, HOLD_MS);
      appendFileSync(join(root, "src/mod.ts"), "// touched\n");
      const wait = await waitForStatus(root, { timeoutMs: 120_000, sync: cannotSync });
      await released;

      expect(wait.outcome).toBe("quiet");
      expect(wait.result).toMatchObject({ revision: before });
    },
  );
});
