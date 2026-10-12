import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { worktreeLiveness } from "../core/delivery/index.js";
import { worktreeIdFor } from "../core/fs/index.js";
import { testFileId } from "../core/keys/index.js";
import {
  buildSnapshot,
  formatStatus,
  STATUS_BUSY_TIMEOUT_MS,
  withStatusStore,
} from "../core/status/index.js";
import type {
  AbsolutePath,
  CheckKey,
  EpochMs,
  RelativePath,
  StatusSnapshot,
  StatusUnavailable,
  Store,
  TestFileKeyRecord,
  TestFileRef,
  WorktreeId,
} from "../core/types/index.js";
import type { CliIo } from "./main.js";
import { statusCommand } from "./status-command.js";
import type { DaemonSync } from "./status-sync.js";
import { namedFailures, namedLine } from "./status-wait-lines.js";
import { type FileVerdict, readVerdict, verdictCode } from "./verdict.js";

/**
 * The test files named paths select (spec 005 D2), in the worktree's listing
 * order, and the paths that select none, as the worktree names them.
 */
export interface NamedSelection {
  readonly files: readonly TestFileRef[];
  readonly unmatched: readonly string[];
}

/**
 * Spec 005 D2: "A test-file path selects itself. Any other path selects the
 * test files whose closure holds it, using the stored closure only when it is
 * valid for the file's current key (001 D6's rule)." The stored closure is
 * the newest any worktree wrote; it is this worktree's when this worktree
 * wrote it, or when the writer's current key for the file is this
 * worktree's, since a key covers every closure path and its content (as
 * delivery's `closureFor` reads it, task 001-94). Paths resolve against
 * `cwd`; one outside `root` selects nothing.
 */
export function selectNamedFiles(
  store: Store,
  worktreeId: WorktreeId,
  root: AbsolutePath,
  cwd: AbsolutePath,
  paths: readonly string[],
): NamedSelection {
  const rows = store.testFileKeys.list(worktreeId);
  const closures = validClosures(store, worktreeId, rows);
  const selected = new Map<string, TestFileRef>();
  const unmatched: string[] = [];
  for (const path of paths) {
    const rel = worktreePath(root, cwd, path);
    const hits =
      rel === null
        ? []
        : rows.filter((row) => row.testFile.path === rel || closures.get(row)?.has(rel) === true);
    if (hits.length === 0) unmatched.push(rel ?? path);
    for (const row of hits) selected.set(testFileId(row.testFile), row.testFile);
  }
  return { files: [...selected.values()], unmatched };
}

/** Each row's stored closure, when it is valid for the row's key (`selectNamedFiles`). */
function validClosures(
  store: Store,
  worktreeId: WorktreeId,
  rows: readonly TestFileKeyRecord[],
): ReadonlyMap<TestFileKeyRecord, ReadonlySet<RelativePath>> {
  const records = new Map(store.testFiles.list().map((r) => [testFileId(r.testFile), r]));
  const keys = new Map<WorktreeId, ReadonlyMap<string, CheckKey | null>>();
  const keyOf = (id: WorktreeId, ref: TestFileRef) => {
    let byFile = keys.get(id);
    if (byFile === undefined) {
      byFile = new Map(store.testFileKeys.list(id).map((r) => [testFileId(r.testFile), r.key]));
      keys.set(id, byFile);
    }
    return byFile.get(testFileId(ref)) ?? null;
  };
  const closures = new Map<TestFileKeyRecord, ReadonlySet<RelativePath>>();
  for (const row of rows) {
    const record = records.get(testFileId(row.testFile));
    if (record === undefined) continue;
    const own =
      record.updatedBy === worktreeId ||
      (row.key !== null && row.key === keyOf(record.updatedBy, row.testFile));
    if (own) closures.set(row, new Set(record.closure.paths));
  }
  return closures;
}

/**
 * `path` relative to `root` with `/` separators, resolved against `cwd`, or
 * against its real path when `cwd` reaches the worktree through a symlink;
 * `null` outside the worktree.
 */
function worktreePath(root: AbsolutePath, cwd: AbsolutePath, path: string): RelativePath | null {
  for (const base of [cwd, realOrNull(cwd)]) {
    if (base === null) continue;
    const rel = relative(root, resolve(base, path));
    const outside = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
    if (rel !== "" && !outside) return rel.split(sep).join("/");
  }
  return null;
}

function realOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** Spec 005 D2's path form: `settled`, no selected file pending; `unmatched`, a path selects nothing. */
export type NamedWaitOutcome = "settled" | "unmatched" | "no-daemon" | "timeout";

export type NamedWait =
  | {
      readonly outcome: NamedWaitOutcome;
      readonly waitedMs: number;
      readonly selection: NamedSelection;
      readonly verdict: FileVerdict;
      readonly result: StatusSnapshot;
    }
  | {
      readonly outcome: "unavailable";
      readonly waitedMs: number;
      readonly result: StatusUnavailable;
    };

