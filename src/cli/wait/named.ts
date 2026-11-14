import { worktreeIdFor } from "../../core/fs/git-layout.js";
import { testFileId } from "../../core/keys/reverse-index.js";
import { daemonLiveness } from "../../core/presence/heartbeat.js";
import type { DownReason, WaitLiveness } from "../../core/presence/wait.js";
import { buildSnapshot } from "../../core/status/snapshot.js";
import { pauseOnlyIds, readNamedFiles } from "../../core/status/standing.js";
import type { AbsolutePath, EpochMs } from "../../core/types/common.js";
import type { TestFileRef } from "../../core/types/keys.js";
import {
  type NamedSelection,
  selectNamedFiles,
  sourcePaths,
  worktreePath,
} from "../named-selection.js";
import { type DaemonSync, SYNC_POLL_MS, type SyncState, syncedReaders } from "../status-sync.js";
import { heldAsFiles, heldAsVerdict, heldOutcome, WaitAsks } from "../status-wait-ask.js";
import { askNamedRuns } from "../status-wait-ask-store.js";
import {
  CheckUsageError,
  checkUsage,
  focusOf,
  focusOutcome,
  wholeFileReasons,
} from "../status-wait-focus.js";
import { leftGroupsOf } from "../status-wait-groups.js";
import { type FocusReply, focusNamed, promoteNamed } from "../status-wait-promote.js";
import { type FileClasses, holdOfWait, readClasses, readVerdict } from "../verdict.js";
import { type DaemonWatch, lockedOf } from "../wait-liveness.js";
import { decideStatusWait } from "./decide.js";
import type { NamedWaitEnded, NamedWaitOptions } from "./named-types.js";
import { judgeWait } from "./presence.js";
import { watchOf } from "./socket.js";
import { type Decided, STATUS_WAITS, type StatusRecord } from "./status-table.js";
import { fallbackOf, selectionReady } from "./synced.js";
import type { PollStep, StatusPoll } from "./wait.js";

/*
 * Row 011-331: the reads of the named wait (`status <path> --wait`), moved
 * from `status-wait-paths.ts` as they were; its row of `STATUS_WAITS`
 * decides each read, and `pollStatus` polls.
 */

const ROW = STATUS_WAITS.named;

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

/**
 * The named wait's poll (its contract is `waitForNamed`'s): each read in
 * the store's transaction as before the move; the row decides, and the hold
 * is read only when its chain reaches it. Asking runs and a usage error
 * are acts the loop runs after the read's transaction.
 */
