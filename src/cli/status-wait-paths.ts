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
  StatusHold,
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
import {
  anyFailed,
  CHECK_NEEDS_TEST_FILE,
  CheckUsageError,
  focusAnswered,
  focusOf,
  type NamedFocus,
  wholeFileReasons,
} from "./status-wait-focus.js";
import {
  type FocusedPayload,
  focusLines,
  focusPayload,
  refusedLine,
} from "./status-wait-focus-lines.js";
import {
  type NamedTextOptions,
  namedClassLines,
  namedLine,
  namedText,
  selectedLine,
} from "./status-wait-lines.js";
import {
  type FocusNamed,
  type FocusReply,
  focusNamed,
  ownPathFiles,
  type PromoteNamed,
  promoteNamed,
} from "./status-wait-promote.js";
import {
  type FileClasses,
  type FileVerdict,
  holdOfWait,
  readClasses,
  readVerdict,
  verdictCode,
} from "./verdict.js";
import {
  type DaemonWatch,
  type DownReason,
  type HeartbeatLapse,
  stoppingOf,
  watchDaemon,
} from "./wait-liveness.js";

/**
 * The test files named paths select (spec 005 D2), in the worktree's listing
 * order, and the paths that select none, as the worktree names them.
 */
export interface NamedSelection {
  readonly files: readonly TestFileRef[];
  readonly unmatched: readonly string[];
  /** Row 011-27 (gh-39): each of `unmatched`, in its order, with how it was read. */
  readonly unmatchedPaths?: readonly UnmatchedPath[];
  /**
   * The directory the paths were resolved against, relative to the root (`""`
   * the root itself), else absolute: a printed command names its paths from
   * it, since `retry` resolves its arguments against the cwd (review of
   * cand/0.1.231, B1).
   */
  readonly base?: string;
}

/** A path that selects nothing, as given and as resolved (row 011-27, gh-39). */
export interface UnmatchedPath {
  /** `unmatched`'s entry: relative to the root, or as given outside it. */
  readonly resolved: string;
  readonly given: string;
  /** The directory it was resolved against, relative to the root (`""` the root itself), else absolute. */
  readonly base?: string;
  /** The listed test file the same path names from the worktree root, which it never selects. */
  readonly fromRoot?: string;
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
  const unmatched: UnmatchedPath[] = [];
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
    if (hits.length === 0) unmatched.push(unmatchedOf(root, cwd, path, rel, rows));
    for (const row of hits) selected.set(testFileId(row.testFile), row.testFile);
  }
  const resolved = unmatched.map((p) => p.resolved);
  return {
    files: [...selected.values()],
    unmatched: resolved,
    unmatchedPaths: unmatched,
    base: baseOf(root, cwd),
  };
}

/**
 * Row 011-27 (gh-39): how `path` was read, `rel` its reading from `cwd`:
 * the directory it was resolved against and, for a relative path given
 * below the root, the listed test file the same path names from the root.
 */
