import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { locateDaemon } from "../core/daemon/ensure.js";
import { acquireDaemonLock, type DaemonLock } from "../core/daemon/lock.js";
import { currentUid, socketPathFor, userTmpDir } from "../core/daemon/paths.js";
import { daemonScratch } from "../core/daemon/scratch.js";
import { resolveCommonDir } from "../core/fs/index.js";
import { isStoreOpenFailure, openStore } from "../core/store/open.js";
import { storePaths } from "../core/store/paths.js";
import type { AbsolutePath, WorktreeRecord } from "../core/types/index.js";
import { askDaemon, CLI_SOCKET_TIMEOUT_MS, worktreeRoot } from "./daemon-access.js";
import type { CliIo } from "./main.js";

/** A daemon asked to stop finishes the tier in flight (D10); `remove` waits this long for it. */
const STOP_WAIT_MS = 5_000;

export interface RemoveOptions {
  readonly stopWaitMs?: number;
}

/**
 * `squeal remove [--config]`: stops the daemon of every worktree of the
 * repository, then deletes `<common-dir>/squeal/` and the daemons' temp
 * directories (D1, D10), holding every daemon lock while it deletes so no
 * daemon starts in between. A daemon that does not stop deletes nothing.
 * `--config` also deletes this worktree's `squeal.config.json` (D11).
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
      const temps = tempDirs(commonDir, worktrees);
      rmSync(storeDir, { recursive: true, force: true });
      for (const dir of temps) rmSync(dir, { recursive: true, force: true });
      removed.push(`${storeDir} (store, locks, run logs, repository id)`);
      removed.push(...temps.map((dir) => `${dir} (a daemon's temp directory)`));
      if (stopped.length > 0) {
        io.stdout(`Stopped the daemons of:\n${stopped.map((r) => `  ${r}\n`).join("")}`);
      }
    } finally {
      for (const lock of locks) lock.release();
    }
  }
  if (config && existsSync(configPath)) {
    rmSync(configPath);
    removed.push(configPath);
  }

  io.stdout(
    removed.length === 0
      ? `Nothing to remove: no Squeal store for this repository.\n`
      : `Removed:\n${removed.map((line) => `  ${line}\n`).join("")}`,
  );
  io.stdout("Still there:\n");
  if (existsSync(configPath)) {
    io.stdout(
      `  ${configPath}: the next Claude Code session here starts Squeal again. ` +
        `It is committed; delete it, or run squeal remove --config.\n`,
    );
  }
  io.stdout(
    "  The plugin: claude plugin uninstall squeal@squeal --scope project (the scope it was " +
      "installed with), and the extraKnownMarketplaces and enabledPlugins entries squeal init " +
      "added to .claude/settings.json.\n",
  );
  return 0;
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
 */
function tempDirs(commonDir: AbsolutePath, worktrees: readonly WorktreeRecord[]): AbsolutePath[] {
  if (!existsSync(join(storePaths(commonDir).dir, "repository-id"))) return [];
  const uid = currentUid();
  const dirs: AbsolutePath[] = [];
  for (const { root } of worktrees) {
    const scratch = daemonScratch(commonDir, root, uid);
    const key = basename(scratch.tempDir);
    const tmp = dirname(scratch.tempDir);
    dirs.push(...entries(tmp).filter((path) => isOwnDir(path, uid, `${scratch.tempDir}.old-`)));
    if (existsSync(scratch.tempDir)) dirs.push(scratch.tempDir);
    const fallback = `${userTmpDir(uid)}-${key}-`;
    dirs.push(...entries(dirname(fallback)).filter((path) => isOwnDir(path, uid, fallback)));
  }
  return dirs;
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
