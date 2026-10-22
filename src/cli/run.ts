import { setTimeout as sleep } from "node:timers/promises";
import { resolveCommonDir } from "../core/fs/index.js";
import { testFileId } from "../core/keys/index.js";
import { formatStatus, holdVerdictLine, readStatus } from "../core/status/index.js";
import { isStoreOpenFailure, openStore } from "../core/store/index.js";
import { plural } from "../core/text.js";
import {
  type AbsolutePath,
  type CheckpointProgress,
  type CheckpointRecord,
  checkpointMetaKey,
  parseCheckpointProgress,
  type RevisionNumber,
  type RunAllResponse,
  type StatusHold,
  type Store,
} from "../core/types/index.js";
import { askDaemon, daemonSocket, worktreeRoot } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import { LANE_FLAGS, laneFiles, laneText, runLanes } from "./run-lanes.js";
import { runSlowCommand } from "./run-slow.js";
import { statusCommand } from "./status-command.js";
import {
  type FileVerdict,
  failuresText,
  gapText,
  holdOfWait,
  noVerdictText,
  readClasses,
  readVerdict,
  verdictCode,
} from "./verdict.js";
import { takeWait } from "./wait-arg.js";

const USAGE =
  "usage: squeal run --all|--fast [--force] [--wait [<ms>]]\n       squeal run --slow [--wait <ms>]\n";
/** Without `--wait`, how long to wait for the scheduler to record the checkpoint. */
const RECORD_WAIT_MS = 10_000;
const POLL_MS = 100;
/** How often `--wait` reads the store (C6 as amended, task 011-42). */
const STORE_POLL_MS = 1_000;
/** Every this many polls, `--wait` asks whether the daemon is still there: every 5 s. */
const PING_POLLS = 5;

/** How a waited checkpoint ended for the CLI (spec 005 D1). */
type Outcome =
  | { readonly kind: "ended"; readonly verdict: FileVerdict }
  /** Row 011-73 (C6 as amended 2026-10-21): its files are queued while the worktree is on hold. */
  | { readonly kind: "on-hold"; readonly hold: StatusHold }
  | { readonly kind: "abandoned" | "stopped" }
  | { readonly kind: "moved"; readonly revision: RevisionNumber }
  | { readonly kind: "deadline"; readonly verdict: FileVerdict };

/** What a caller inside the CLI asks of `run --all` beyond its flags; no user flag sets it. */
export interface RunInternal {
  /** `squeal warmup`'s checkpoint records the ignored paths each file read (spec 005 D3, 001-307). */
  readonly observeIgnored?: boolean;
}

/**
 * `squeal run --all [--force] [--wait [<ms>]]`: an explicit checkpoint
 * (spec 001 D5), requested over the daemon socket. Prints the checkpoint once
 * the scheduler recorded it. Exit code 0 when requested, 1 when no daemon
 * runs, the request failed or was not recorded in time, 2 on a usage error.
 *
 * With `--wait`, waits until the checkpoint ends, or `<ms>` from the start,
 * and gives its verdict (spec 005 D1): the first line names it, then the
 * start line and status. Exit code 0 when it completed with every test file
 * current and no known failure at a revision the worktree is still at, 1
 * with known failures, 3 when Squeal has no verdict.
 */