function unmatchedOf(
  root: AbsolutePath,
  cwd: AbsolutePath,
  path: string,
  rel: RelativePath | null,
  rows: readonly TestFileKeyRecord[],
): UnmatchedPath {
  const own = { resolved: rel ?? path, given: path, base: baseOf(root, cwd) };
  if (isAbsolute(path) || own.base === "") return own;
  const fromRoot = worktreePath(root, root, path);
  const listed = fromRoot !== null && rows.some((row) => row.testFile.path === fromRoot);
  return listed ? { ...own, fromRoot } : own;
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

/** `cwd` relative to `root` with `/` (`""` the root itself), as `worktreePath` reads it; else `cwd`. */
export function baseOf(root: AbsolutePath, cwd: AbsolutePath): string {
  for (const base of [cwd, realOrNull(cwd)]) {
    if (base === null) continue;
    const rel = relative(root, base);
    if (rel === "") return "";
    const outside = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
    if (!outside) return rel.split(sep).join("/");
  }
  return cwd;
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
 * `unmatched`, no path selects a file; `slow`, every selected file runs only
 * on a pause (task 004-78), so there is nothing to hold for; `on-hold`, a
 * file it holds for is queued while the worktree is on hold (row 011-73,
 * C6 as amended 2026-10-21); `focused`, every file named by its own path
 * with `--check` has its focused answer (row 011-146, C15 as amended
 * 2026-10-23). Row 011-63
 * (gh-59): a path that selects nothing beside one that selects a file is
 * named beside the other outcomes (`selection.unmatched`).
 */
export type NamedWaitOutcome =
  | "settled"
  | "focused"
  | "unmatched"
  | "slow"
  | "no-daemon"
  | "on-hold"
  | "timeout";

/**
 * The outcome of a read whose selection is decided, `null` while a file it
 * holds for is pending. Row 011-63 (gh-59, the human 2026-10-21): a path that
 * selects nothing ends the wait only when no path selects a file, so the
 * files the others select keep their promotion and give their verdict.
 */
export function decidedOutcome(
  selection: NamedSelection,
  held: readonly TestFileRef[],
  classes: FileClasses,
): "settled" | "unmatched" | "slow" | null {
  if (selection.files.length === 0) return "unmatched";
  if (held.length === 0) return "slow";
  return classes.byClass.pending === 0 && !classes.unlisted ? "settled" : null;
}

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
      /** With `on-hold`: the hold its verdict line names (row 011-73). */
      readonly hold?: StatusHold;
      /**
       * `status <path>...` without `--wait` (row 011-28, 005 D2 as amended
       * 2026-10-20): one read after one sync, worded as a snapshot; its
       * `timeout` is a read with no verdict.
       */
      readonly snapshot?: boolean;
      /** Row 011-146: with `--check`, the focused answers it read. */
      readonly focus?: NamedFocus;
    }
  | {
      readonly outcome: "unavailable";
      readonly waitedMs: number;
      readonly result: StatusUnavailable;
    };

/**
 * The `selection` field both `status --json --wait <ms> <path>...` and
 * `status --json <path>...` add to the snapshot (row 011-63, gh-65), whose
 * outcome is `snapshot` for the latter; also the wait's `wait` field and the
 * snapshot's `named` field (row 011-28), kept.
 */
export interface NamedWaitPayload {
  readonly outcome: NamedWaitOutcome | "snapshot";
  readonly waitedMs: number;
  readonly code: 0 | 1 | 3;
  readonly testFiles: readonly NamedFileEntry[];
  readonly unmatched: readonly string[];
  /** The selected slow files it did not hold for, waiting for a pause or `run --slow` (task 004-78). */
  readonly leftForPause: readonly TestFileRef[];
  readonly verdict: FileVerdict;
  /** Row 011-146: with `--check`, the focused answers (011 C15, additive). */
  readonly focused?: FocusedPayload;
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
  /** Row 011-146: the `--check` texts; none for a named wait as before. */
  readonly checks?: readonly string[];
  /** Default `focusNamed`; tests replace it (row 011-146). */
  readonly focus?: FocusNamed;
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
 *
 * Row 011-146 (C15 as amended 2026-10-23): with `checks`, it sends `focus`
 * beside the promotion for the files named by their own paths the daemon
 * focuses, and returns `focused` once each has a focused run ended at its
 * current key or a result stored there (`focusAnswered`). A file current
 * before that gives the named wait's verdict. A daemon that does not know
 * the request leaves it a named wait.
 */
export async function waitForNamed(
  cwd: AbsolutePath,
  paths: readonly string[],
  options: NamedWaitOptions,
): Promise<NamedWait> {
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  // The deadline on the store's clock, for the promotion's lifetime and the last read (row 011-63).
  const deadline = options.now() + options.timeoutMs;
  let sync: DaemonSync | undefined;
  let watch: DaemonWatch | undefined;
  let first = true;
  let promoted = false;
  let reply: FocusReply | undefined;
  let whole: ReadonlyMap<string, string> | undefined;
  const checks = options.checks ?? [];
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
        const worktree = store.worktrees.get(id);
        const record = worktree?.daemon ?? null;
        const readAt = options.now();
        const daemon = watch.judge(record, readAt, stoppingOf(store, worktree, readAt));
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
        const decided = ready ? decidedOutcome(selection, held, classes) : null;
        // The files named by their own paths, read once the selection is decided: to promote, or to focus.
        const own =
          ready && (checks.length > 0 || !promoted)
            ? ownNamedFiles(root, cwd, paths, selection)
            : [];
        // Row 011-146 (C15): a source path selects no focus; with no own path, a usage error,
        // whether or not a test file reads the source (review 0.1.286 B4).
        if (checks.length > 0 && ready && own.length === 0) {
          return { usage: CHECK_NEEDS_TEST_FILE };
        }
        if (checks.length > 0 && ready) whole ??= wholeFileReasons(root, own);
        const focus =
          whole === undefined ? undefined : focusOf(store, id, own, checks, whole, reply, record);
        // Row 011-73 (C6 as amended 2026-10-21): a held file queued on hold waits for its end.
        const hold =
          ready && decided === null
            ? holdOfWait(store, id, () => store.testFileKeys.list(id, held), readAt)
            : null;
        const focused = decided === null && focus !== undefined && focusAnswered(focus);
        const outcome: NamedWaitOutcome | null =
          settled && daemon.state === "down"
            ? "no-daemon"
            : (decided ??
              (focused ? "focused" : hold !== null ? "on-hold" : final ? "timeout" : null));
        if (outcome === null) {
          // Spec 011 C15: once, at the first read whose selection is decided, beside it.
          if (ready && !promoted) {
            promoted = true;
            // On the clock the daemon adds it to, so the promotion lasts at least to `deadline`.
            (options.promote ?? promoteNamed)(root, own, deadline - options.now());
            const focusing = (focus?.files ?? []).filter((f) => f.whole === undefined);
            if (focus !== undefined && focusing.length > 0) {
              const send = options.focus ?? focusNamed;
              const files = focusing.map((f) => f.testFile);
              void send(root, files, focus.texts, deadline - options.now()).then((answer) => {
                reply = answer;
              });
            }
          }
          return null;
        }
        const verdict = readVerdict(store, id, held);
        const result = buildSnapshot(store, root, options.now());
        // Row 011-63 (gh-51 3): a read at the deadline names what held each file as of
        // its last millisecond, while the promotion this wait sent still held it.
        const at = Math.min(options.now(), deadline - 1) as EpochMs;
        const files = readNamedFiles(store, id, root, selection.files, result.daemon, at);
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
          ...(hold === null ? {} : { hold }),
          ...(focus === undefined ? {} : { focus }),
        };
      });
      if (read !== null && "usage" in read) throw new CheckUsageError(read.usage);
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

