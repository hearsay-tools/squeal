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
  EpochMs,
  StatusHold,
  StatusSnapshot,
  StatusUnavailable,
  TestFileRef,
} from "../core/types/index.js";
import type { CliIo } from "./main.js";
import { fileEntry, type NamedFileEntry } from "./named-file-lines.js";
import { type NamedFile, pauseOnlyIds, readNamedFiles } from "./named-files.js";
import { namedPathLines } from "./named-path-lines.js";
import {
  type NamedPath,
  type NamedSelection,
  selectNamedFiles,
  worktreePath,
} from "./named-selection.js";
import { statusCommand } from "./status-command.js";
import { type DaemonSync, pollPause, SYNC_POLL_MS, type SyncState } from "./status-sync.js";
import {
  type AskedEnd,
  type AskedPayload,
  type AskedRun,
  type AskFile,
  type AskNamed,
  askableFiles,
  askedEnds,
  askedLines,
  askedPayload,
  askNamedRuns,
  heldAsFiles,
  heldAsVerdict,
  takenSince,
  waitAsked,
} from "./status-wait-ask.js";
import {
  anyFailed,
  CheckUsageError,
  checkUsage,
  focusOf,
  focusOutcome,
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
  type PromoteNamed,
  promoteNamed,
} from "./status-wait-promote.js";
import { sessionOf } from "./store-writes.js";
import {
  type FileClasses,
  type FileVerdict,
  holdOfWait,
  type NoVerdictReason,
  readClasses,
  readVerdict,
  resultCode,
  type SelectionWord,
  selectionResult,
} from "./verdict.js";
import {
  type DaemonWatch,
  type DownReason,
  type HeartbeatLapse,
  stoppingOf,
  type WaitLiveness,
  watchDaemon,
} from "./wait-liveness.js";

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

