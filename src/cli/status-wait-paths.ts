import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { daemonLiveness } from "../core/delivery/index.js";
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
import { fileEntry, type NamedFileEntry } from "./named-file-lines.js";
import { type NamedFile, pauseOnlyIds, readNamedFiles } from "./named-files.js";
import { statusCommand } from "./status-command.js";
import { type DaemonSync, pollPause, SYNC_POLL_MS, type SyncState } from "./status-sync.js";
import { namedClassLines, namedLine, namedText, selectedLine } from "./status-wait-lines.js";
import { ownPathFiles, type PromoteNamed, promoteNamed } from "./status-wait-promote.js";
import { type FileVerdict, readClasses, readVerdict, verdictCode } from "./verdict.js";
import {
  type DaemonWatch,
  type DownReason,
  type HeartbeatLapse,
  watchDaemon,
} from "./wait-liveness.js";

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
 * delivery's `closureFor` reads it, task 001-94). A listed test file's path
 * never reaches the closure lookup, so another test file whose closure holds
 * it through declared inputs or an import is not selected (task 005-67,
 * issue 6). Paths resolve against `cwd`; one outside `root` selects nothing.
 */
export function selectNamedFiles(
  store: Store,
  worktreeId: WorktreeId,
  root: AbsolutePath,
  cwd: AbsolutePath,
  paths: readonly string[],
): NamedSelection {
  const rows = store.testFileKeys.list(worktreeId);
  // Read only for a path no test file has: every stored closure is a large read (task 011-42).
  let closures: ReturnType<typeof validClosures> | undefined;
  const selected = new Map<string, TestFileRef>();
  const unmatched: string[] = [];
  for (const path of paths) {
    const rel = worktreePath(root, cwd, path);
    const own = rows.filter((row) => row.testFile.path === rel);
    const hits =
      rel === null
        ? []
        : own.length > 0
          ? own
          : rows.filter((row) => {
              closures ??= validClosures(store, worktreeId, rows);
              return closures.get(row)?.has(rel) === true;
            });
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

/**
 * Spec 005 D2's path form: `settled`, no selected file it holds for pending;
 * `unmatched`, a path selects nothing; `slow`, every selected file runs only
 * on a pause (task 004-78), so there is nothing to hold for.
 */
export type NamedWaitOutcome = "settled" | "unmatched" | "slow" | "no-daemon" | "timeout";

export type NamedWait =
  | {
      readonly outcome: NamedWaitOutcome;
      readonly waitedMs: number;
      readonly selection: NamedSelection;
      /**
       * The selected slow files that run only on a pause, which the wait
       * does not hold for (task 004-78), in `selection` order; none when absent.
       */
      readonly leftForPause?: readonly TestFileRef[];
      /** The verdict on the selected files but `leftForPause`. */
      readonly verdict: FileVerdict;
      /** Each selected file's class, verdict and what holds it (task 011-12), in `selection` order. */
      readonly files: readonly NamedFile[];
      readonly result: StatusSnapshot;
      /** Where the daemon's pass stood at the last read: a `timeout` before it reached the store's revision says so. */
      readonly sync: SyncState;
      /** With `no-daemon`: why (task 004-66). */
      readonly down?: DownReason;
      /** A heartbeat lapse the wait went on through, the daemon alive (task 004-66). */
      readonly lapse?: HeartbeatLapse;
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
  readonly testFiles: readonly NamedFileEntry[];
  readonly unmatched: readonly string[];
  /** The selected slow files it did not hold for, waiting for a pause or `run --slow` (task 004-78). */
  readonly leftForPause: readonly TestFileRef[];
  readonly verdict: FileVerdict;
}

export interface NamedWaitOptions {
  readonly timeoutMs: number;
  readonly pollMs: number;
  readonly settleMs: number;
  readonly now: () => EpochMs;
  readonly sync: (root: AbsolutePath, pollMs: number) => DaemonSync;
  /** Default `WAIT_DOWN_MS`: how long a stale record's dead socket may stay so (task 004-66). */
  readonly downMs?: number;
  /** Default `promoteNamed`; tests replace it (spec 011 C15). */
  readonly promote?: PromoteNamed;
}

/**
 * Spec 005 D2: waits until every test file `paths` select has a result for
 * its current key at the current revision, or the deadline. Once its
 * selection is decided, it asks the daemon to promote the test files named
 * by their own paths (spec 011 C15), nothing more. The selection is decided
 * at a revision that holds every edit made before the wait and whose test
 * files the runner listed (the daemon's `sync` pass, lessons defect 30), so
 * a test file written just before the wait is found; a daemon that cannot
 * sync falls back to the settle time. A deadline before that revision is a timeout, never the old
 * results' verdict (review wave-1, B1); a read ready at the deadline gives
 * its verdict. It is read again
 * at every poll, since an edit can change a closure. A store that cannot be
 * read at the first read or the last ends the wait; one in between is skipped.
 * A stale heartbeat ends it only once `watchDaemon` finds no daemon: a cleared
 * record, or a socket dead for `downMs` (task 004-66, issue 12).
 *
 * Task 004-78 (research `atomic-flags-0215.md` 4): a selected slow file that
 * runs only on a pause (`pauseOnlyIds`) is left out of what the wait holds
 * for, decided at each ready read for the files not yet left out and kept
 * for the rest of the wait, so a wait over fast and slow files gives the
 * fast verdict at once and one over slow files alone returns `slow`.
 */
export async function waitForNamed(
  cwd: AbsolutePath,
  paths: readonly string[],
  options: NamedWaitOptions,
): Promise<NamedWait> {
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  let sync: DaemonSync | undefined;
  let watch: DaemonWatch | undefined;
  let first = true;
  let promoted = false;
  const paused = new Set<string>();
  try {
    for (;;) {
      const final = elapsed() >= options.timeoutMs;
      const left = options.timeoutMs - elapsed();
      const busyTimeoutMs = final
        ? STATUS_BUSY_TIMEOUT_MS
        : Math.round(Math.max(50, Math.min(STATUS_BUSY_TIMEOUT_MS, left)));
      const read = withStatusStore(cwd, { busyTimeoutMs }, ({ store, root }) => {
        const id = worktreeIdFor(root);
        sync ??= options.sync(root, Math.min(options.pollMs, SYNC_POLL_MS));
        const selection = selectNamedFiles(store, id, root, cwd, paths);
        // Task 011-42: a poll reads the selected files' states only; the verdict, once it ends.
        const all = readClasses(store, id, selection.files);
        const settled = final || elapsed() >= options.settleMs;
        watch ??= watchDaemon(id, { downMs: options.downMs });
        const record = store.worktrees.get(id)?.daemon ?? null;
        const daemon = watch.judge(record, options.now());
        const current = sync.current();
        // A lapsed heartbeat gives no verdict yet: the daemon may be mid-run (004-66).
        const ready =
          daemon.state === "alive" &&
          (current.state === "synced"
            ? all.revision >= current.revision && !all.unlisted
            : current.state === "unsupported" && settled);
        if (ready) {
          const open = selection.files.filter((f) => !paused.has(testFileId(f)));
          const liveness = daemonLiveness(record, options.now());
          for (const pid of pauseOnlyIds(store, id, root, open, liveness, options.now())) {
            paused.add(pid);
          }
        }
        const leftForPause = selection.files.filter((f) => paused.has(testFileId(f)));
        const held = selection.files.filter((f) => !paused.has(testFileId(f)));
        const classes = leftForPause.length === 0 ? all : readClasses(store, id, held);
        const outcome: NamedWaitOutcome | null =
          settled && daemon.state === "down"
            ? "no-daemon"
            : ready && selection.unmatched.length > 0
              ? "unmatched"
              : ready && held.length === 0
                ? "slow"
                : ready && classes.byClass.pending === 0 && !classes.unlisted
                  ? "settled"
                  : final
                    ? "timeout"
                    : null;
        if (outcome === null) {
          // Spec 011 C15: once, at the first read whose selection is decided, beside it.
          if (ready && !promoted) {
            promoted = true;
            const own = ownPathFiles(
              selection.files,
              paths.map((p) => worktreePath(root, cwd, p)),
            );
            (options.promote ?? promoteNamed)(root, own, options.timeoutMs - elapsed());
          }
          return null;
        }
        const verdict = readVerdict(store, id, held);
        const result = buildSnapshot(store, root, options.now());
        const files = readNamedFiles(
          store,
          id,
          root,
          selection.files,
          result.daemon,
          options.now(),
        );
        const lapse = watch.lapse();
        return {
          outcome,
          selection,
          leftForPause,
          verdict,
          files,
          result,
          sync: current,
          ...(daemon.state === "down" ? { down: daemon.reason } : {}),
          ...(lapse === null ? {} : { lapse }),
        };
      });
      if (read !== null && "available" in read) {
        if (first || final) return { outcome: "unavailable", waitedMs: elapsed(), result: read };
      } else if (read !== null) {
        return { ...read, waitedMs: elapsed() };
      }
      first = false;
      const remaining = options.timeoutMs - elapsed();
      if (remaining > 0) await pollPause(Math.min(options.pollMs, remaining), sync);
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
 * `squeal status [--json] --wait <ms> <path>...` (spec 005 D2). The
 * snapshot, then the line naming the selected files and their failures in
 * full, then last the verdict on them (issue 26); with `--json` the naming
 * and verdict lines go to stderr and stdout is the
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
  if (json) {
    const payload: NamedWaitPayload = {
      outcome: wait.outcome,
      waitedMs: Math.round(wait.waitedMs),
      code,
      testFiles: wait.files.map((f) => fileEntry(f, command)),
      unmatched: wait.selection.unmatched,
      leftForPause: wait.leftForPause ?? [],
      verdict: wait.verdict,
    };
    io.stdout(`${JSON.stringify({ ...wait.result, wait: payload }, null, 2)}\n`);
    const selected = selectedLine(wait);
    const lines = [...(selected === null ? [] : [selected]), ...namedClassLines(wait, command)];
    io.stderr(`${lines.map((line) => `${line}\n`).join("")}${namedLine(wait, command)}\n`);
  } else {
    io.stdout(namedText(wait, options.now(), command));
  }
  return code;
}