/**
 * The selected test files named by their own paths, as the worktree names
 * them: the ones a wait promotes and focuses (spec 011 C15).
 */
export function ownNamedFiles(
  root: AbsolutePath,
  cwd: AbsolutePath,
  paths: readonly string[],
  selection: NamedSelection,
): TestFileRef[] {
  return ownPathFiles(
    selection.files,
    paths.map((p) => worktreePath(root, cwd, p)),
  );
}

/**
 * Spec 005 D1 for the selected files: their verdict once settled, else 3.
 * Row 011-63 (gh-59): a path that selects nothing leaves no clean verdict,
 * so 3, but a known failure among the files the others select is still 1.
 */
export function namedCode(wait: Extract<NamedWait, { result: StatusSnapshot }>): 0 | 1 | 3 {
  // Row 011-146 (C15): a focused answer is not the file's verdict: 1 when a selected check failed, else 3.
  if (wait.outcome === "focused")
    return wait.focus !== undefined && anyFailed(wait.focus.files) ? 1 : 3;
  if (wait.outcome !== "settled") return 3;
  const code = verdictCode(wait.verdict);
  return code === 0 && wait.selection.unmatched.length > 0 ? 3 : code;
}

/** How a named wait or snapshot prints (`printNamed`). */
export interface NamedPrint extends NamedTextOptions {
  readonly json: boolean;
}

/**
 * `squeal status [--json] [--full] --wait <ms> <path>...` (spec 005 D2):
 * the wait, then `printNamed`.
 */
export async function namedWaitCommand(
  paths: readonly string[],
  how: NamedPrint,
  io: CliIo,
  options: NamedWaitOptions,
): Promise<number> {
  const checks = how.checks ?? [];
  try {
    const wait = await waitForNamed(io.cwd ?? process.cwd(), paths, { ...options, checks });
    return printNamed(wait, how, io, options.now);
  } catch (error) {
    if (!(error instanceof CheckUsageError)) throw error;
    io.stderr(`squeal status: ${error.message}\n`);
    return 2;
  }
}

/**
 * Prints a named wait or snapshot (005 D2 as amended 2026-10-20, row
 * 011-28): the revision line, or with `--full` the worktree's status, then
 * the line naming the selected files and their failures in full, then last
 * the verdict on them (issue 26); with `--json` the naming and verdict lines
 * go to stderr and stdout is the snapshot plus a `selection` field
 * (`NamedWaitPayload`) in both forms (row 011-63, gh-65), and the same
 * payload under `wait`, or `named` for a snapshot, as before. Returns D1's
 * code for the selected files only: 0, 1 with known failures among them, 3
 * without a verdict, an unreadable store included.
 */
export function printNamed(
  wait: NamedWait,
  how: NamedPrint,
  io: CliIo,
  now: () => EpochMs,
): number {
  if (wait.outcome === "unavailable") {
    const { result } = wait;
    io.stdout(how.json ? `${JSON.stringify(result, null, 2)}\n` : formatStatus(result, now()));
    return 3;
  }
  if (wait.focus?.usage !== undefined) {
    io.stderr(`squeal status: ${wait.focus.usage}\n`);
    return 2;
  }
  const code = namedCode(wait);
  const command = statusCommand(io.env ?? process.env);
  if (!how.json) {
    io.stdout(namedText(wait, now(), command, how));
    return code;
  }
  const payload: NamedWaitPayload = {
    outcome: wait.snapshot === true ? "snapshot" : wait.outcome,
    waitedMs: Math.round(wait.waitedMs),
    code,
    testFiles: wait.files.map((f) => fileEntry(f, command, wait.selection.base)),
    unmatched: wait.selection.unmatched,
    leftForPause: wait.leftForPause ?? [],
    verdict: wait.verdict,
    ...(wait.focus === undefined ? {} : { focused: focusPayload(wait.focus) }),
  };
  const field = wait.snapshot === true ? "named" : "wait";
  const json = { ...wait.result, [field]: payload, selection: payload };
  io.stdout(`${JSON.stringify(json, null, 2)}\n`);
  const selected = selectedLine(wait);
  const refused = refusedLine(wait.focus);
  const lines = [
    ...(refused === null ? [] : [refused]),
    ...(selected === null ? [] : [selected]),
    ...focusLines(wait.focus, wait.selection.base),
    ...namedClassLines(wait, command),
  ];
  io.stderr(`${lines.map((line) => `${line}\n`).join("")}${namedLine(wait, command)}\n`);
  return code;
}
