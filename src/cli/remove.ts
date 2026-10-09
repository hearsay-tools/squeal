import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { locateDaemon } from "../core/daemon/ensure.js";
import { acquireDaemonLock, type DaemonLock } from "../core/daemon/lock.js";
import { checkPrivateDir, currentUid, socketPathFor, userTmpDir } from "../core/daemon/paths.js";
import { daemonScratch } from "../core/daemon/scratch.js";
import { isRecord, resolveCommonDir, runGit, splitNul } from "../core/fs/index.js";
import { isStoreOpenFailure, openStore } from "../core/store/open.js";
import { storePaths } from "../core/store/paths.js";
import type { AbsolutePath, WorktreeRecord } from "../core/types/index.js";
import { askDaemon, CLI_SOCKET_TIMEOUT_MS, worktreeRoot } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import {
  MARKETPLACE_NAME,
  PLUGIN_ID,
  PREVIOUS_MARKETPLACE_NAME,
  PREVIOUS_PLUGIN_ID,
} from "./plugin-id.js";

/** A daemon asked to stop finishes the tier in flight (D10); `remove` waits this long for it. */
const STOP_WAIT_MS = 5_000;

export interface RemoveOptions {
  readonly stopWaitMs?: number;
}

/** Some path could not be deleted; the output lists it under "Still there" (D7). */
const PARTIAL_EXIT = 3;

/**
 * `squeal remove [--config]`: stops the daemon of every worktree of the
 * repository, then deletes the daemons' temp directories and
 * `<common-dir>/squeal/` (D1, D10), holding every daemon lock while it
 * deletes. A daemon that does not stop deletes nothing (exit 1). The temp
 * directories go first, since finding them needs the repository id in the
 * store; one that cannot be deleted is listed with its error code and the
 * exit code is 3 (review wave 10c, S2). `--config` also deletes this
 * worktree's `squeal.config.json` (D11), and the output names every other
 * worktree that keeps one (S3).
 */
export async function removeCommand(
  args: readonly string[],
  io: CliIo,
  options: RemoveOptions = {},
): Promise<number> {
  const config = args.includes("--config");
  if (args.some((arg) => arg !== "--config")) {
    io.stderr("usage: squeal remove [--config]\n");
    return 2;
  }
  const root = worktreeRoot(undefined, io);
  if (root === null) return 1;
  const commonDir = resolveCommonDir(root);
  if (commonDir === null) {
    io.stderr(`squeal: cannot resolve the git common directory of ${root}\n`);
    return 1;
  }
  const storeDir = storePaths(commonDir).dir;
  const configPath = join(root, "squeal.config.json");
  const removed: string[] = [];
  const failed: string[] = [];
  const remove = (path: AbsolutePath, line: string): void => {
    try {
      rmSync(path, { recursive: true, force: true });
      removed.push(line);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? String(error);
      failed.push(`${path}: could not delete it (${code}); delete it by hand`);
    }
  };

  if (existsSync(storeDir)) {
    const worktrees = recordedWorktrees(commonDir);
    const stopped: AbsolutePath[] = [];
    for (const worktree of worktrees) if (await askToStop(worktree)) stopped.push(worktree.root);
    const locks = await holdDaemonLocks(commonDir, options.stopWaitMs ?? STOP_WAIT_MS);
    if ("held" in locks) {
      const holder = worktrees.find((w) => w.id === locks.held)?.root ?? locks.lockPath;
      io.stderr(
        `squeal: the daemon for ${holder} did not stop; nothing was removed. ` +
          `It may be finishing a test run: try again, or stop it with squeal stop.\n`,
      );
      return 1;
    }
    try {
      for (const dir of tempDirs(commonDir, worktrees)) {
        remove(dir, `${dir} (a daemon's temp directory)`);
      }
      remove(storeDir, `${storeDir} (store, locks, run logs, repository id)`);
      if (stopped.length > 0) {
        io.stdout(`Stopped the daemons of:\n${stopped.map((r) => `  ${r}\n`).join("")}`);
      }
    } finally {
      for (const lock of locks) lock.release();
    }
  }
  if (config && existsSync(configPath)) {
    const tracked = await isTracked(root, "squeal.config.json");
    remove(
      configPath,
      tracked ? `${configPath} (tracked by git: the deletion is a change to commit)` : configPath,
    );
  }

  io.stdout(
    removed.length === 0 && failed.length === 0
      ? `Nothing to remove: no Squeal store for this repository.\n`
      : removed.length === 0
        ? ""
        : `Removed:\n${removed.map((line) => `  ${line}\n`).join("")}`,
  );
  io.stdout("Still there:\n");
  for (const line of failed) io.stdout(`  ${line}\n`);
  if (existsSync(configPath)) {
    io.stdout(
      `  ${configPath}: the next Claude Code session here starts Squeal again. ` +
        `It is committed; delete it, or run squeal remove --config.\n`,
    );
  }
  for (const other of await otherConfigs(root)) {
    io.stdout(
      `  ${other}: the next Claude Code session there starts Squeal again. ` +
        `Delete it there, or run squeal remove --config in that worktree.\n`,
    );
  }
  io.stdout(pluginLine(root));
  return failed.length === 0 ? 0 : PARTIAL_EXIT;
}