/** The `wait` field `status --json --wait <ms> <path>...` adds to the snapshot. */
export interface NamedWaitPayload {
  readonly outcome: NamedWaitOutcome;
  readonly waitedMs: number;
  readonly code: 0 | 1 | 3;
  readonly testFiles: readonly TestFileRef[];
  readonly unmatched: readonly string[];
  readonly verdict: FileVerdict;
}

export interface NamedWaitOptions {
  readonly timeoutMs: number;
  readonly pollMs: number;
  readonly settleMs: number;
  readonly now: () => EpochMs;
  readonly sync: (root: AbsolutePath, pollMs: number) => DaemonSync;
}

/**
 * Spec 005 D2: waits until every test file `paths` select has a result for
 * its current key at the current revision, or the deadline. No daemon
 * request and no priority. The selection is decided at a revision that holds
 * every edit made before the wait and whose test files the runner listed (the
 * daemon's `sync` pass, lessons defect 30), so a test file written just
 * before the wait is found; a daemon that cannot sync falls back to the
 * settle time, and the deadline decides with what it finds. It is read again
 * at every poll, since an edit can change a closure. A store that cannot be
 * read at the first read or the last ends the wait; one in between is skipped.
 */
export async function waitForNamed(
  cwd: AbsolutePath,
  paths: readonly string[],
  options: NamedWaitOptions,
): Promise<NamedWait> {
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  let sync: DaemonSync | undefined;
  let first = true;
  try {
    for (;;) {
      const final = elapsed() >= options.timeoutMs;
      const left = options.timeoutMs - elapsed();
      const busyTimeoutMs = final
        ? STATUS_BUSY_TIMEOUT_MS
        : Math.round(Math.max(50, Math.min(STATUS_BUSY_TIMEOUT_MS, left)));
      const read = withStatusStore(cwd, { busyTimeoutMs }, ({ store, root }) => {
        const id = worktreeIdFor(root);
        sync ??= options.sync(root, options.pollMs);
        const selection = selectNamedFiles(store, id, root, cwd, paths);
        const verdict = readVerdict(store, id, selection.files);
        const settled = final || elapsed() >= options.settleMs;
        const daemon = worktreeLiveness(store.worktrees.get(id), options.now());
        const current = sync.current();
        const ready =
          final ||
          (current.state === "synced"
            ? verdict.revision >= current.revision && !verdict.unlisted
            : current.state === "unsupported" && settled);
        const outcome: NamedWaitOutcome | null =
          settled && daemon.state !== "alive"
            ? "no-daemon"
            : !ready
              ? null
              : selection.unmatched.length > 0
                ? "unmatched"
                : verdict.byClass.pending === 0 && !verdict.unlisted
                  ? "settled"
                  : final
                    ? "timeout"
                    : null;
        if (outcome === null) return null;
        return { outcome, selection, verdict, result: buildSnapshot(store, root, options.now()) };
      });
      if (read !== null && "available" in read) {
        if (first || final) return { outcome: "unavailable", waitedMs: elapsed(), result: read };
      } else if (read !== null) {
        return { ...read, waitedMs: elapsed() };
      }
      first = false;
      const remaining = options.timeoutMs - elapsed();
      if (remaining > 0) await sleep(Math.min(options.pollMs, remaining));
    }
  } finally {
    sync?.stop();
  }
}

/** Spec 005 D1 for the selected files: their verdict once settled, else 3. */
export function namedCode(wait: Extract<NamedWait, { result: StatusSnapshot }>): 0 | 1 | 3 {
  return wait.outcome === "settled" ? verdictCode(wait.verdict) : 3;
}

/**
 * `squeal status [--json] --wait <ms> <path>...` (spec 005 D2). The first
 * line is the verdict on the selected files, then their failures in full,
 * then the snapshot; with `--json` the line goes to stderr and stdout is the
 * snapshot plus a `wait` field (`NamedWaitPayload`). Exits as D1 for the
 * selected files only: 0, 1 with known failures among them, 3 without a
 * verdict, an unreadable store included.
 */
export async function namedWaitCommand(
  paths: readonly string[],
  json: boolean,
  io: CliIo,
  options: NamedWaitOptions,
): Promise<number> {
  const env = io.env ?? process.env;
  const wait = await waitForNamed(io.cwd ?? process.cwd(), paths, options);
  if (wait.outcome === "unavailable") {
    const { result } = wait;
    io.stdout(json ? `${JSON.stringify(result, null, 2)}\n` : formatStatus(result, options.now()));
    return 3;
  }
  const code = namedCode(wait);
  const command = statusCommand(env);
  const line = `${namedLine(wait, command)}\n`;
  if (json) {
    const payload: NamedWaitPayload = {
      outcome: wait.outcome,
      waitedMs: Math.round(wait.waitedMs),
      code,
      testFiles: wait.selection.files,
      unmatched: wait.selection.unmatched,
      verdict: wait.verdict,
    };
    io.stdout(`${JSON.stringify({ ...wait.result, wait: payload }, null, 2)}\n`);
    io.stderr(line);
  } else {
    const failures = namedFailures(wait);
    const block = failures.length === 0 ? "" : `${failures.join("\n")}\n`;
    io.stdout(`${line}${block}\n${formatStatus(wait.result, options.now(), command)}`);
  }
  return code;
}