export function namedPoll(
  cwd: AbsolutePath,
  paths: readonly string[],
  options: NamedWaitOptions,
): StatusPoll<NamedWaitEnded> {
  // The deadline on the store's clock, for the promotion's lifetime and the last read (row 011-63).
  const deadline = options.now() + options.timeoutMs;
  let sync: DaemonSync | undefined;
  let watch: DaemonWatch | undefined;
  let promoted = false;
  let reply: FocusReply | undefined;
  let whole: ReadonlyMap<string, string> | undefined;
  const checks = options.checks ?? [];
  // Row 011-207 (C15): the runs it asked; a focused wait asks none.
  const asks = new WaitAsks(checks.length === 0);
  const promote = options.promote ?? promoteNamed;
  const paused = new Set<string>();
  return {
    name: "named",
    sync: () => sync,
    read: ({ store, root, commonDir }, final, elapsed): PollStep<NamedWaitEnded> => {
      const id = worktreeIdFor(root);
      const pollMs = Math.min(options.pollMs, SYNC_POLL_MS);
      sync ??= options.sync(root, pollMs, sourcePaths(store, id, root, cwd, paths));
      // Row 011-234: one read of the sync in this transaction, for the selection and the verdict.
      const current = sync.current();
      const selection = selectNamedFiles(store, id, root, cwd, paths, syncedReaders(current));
      // Task 011-42: a poll reads the selected files' states only; the verdict, once it ends.
      const all = readClasses(store, id, selection.files);
      const settled = final || elapsed() >= options.settleMs;
      watch ??= watchOf(id, commonDir, options.downMs);
      const { view: daemon, worktree, at: readAt } = judgeWait(watch, store, id, options.now);
      const record = worktree?.daemon ?? null;
      const { ready, covered } = readiness(daemon, current, all, settled, checks.length > 0);
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
        ready && (checks.length > 0 || !promoted) ? ownNamedFiles(root, cwd, paths, selection) : [];
      // Row 011-146 (C15): a source path selects no focus (review 0.1.286 B4).
      const usage = checkUsage(checks, ready, own);
      if (usage !== null) {
        return {
          act: async () => {
            throw new CheckUsageError(usage.usage);
          },
        };
      }
      // Row 011-207 (C15): at the first decided read, one run of each named file nothing queues.
      if (ready && !final) {
        const toAsk = asks.toAsk(store, id, own, readAt);
        if (toAsk.length > 0) {
          return {
            act: async () => {
              const ask = options.ask ?? askNamedRuns;
              const within = deadline - options.now();
              asks.asked(await ask(root, toAsk, options.asker ?? "", within, options.now));
            },
          };
        }
      }
      const untaken = asks.untaken(store, id);
      const named = heldOutcome(ready ? decidedOutcome(selection, held, classes) : null, untaken);
      if (checks.length > 0 && ready) whole ??= wholeFileReasons(root, own);
      const focus =
        whole === undefined ? undefined : focusOf(store, id, own, checks, whole, reply, record);
      // Row 011-146 (C15): with `--check`, the focused answers decide too.
      const decided: Decided | null = focusOutcome(named, focus, reply);
      const read: StatusRecord = {
        store: "read",
        late: final,
        settled,
        daemon: daemon.state,
        decided,
      };
      let hold: ReturnType<typeof holdOfWait> = null;
      let step = decideStatusWait(ROW, read);
      if (step.kind === "read") {
        // Row 011-73 (C6 as amended 2026-10-21): a held file queued on hold waits for its end.
        hold =
          ready && decided === null
            ? holdOfWait(store, id, () => store.testFileKeys.list(id, held), readAt)
            : null;
        step = decideStatusWait(ROW, { ...read, hold });
      }
      if (step.kind !== "end") {
        // Spec 011 C15: once, at the first read whose selection is decided, beside it.
        if (ready && !promoted) {
          promoted = true;
          // On the clock the daemon adds it to, so the promotion lasts at least to `deadline`. The
          // daemon keeps it until then, so an asked file it queues later joins (row 011-283).
          promote(root, own, deadline - options.now());
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
      const verdict = heldAsVerdict(readVerdict(store, id, held), untaken);
      const result = buildSnapshot(store, root, options.now());
      // Row 011-63 (gh-51 3): a read at the deadline names what held each file as of
      // its last millisecond, while the promotion this wait sent still held it.
      const standingAt = Math.min(options.now(), deadline - 1) as EpochMs;
      const standings = readNamedFiles(store, id, root, selection.files, result.daemon, standingAt);
      const files = heldAsFiles(standings, untaken);
      const lapse = watch.lapse();
      const outcome = step.outcome as NamedWaitEnded["outcome"];
      return {
        end: {
          outcome,
          selection,
          leftForPause,
          ...leftGroupsOf(root, leftForPause),
          verdict,
          files,
          result,
          sync: current,
          ...livenessOf(daemon),
          ...(covered && outcome === "settled" ? { lapseCovered: true as const } : {}),
          ...(lapse === null ? {} : { lapse }),
          ...(hold === null ? {} : { hold }),
          ...(focus === undefined ? {} : { focus }),
          ...asks.ends(store, id),
        },
      };
    },
  };
}

/**
 * Whether a read decides the selection: the daemon alive, and its pass over
 * the edits made before the wait stored at the results' revision with that
 * revision listed, or, a daemon that cannot sync, the settle time (lessons
 * defect 30; `selectionReady`). A lapsed heartbeat decides nothing: the
 * daemon may be mid-run (004-66). Row 011-286 (gh-130 option A, the human
 * 2026-10-31): unless the wait's own pass is stored and every selected file
 * has a current result (`covered`), which then holds every edit made before
 * the wait. A socket that only accepts stores no pass. A `--check` wait is
 * left as it was: its focused answer needs a run.
 */
function readiness(
  daemon: WaitLiveness,
  current: SyncState,
  all: FileClasses,
  settled: boolean,
  focusing: boolean,
): { readonly ready: boolean; readonly covered: boolean } {
  const synced = current.state === "synced" && selectionReady(current, all, false);
  const covered =
    daemon.state === "lapsed" &&
    !focusing &&
    synced &&
    all.testFiles > 0 &&
    all.byClass.current === all.testFiles;
  if (daemon.state !== "alive") return { ready: covered, covered };
  const ready = selectionReady(current, all, fallbackOf(ROW, settled));
  return { ready, covered: false };
}

/**
 * Why the wait found no daemon (task 004-66), or, row 011-206, that its
 * last read found the heartbeat lapsed or a handoff under way; row 011-250,
 * or no record while a daemon held the worktree's lock.
 */
function livenessOf(daemon: WaitLiveness): {
  readonly down?: DownReason;
  readonly lapsed?: true;
  readonly locked?: true;
} {
  if (daemon.state === "down") return { down: daemon.reason };
  return daemon.state === "lapsed" ? { lapsed: true, ...lockedOf(daemon) } : {};
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