/**
 * The plugin's line under "Still there": the uninstall command of each
 * Squeal id `.claude/settings.json` enables, the previous `squeal@squeal`
 * included (row 001-164), or of `squeal@hearsay` when it names none, and the
 * settings entries `squeal init` wrote that are still there.
 */
function pluginLine(root: AbsolutePath): string {
  let settings: unknown = null;
  try {
    settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
  } catch {
    // No settings, or unreadable ones: name the released id and no entries.
  }
  const keys = (field: string, names: readonly string[]): string[] => {
    const value = isRecord(settings) ? settings[field] : undefined;
    return isRecord(value) ? names.filter((name) => name in value) : [];
  };
  const plugins = keys("enabledPlugins", [PLUGIN_ID, PREVIOUS_PLUGIN_ID]);
  const marketplaces = keys("extraKnownMarketplaces", [
    MARKETPLACE_NAME,
    PREVIOUS_MARKETPLACE_NAME,
  ]);
  const uninstall = (plugins.length === 0 ? [PLUGIN_ID] : plugins)
    .map((id) => `claude plugin uninstall ${id} --scope project`)
    .join(", ");
  const entries = [
    ...marketplaces.map((name) => `extraKnownMarketplaces.${name}`),
    ...plugins.map((id) => `enabledPlugins["${id}"]`),
  ];
  return (
    `  The plugin: ${uninstall} (the scope it was installed with)` +
    (entries.length === 0
      ? ".\n"
      : `, and the entries squeal init added to .claude/settings.json: ${entries.join(", ")}.\n`)
  );
}

/** Whether git tracks `path` in the worktree at `root`; `false` when git cannot say. */
async function isTracked(root: AbsolutePath, path: string): Promise<boolean> {
  const out = await runGit(root, ["ls-files", "-z", "--", path]).catch(() => "");
  return out !== "";
}

/**
 * The `squeal.config.json` of every other worktree git lists, where one
 * exists: each starts Squeal again in its next session. Read from git, not
 * the store, so it holds when no store was left to read.
 */
async function otherConfigs(root: AbsolutePath): Promise<AbsolutePath[]> {
  const out = await runGit(root, ["worktree", "list", "--porcelain", "-z"]).catch(() => "");
  return splitNul(out)
    .filter((field) => field.startsWith("worktree ") && field !== `worktree ${root}`)
    .map((field) => join(field.slice("worktree ".length), "squeal.config.json"))
    .filter((path) => existsSync(path));
}

/** Every worktree in the store; none when the store cannot be read, and the locks still guard. */
function recordedWorktrees(commonDir: AbsolutePath): readonly WorktreeRecord[] {
  const store = openStore(commonDir, { create: false, busyTimeoutMs: CLI_SOCKET_TIMEOUT_MS });
  if (isStoreOpenFailure(store)) return [];
  try {
    return store.worktrees.list();
  } finally {
    store.close();
  }
}