export async function runCommand(
  args: readonly string[],
  io: CliIo,
  internal: RunInternal = {},
): Promise<number> {
  const flags = new Set(args);
  const lanes = runLanes(flags);
  if (lanes === "slow") return runSlowCommand(args, io, USAGE);
  const lane = lanes === "fast" ? lanes : null;
  const wait = takeAllWait(args);
  const unknown =
    typeof wait === "string"
      ? []
      : wait.rest.filter((a) => a !== "--force" && !LANE_FLAGS.includes(a));
  if (typeof wait === "string" || lanes === null || unknown.length > 0) {
    const problem =
      typeof wait === "string"
        ? wait
        : unknown.length > 0
          ? `unknown argument "${unknown[0]}"`
          : "--all, --fast or --slow is required";
    io.stderr(`squeal run: ${problem}\n${USAGE}`);
    return 2;
  }
  const root = worktreeRoot(undefined, io);
  if (root === null) return 1;
  const deadline = wait.waitMs === null ? null : Date.now() + wait.waitMs;
  const noVerdict = (text: string): number => {
    if (deadline === null) {
      io.stderr(`squeal: ${text}\n`);
      return 1;
    }
    io.stdout(`No verdict: ${text}\n`);
    return 3;
  };
  const socketPath = await daemonSocket(root);
  const response = await askDaemon(socketPath, {
    type: "run-all",
    force: flags.has("--force"),
    ...(internal.observeIgnored === true ? { observeIgnored: true } : {}),
    ...(lane === null ? {} : { lane }),
  });
  if (response === null) {
    return noVerdict(`no daemon running for ${root}; start one with squeal start`);
  }
  if (!response.ok || response.type !== "run-all") {
    return noVerdict(`run --all failed: ${response.ok ? "unexpected answer" : response.error}`);
  }
  const state = await recorded(socketPath, response, deadline ?? Date.now() + RECORD_WAIT_MS);
  if (typeof state === "string") return noVerdict(state);
  if (state === null) {
    const allows = "the daemon records the checkpoint once its current work allows";
    if (deadline !== null) {
      return noVerdict(
        `the deadline passed before request ${response.requestId} was recorded; ${allows}`,
      );
    }
    io.stdout(`Run requested (request ${response.requestId}); ${allows}\n`);
    return 1;
  }
  const { checkpoint } = state;
  const joined = joinedCheckpoint(root, checkpoint, state.owner);
  const named = `Checkpoint ${checkpoint.id}${laneText(checkpoint, lane)}`;
  const started = `${named} started at revision ${checkpoint.revision}: ${filesText(root, checkpoint)}${joinedText(joined)}\n`;
  if (deadline === null) {
    io.stdout(started);
    return 0;
  }
  const outcome = await ended(root, socketPath, checkpoint, deadline);
  const now = io.now ?? Date.now;
  const command = statusCommand(io.env ?? process.env);
  const [line, code] = verdictLine(root, checkpoint, outcome, joined, command);
  const status = readStatus(root, { now });
  // Task 001-403: an abandoned or incomplete checkpoint names the file it lacks and why.
  const gap = outcome.kind === "abandoned" || code === 3 ? gapText(status) : "";
  io.stdout(`${named} ${line}${gap}\n${started}\n`);
  io.stdout(formatStatus(status, now(), command));
  return code;
}

/**
 * `--wait` bare, `Infinity`, or with `<ms>` read as `run --slow --wait <ms>`
 * reads it (`takeWait`); `waitMs` is `null` without the flag.
 */
function takeAllWait(args: readonly string[]): ReturnType<typeof takeWait> {
  const at = args.indexOf("--wait");
  if (at === -1 || /^\d+$/.test(args[at + 1] ?? "")) return takeWait(args);
  return { waitMs: Number.POSITIVE_INFINITY, rest: args.filter((_, i) => i !== at) };
}

/**
 * The verdict line after `Checkpoint <id> `, and the exit code (spec 005 D1).
 * A request that joined a running checkpoint counts that one's work (review
 * wave-1, S2), or only the files when its record is gone.
 */