/** Row 011-207: a read that found files to ask one run of, which the wait asks before its next read. */
interface AskRead {
  readonly ask: readonly AskFile[];
  readonly root: AbsolutePath;
}

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
      /** Row 011-206: the wait's last read found the heartbeat lapsed or a handoff under way. */
      readonly lapsed?: true;
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
      /** Row 011-207: the runs it asked, as its last read found them; absent when it asked none. */
      readonly asked?: readonly AskedEnd[];
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
  /** Row 011-206 (gh-88, gh-84): `code` as a word, from `namedResult`, as the text says it. */
  readonly result: SelectionWord;
  /** Row 011-206: with `none`, the one reason from the closed list (`NoVerdictReason`). */
  readonly reason?: NoVerdictReason;
  readonly testFiles: readonly NamedFileEntry[];
  readonly unmatched: readonly string[];
  /** Row 011-206 (gh-83): each named path with how it was read. */
  readonly paths: readonly NamedPath[];
  /** The selected slow files it did not hold for, waiting for a pause or `run --slow` (task 004-78). */
  readonly leftForPause: readonly TestFileRef[];
  readonly verdict: FileVerdict;
  /** Row 011-146: with `--check`, the focused answers (011 C15, additive). */
  readonly focused?: FocusedPayload;
  /** Row 011-207: the runs the wait asked (011 C15, additive); absent when it asked none. */
  readonly asked?: readonly AskedPayload[];
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
  /** Default `askNamedRuns`; tests replace it (row 011-207). */
  readonly ask?: AskNamed;
  /** The harness session its requests name (row 011-207); `""` when none. */
  readonly asker?: string;
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
 * current key or a result stored there. A file current before that gives
 * the named wait's verdict; an unknown or stale file that nothing queues
 * waits for its focused answer (review 0.1.286 B6). `focusOutcome` decides
 * it. A daemon that does not know the request leaves it a named wait.
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
  // Row 011-207 (C15): the runs it asked, decided once; the asked files to promote once queued.
  let asked: readonly AskedRun[] | undefined;
  const unpromoted = new Set<string>();
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
        // The files named by their own paths, read once the selection is decided: to promote, or to focus.
        const own =
          ready && (checks.length > 0 || !promoted)
            ? ownNamedFiles(root, cwd, paths, selection)
            : [];
        // Row 011-146 (C15): a source path selects no focus (review 0.1.286 B4).
        const usage = checkUsage(checks, ready, own);
        if (usage !== null) return usage;
        // Row 011-207 (C15): at the first decided read, one run of each named file nothing queues.
        if (ready && !final && asked === undefined) {
          const ask = checks.length === 0 ? askableFiles(store, id, own, readAt) : [];
          const toAsk: AskRead = { ask, root };
          if (ask.length > 0) return toAsk;
          asked = [];
        }
        const untaken = askedEnds(store, id, asked ?? [], false).filter((e) => e.untaken);
        // Row 011-207: a run it asked holds the wait as a pending file until the daemon queues it.
        const byClasses = ready ? decidedOutcome(selection, held, classes) : null;
        const named = byClasses === "settled" && untaken.length > 0 ? null : byClasses;
        if (checks.length > 0 && ready) whole ??= wholeFileReasons(root, own);
        const focus =
          whole === undefined ? undefined : focusOf(store, id, own, checks, whole, reply, record);
        // Row 011-146 (C15): with `--check`, the focused answers decide too.
        const decided = focusOutcome(named, focus, reply);
        // Row 011-73 (C6 as amended 2026-10-21): a held file queued on hold waits for its end.
        const hold =
          ready && decided === null
            ? holdOfWait(store, id, () => store.testFileKeys.list(id, held), readAt)
            : null;
        const outcome: NamedWaitOutcome | null =
          settled && daemon.state === "down"
            ? "no-daemon"
            : (decided ?? (hold !== null ? "on-hold" : final ? "timeout" : null));
        if (outcome === null) {
          // Spec 011 C15: once, at the first read whose selection is decided, beside it.
          if (ready && !promoted) {
            promoted = true;
            // On the clock the daemon adds it to, so the promotion lasts at least to `deadline`.
            (options.promote ?? promoteNamed)(root, own, deadline - options.now());
            for (const e of untaken) unpromoted.add(testFileId(e.testFile));
            const focusing = (focus?.files ?? []).filter((f) => f.whole === undefined);
            if (focus !== undefined && focusing.length > 0) {
              const send = options.focus ?? focusNamed;
              const files = focusing.map((f) => f.testFile);
              void send(root, files, focus.texts, deadline - options.now()).then((answer) => {
                reply = answer;
              });
            }
          } else {
            // Row 011-207: a promotion holds only files queued when it comes, so an asked one goes once queued.
            const taken = takenSince(unpromoted, asked ?? [], untaken);
            if (taken.length > 0)
              (options.promote ?? promoteNamed)(root, taken, deadline - options.now());
          }
          return null;
        }
        const verdict = heldAsVerdict(readVerdict(store, id, held), untaken);
        const result = buildSnapshot(store, root, options.now());
        // Row 011-63 (gh-51 3): a read at the deadline names what held each file as of
        // its last millisecond, while the promotion this wait sent still held it.
        const at = Math.min(options.now(), deadline - 1) as EpochMs;
        const standings = readNamedFiles(store, id, root, selection.files, result.daemon, at);
        const files = heldAsFiles(standings, untaken);
        const ends = waitAsked(askedEnds(store, id, asked ?? [], true));
        const lapse = watch.lapse();
        return {
          outcome,
          selection,
          leftForPause,
          verdict,
          files,
          result,
          sync: current,
          ...livenessOf(daemon),
          ...(lapse === null ? {} : { lapse }),
          ...(hold === null ? {} : { hold }),
          ...(focus === undefined ? {} : { focus }),
          ...(ends === undefined ? {} : { asked: ends }),
        };
      });
      if (read !== null && "usage" in read) throw new CheckUsageError(read.usage);
      if (read !== null && "ask" in read) {
        const ask = options.ask ?? askNamedRuns;
        const within = deadline - options.now();
        asked = await ask(read.root, read.ask, options.asker ?? "", within, options.now);
        continue;
      }
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
 * Why the wait found no daemon (task 004-66), or, row 011-206, that its
 * last read found the heartbeat lapsed or a handoff under way.
 */
function livenessOf(daemon: WaitLiveness): { readonly down?: DownReason; readonly lapsed?: true } {
  if (daemon.state === "down") return { down: daemon.reason };
  return daemon.state === "lapsed" ? { lapsed: true } : {};
}

/**
 * The selected test files named by their own paths, as the worktree names
 * them: the ones a wait promotes and focuses (spec 011 C15). A source path
 * selects the files whose closure holds it, which are not promoted.
 */