/**
 * Asks the worktree's daemon to stop, at the socket `locateDaemon` picks; a
 * root that is gone has its recorded socket, else the computed one, asked.
 * `true` when a daemon there accepted.
 */
async function askToStop(worktree: WorktreeRecord): Promise<boolean> {
  const socketPath = existsSync(worktree.root)
    ? (await locateDaemon(worktree.root, CLI_SOCKET_TIMEOUT_MS, { record: worktree.daemon }))
        .socketPath
    : (worktree.daemon?.socketPath ?? socketPathFor(worktree.id));
  const response = await askDaemon(socketPath, { type: "stop" }).catch(() => null);
  return response?.ok === true;
}

type HeldLocks = DaemonLock[] | { readonly held: string; readonly lockPath: AbsolutePath };

/**
 * Takes the lock of every daemon of the store (`locks/<worktree-hash>.sqlite`,
 * not the waiters' `waiter-*`), waiting up to `waitMs` for daemons to let go.
 * On a timeout every lock taken is released and the one still held named.
 */
async function holdDaemonLocks(commonDir: AbsolutePath, waitMs: number): Promise<HeldLocks> {
  const { locksDir } = storePaths(commonDir);
  const names = safeList(locksDir).filter(
    (name) => name.endsWith(".sqlite") && !name.startsWith("waiter-"),
  );
  const held: DaemonLock[] = [];
  const deadline = Date.now() + waitMs;
  for (const name of names) {
    const lockPath = join(locksDir, name);
    for (;;) {
      const lock = acquireDaemonLock(lockPath);
      if (lock !== null) {
        held.push(lock);
        break;
      }
      if (Date.now() > deadline) {
        for (const lock of held) lock.release();
        return { held: name.slice(0, -".sqlite".length), lockPath };
      }
      await sleep(50);
    }
  }
  return held;
}

/**
 * The temp directories of the repository's daemons (D10), found from the
 * repository id and each recorded root: the directory, those moved aside,
 * and the fallbacks of a refused `/tmp/squeal-<uid>`. Read before the store
 * goes, since the id lives there; without an id no daemon ever made one.
 * Under a `/tmp/squeal-<uid>` that `checkPrivateDir` refuses, as
 * `prepareScratch` does, `tmp/<key>` was never a daemon's, so it is left.
 */
function tempDirs(commonDir: AbsolutePath, worktrees: readonly WorktreeRecord[]): AbsolutePath[] {
  if (!existsSync(join(storePaths(commonDir).dir, "repository-id"))) return [];
  const uid = currentUid();
  const dirs: AbsolutePath[] = [];
  for (const { root } of worktrees) {
    const scratch = daemonScratch(commonDir, root, uid);
    const key = basename(scratch.tempDir);
    if (isPrivate(scratch.userDir, uid)) {
      const tmp = dirname(scratch.tempDir);
      dirs.push(...entries(tmp).filter((path) => isOwnDir(path, uid, `${scratch.tempDir}.old-`)));
      if (existsSync(scratch.tempDir)) dirs.push(scratch.tempDir);
    }
    const fallback = `${userTmpDir(uid)}-${key}-`;
    dirs.push(...entries(dirname(fallback)).filter((path) => isOwnDir(path, uid, fallback)));
  }
  return dirs;
}

function isPrivate(dir: AbsolutePath, uid: number): boolean {
  try {
    checkPrivateDir(dir, uid, "temp directory");
    return true;
  } catch {
    return false;
  }
}

function isOwnDir(path: AbsolutePath, uid: number, prefix: string): boolean {
  if (!path.startsWith(prefix)) return false;
  const stat = lstatSync(path, { throwIfNoEntry: false });
  return stat?.isDirectory() === true && stat.uid === uid;
}

function entries(dir: AbsolutePath): AbsolutePath[] {
  return safeList(dir).map((name) => join(dir, name));
}

function safeList(dir: AbsolutePath): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
