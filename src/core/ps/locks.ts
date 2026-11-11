import { existsSync } from "node:fs";
import { join } from "node:path";
import { describeHolders, holdersFrom, type LockHolder } from "../store/lock-holders.js";
import { storePaths } from "../store/paths.js";
import type { AbsolutePath } from "../types/common.js";
import { discover } from "./discover.js";
import type { PsPlaces } from "./model.js";
import type { PsSource } from "./source.js";

/*
 * Spec 021 D5 (row 021-10): `squeal ps --locks`. For this repository and
 * each repository a daemon of this user serves, who holds or waits for the
 * write lock of its store and of its code store, from `/proc/locks` on byte
 * 120 of each `-shm` file (`lockHolders`). It opens no database.
 */

/** The version of the `squeal ps --locks --json` shape. */
export const PS_LOCKS_VERSION = 1;

/** One SQLite file and the processes on its write lock. */
export interface PsLockedFile {
  readonly path: AbsolutePath;
  /** A file that does not exist has no lock to hold: the code store with complexity off. */
  readonly exists: boolean;
  /** Holders first, then waiters; `null` when `/proc/locks` cannot be read. */
  readonly holders: readonly LockHolder[] | null;
}

export interface PsRepositoryLocks {
  /** Its git common dir: its stores lie in `<commonDir>/squeal`. */
  readonly commonDir: AbsolutePath;
  /** The repository `squeal ps` runs in. */
  readonly current: boolean;
  readonly store: PsLockedFile;
  readonly codeStore: PsLockedFile;
}

export interface PsLocks {
  readonly version: typeof PS_LOCKS_VERSION;
  /** This repository first, then the others by path. */
  readonly repositories: readonly PsRepositoryLocks[];
}

/**
 * The write locks of this repository's stores and, without `repo`, of every
 * repository a daemon of this user serves (014 D2's discovery).
 */
export function readLocks(source: PsSource, places: PsPlaces, repo: boolean): PsLocks {
  const others = repo
    ? []
    : discover(source, source.processTable(), places)
        .daemons.flatMap((d) => (d.commonDir === null ? [] : [d.commonDir]))
        .filter((dir) => dir !== places.commonDir);
  const current = places.commonDir === null ? [] : [places.commonDir];
  const repositories = [...current, ...[...new Set(others)].sort()].map((commonDir) => ({
    commonDir,
    current: commonDir === places.commonDir,
    store: lockedFile(source, storePaths(commonDir).database),
    codeStore: lockedFile(source, codeStoreOf(commonDir)),
  }));
  return { version: PS_LOCKS_VERSION, repositories };
}

/**
 * `codeStorePath` of `core/code/store/open.ts` (spec 015 D4), whose module
 * would bring the code store's code into `ps`'s bundle (014 goal 6).
 */
export function codeStoreOf(commonDir: AbsolutePath): AbsolutePath {
  return join(storePaths(commonDir).dir, "code.sqlite");
}

function lockedFile(source: PsSource, path: AbsolutePath): PsLockedFile {
  return { path, exists: existsSync(path), holders: holdersFrom(source, path) ?? null };
}

/** The text of `squeal ps --locks`; `cwd` names where it ran when no store is found. */
export function renderLocks(locks: PsLocks, cwd: string): string {
  if (locks.repositories.length === 0) {
    return `No Squeal store to show: no daemon of this user runs, and ${cwd} is not inside a git repository.\n`;
  }
  const lines = ["Write locks of each Squeal store, from /proc/locks:", ""];
  for (const r of locks.repositories) {
    lines.push(`${join(r.commonDir, "squeal")}${r.current ? " (this repository)" : ""}`);
    lines.push(...fileLines("store.sqlite", r.store), ...fileLines("code.sqlite", r.codeStore));
  }
  const files = locks.repositories.flatMap((r) => [r.store, r.codeStore]);
  if (files.every((f) => f.holders !== null && f.holders.length === 0)) {
    lines.push("", "No process holds or waits for a store's write lock.");
  }
  return `${lines.join("\n")}\n`;
}

const NAME_WIDTH = "store.sqlite".length + 2;

function fileLines(name: string, file: PsLockedFile): readonly string[] {
  const label = `  ${name.padEnd(NAME_WIDTH)}`;
  const indent = " ".repeat(label.length);
  if (!file.exists) return [`${label}no file`];
  if (file.holders === null) return [`${label}holders unknown: /proc/locks cannot be read`];
  if (file.holders.length === 0) return [`${label}not held`];
  const clauses = file.holders.map((h) =>
    h.waiting ? `pid ${h.pid} waits (${h.command})` : describeHolders([h]),
  );
  if (file.holders.every((h) => h.waiting)) clauses.unshift("not held");
  return clauses.map((clause, at) => `${at === 0 ? label : indent}${clause}`);
}