export function ownNamedFiles(
  root: AbsolutePath,
  cwd: AbsolutePath,
  paths: readonly string[],
  selection: NamedSelection,
): TestFileRef[] {
  const named = new Set(paths.map((p) => worktreePath(root, cwd, p)));
  return selection.files.filter((file) => named.has(file.path));
}

/**
 * Row 011-206 (011 C15): the selected files' result word and, without a
 * verdict, why, from `selectionResult`; the exit code, the JSON and the
 * verdict line read it. Row 011-63 (gh-59): a path that selects nothing
 * leaves no clean verdict, but a known failure among the files the others
 * select is still `fail`. Row 011-146 (C15): a focused answer is not the
 * file's verdict: `fail` when a selected check failed, else none.
 */
export function namedResult(wait: Extract<NamedWait, { result: StatusSnapshot }>) {
  const paths = wait.selection.paths ?? [];
  return selectionResult({
    outcome: wait.outcome,
    verdict: wait.verdict,
    sync: wait.sync,
    ...(wait.snapshot === true ? { snapshot: true } : {}),
    ...(wait.lapsed === true ? { lapsed: true } : {}),
    focusFailed: wait.focus !== undefined && anyFailed(wait.focus.files),
    unmatched: wait.selection.unmatched.length,
    notRun: paths.filter((p) => p.kind === "not-run").length,
  });
}

/** Spec 005 D1 for the selected files: `namedResult` as 0, 1 or 3. */
export function namedCode(wait: Extract<NamedWait, { result: StatusSnapshot }>): 0 | 1 | 3 {
  return resultCode(namedResult(wait));
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
  // Row 011-207: its requests name the session, as `retry`'s do.
  const asker = options.asker ?? sessionOf(io);
  const wait = waitForNamed(io.cwd ?? process.cwd(), paths, { ...options, checks, asker });
  return printNamed(wait, how, io, options.now);
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
 * without a verdict, an unreadable store included; 2 for a `CheckUsageError`
 * (row 011-146, C15).
 */
export async function printNamed(
  read: Promise<NamedWait>,
  how: NamedPrint,
  io: CliIo,
  now: () => EpochMs,
): Promise<number> {
  let wait: NamedWait;
  try {
    wait = await read;
  } catch (error) {
    if (!(error instanceof CheckUsageError)) throw error;
    io.stderr(`squeal status: ${error.message}\n`);
    return 2;
  }
  if (wait.outcome === "unavailable") {
    const { result } = wait;
    io.stdout(how.json ? `${JSON.stringify(result, null, 2)}\n` : formatStatus(result, now()));
    return 3;
  }
  const result = namedResult(wait);
  const code = resultCode(result);
  const command = statusCommand(io.env ?? process.env);
  if (!how.json) {
    io.stdout(namedText(wait, now(), command, how));
    return code;
  }
  const payload: NamedWaitPayload = {
    outcome: wait.snapshot === true ? "snapshot" : wait.outcome,
    waitedMs: Math.round(wait.waitedMs),
    code,
    result: result.result,
    ...(result.result === "none" ? { reason: result.reason } : {}),
    testFiles: wait.files.map((f) => fileEntry(f, command, wait.selection.base)),
    unmatched: wait.selection.unmatched,
    paths: wait.selection.paths ?? [],
    leftForPause: wait.leftForPause ?? [],
    verdict: wait.verdict,
    ...(wait.focus === undefined ? {} : { focused: focusPayload(wait.focus) }),
    ...(wait.asked === undefined ? {} : { asked: wait.asked.map(askedPayload) }),
  };
  const field = wait.snapshot === true ? "named" : "wait";
  const json = { ...wait.result, [field]: payload, selection: payload };
  io.stdout(`${JSON.stringify(json, null, 2)}\n`);
  const selected = selectedLine(wait);
  const refused = refusedLine(wait.focus);
  const lines = [
    ...(refused === null ? [] : [refused]),
    ...(selected === null ? [] : [selected]),
    ...namedPathLines(wait.selection),
    ...askedLines(wait.asked, command, wait.selection.base),
    ...focusLines(wait.focus, wait.selection.base),
    ...namedClassLines(wait, command),
  ];
  io.stderr(`${lines.map((line) => `${line}\n`).join("")}${namedLine(wait, command)}\n`);
  return code;
}