function verdictLine(
  root: AbsolutePath,
  checkpoint: CheckpointRecord,
  outcome: Outcome,
  joined: Joined | null,
  command: string,
): [string, 0 | 1 | 3] {
  const none = (why: string): [string, 3] => [`has no verdict: ${why}`, 3];
  switch (outcome.kind) {
    case "on-hold":
      return [
        `is queued and runs when the hold ends. ${holdVerdictLine(outcome.hold, command)}`,
        3,
      ];
    case "abandoned":
      return none(
        "it was abandoned before every test file had a result (a newer request replaced it, a test file's inputs never held still, a tier crashed or timed out, or the daemon stopped)",
      );
    case "stopped":
      return none(`the daemon stopped before it ended${owedText(root, checkpoint)}`);
    case "moved":
      return none(
        `revision ${outcome.revision} was recorded after the checkpoint's revision ${checkpoint.revision}`,
      );
    case "deadline": {
      const pending = plural(outcome.verdict.byClass.pending, "test file");
      return none(
        `the deadline passed with ${pending} pending at revision ${checkpoint.revision}; the checkpoint goes on in the daemon`,
      );
    }
    case "ended": {
      const { verdict } = outcome;
      const why = noVerdictText(verdict);
      if (why !== null) return none(why);
      const files = plural(verdict.testFiles, "test file");
      const owner = joined === null ? checkpoint : joined.record;
      const ran = owner === null ? 0 : Math.min(owner.testFiles.length, verdict.testFiles);
      const by =
        joined === null ? "run now" : `run by the ${joined.what} checkpoint ${joined.id} it joined`;
      const counts =
        owner === null
          ? files
          : `${files}, ${verdict.testFiles - ran} already current, ${ran} ${by}`;
      return [
        `completed at revision ${verdict.revision}: ${failuresText(verdict.failures)}; ${counts}`,
        verdictCode(verdict),
      ];
    }
  }
}

/** Polls the daemon until the scheduler recorded the request's checkpoint; `null` past `deadline`, a string when it failed. */
async function recorded(
  socketPath: AbsolutePath,
  first: RunAllResponse,
  deadline: number,
): Promise<Recorded | string | null> {
  let state: RunAllResponse = first;
  for (;;) {
    if (state.checkpoint !== null) return { checkpoint: state.checkpoint, owner: state.owner };
    if (state.error !== null) return `run --all failed: ${state.error}`;
    if (Date.now() > deadline) return null;
    await sleep(POLL_MS);
    const next = await askDaemon(socketPath, {
      type: "run-all-status",
      requestId: first.requestId,
    });
    if (next === null || !next.ok || next.type !== "run-all") {
      return "the daemon stopped before recording the checkpoint";
    }
    state = next;
  }
}

/**
 * Spec 005 D1: `N test files to run, M already current`, never queued work
 * alone; the second count only when the store says it.
 */
function filesText(root: AbsolutePath, checkpoint: CheckpointRecord): string {
  const toRun = plural(checkpoint.testFiles.length, "test file");
  const current = inStore(root, (store) => {
    const requested = new Set(checkpoint.testFiles.map(testFileId));
    const listed =
      laneFiles(store, checkpoint) ??
      store.testFileKeys.list(checkpoint.worktreeId).map((row) => row.testFile);
    const rest = listed.filter((file) => !requested.has(testFileId(file)));
    return readClasses(store, checkpoint.worktreeId, rest).byClass.current;
  });
  return `${toRun} to run${current === null ? "" : `, ${current} already current`}`;
}

/** Task 001-219: a checkpoint the stopped daemon owes resumes in the next one. */
function owedText(root: AbsolutePath, checkpoint: CheckpointRecord): string {
  const owed = inStore(root, (store) => openCheckpoint(store, checkpoint)?.owed?.ids ?? []);
  return owed?.includes(checkpoint.id) === true
    ? "; the next daemon resumes it, and `run --all --wait` then waits for it"
    : "";
}

/** A `run-all` answer once the checkpoint was recorded. */
interface Recorded {
  readonly checkpoint: CheckpointRecord;
  /** `RunAllResponse.owner`: absent from a daemon before 005-36. */
  readonly owner: string | undefined;
}

/** The running checkpoint a request joined, as it stood when the request was recorded. */
interface Joined {
  readonly id: string;
  /** What it had done; `null` when it had ended, with the request, before `run --all` read it. */
  readonly open: CheckpointProgress | null;
  /** Its record, `null` when the store holds none. */
  readonly record: CheckpointRecord | null;
  readonly what: "baseline" | "`run --all`";
}

/**
 * Task 001-217: the checkpoint the request joined, the `owner` the daemon
 * named when it is not the request's own; `null` when it is, or when an
 * older daemon named none: a join is never guessed (review wave-3, B4). A
 * join that ended before this read left no open checkpoint (review
 * wave-1.5, S2).
 */
function joinedCheckpoint(
  root: AbsolutePath,
  checkpoint: CheckpointRecord,
  owner: string | undefined,
): Joined | null {
  if (owner === undefined || owner === checkpoint.id) return null;
  return inStore(root, (store): Joined => {
    const record = store.checkpoints.get(owner);
    const open = openCheckpoint(store, checkpoint);
    return {
      id: owner,
      open: open?.id === owner ? open : null,
      record,
      what: record?.kind === "baseline" ? "baseline" : "`run --all`",
    };
  });
}

/** Task 001-217: says the request joined, and what that one has done. */
function joinedText(joined: Joined | null): string {
  if (joined === null) return "";
  const { id, open, what } = joined;
  if (open === null) {
    return `, joining the ${what} checkpoint ${id} already running them; both had ended when this command read them`;
  }
  return `, joining the ${what} checkpoint ${id} already running them (${open.done} of ${open.total} test files done); it ends when that one ends`;
}

/** The worktree's open checkpoint as the store holds it (`checkpointMetaKey`). */
function openCheckpoint(store: Store, checkpoint: CheckpointRecord): CheckpointProgress | null {
  return parseCheckpointProgress(store.meta.get(checkpointMetaKey(checkpoint.worktreeId)));
}

/** `read` over the worktree's store, or `null` when it cannot be opened. */
function inStore<T>(root: AbsolutePath, read: (store: Store) => T): T | null {
  const commonDir = resolveCommonDir(root);
  if (commonDir === null) return null;
  const store = openStore(commonDir, { create: false, busyTimeoutMs: 1_000 });
  if (isStoreOpenFailure(store)) return null;
  try {
    return read(store);
  } finally {
    store.close();
  }
}

/**
 * Polls the store once a second until the checkpoint ended and none of the
 * worktree's test files is pending (a new failure's re-run, spec 001 D6 as
 * amended), a newer revision was recorded, `deadline` passed, or the daemon
 * went away. A poll reads the checkpoint's end and the latest revision, and
 * the verdict only once the checkpoint ended or at the deadline (C6 as
 * amended, task 011-42).
 */
async function ended(
  root: AbsolutePath,
  socketPath: AbsolutePath,
  checkpoint: CheckpointRecord,
  deadline: number,
): Promise<Outcome> {
  for (let polls = 0; ; polls++) {
    const seen = inStore(root, (store) => pollCheckpoint(store, checkpoint, deadline));
    if (seen === null) return { kind: "stopped" };
    if (seen !== "open") return seen;
    // A killed daemon never ends its checkpoint; check that it is still there now and then.
    if (
      polls % PING_POLLS === PING_POLLS - 1 &&
      (await askDaemon(socketPath, { type: "ping" })) === null
    ) {
      return { kind: "stopped" };
    }
    await sleep(Math.max(0, Math.min(STORE_POLL_MS, deadline - Date.now())));
  }
}

/**
 * One poll of `ended`: the outcome, or `open` while the checkpoint runs, or
 * it completed with a test file still pending, before `deadline`.
 */
function pollCheckpoint(
  store: Store,
  checkpoint: CheckpointRecord,
  deadline: number,
): Outcome | "open" {
  const end = store.checkpoints.get(checkpoint.id)?.end ?? null;
  const revision = store.revisions.latest(checkpoint.worktreeId)?.number ?? 0;
  if (revision > checkpoint.revision) return { kind: "moved", revision };
  if (end === "abandoned") return { kind: "abandoned" };
  const late = Date.now() >= deadline;
  if (end !== "completed" && !late) {
    // Row 011-73 (C6 as amended 2026-10-21): no tier starts on hold, so the wait returns with it.
    const id = checkpoint.worktreeId;
    const files = laneFiles(store, checkpoint) ?? undefined;
    const hold = holdOfWait(store, id, () => store.testFileKeys.list(id, files), Date.now());
    return hold === null ? "open" : { kind: "on-hold", hold };
  }
  const verdict = readVerdict(store, checkpoint.worktreeId, laneFiles(store, checkpoint));
  const settled = verdict.byClass.pending === 0 && !verdict.unlisted;
  if (end === "completed" && settled) return { kind: "ended", verdict };
  return late ? { kind: "deadline", verdict } : "open";
}
