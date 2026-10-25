import { isAbsolute, resolve } from "node:path";
import { toRelative, worktreeIdFor } from "../core/fs/index.js";
import {
  askNoResultRun,
  askRetry,
  cancelRetries,
  type HostLoad,
  hostLoad,
  loadAllows,
  loadText,
  outcomeText,
  RETRY_REASONS,
  type RetryReason,
  type RetryRecord,
  readRetries,
  retriesAt,
} from "../core/retry/index.js";
import { SUMMARY_MAX_CHARS } from "../core/state/index.js";
import { unknownReasons } from "../core/status/index.js";
import { cap } from "../core/text.js";
import type {
  AbsolutePath,
  EpochMs,
  KnownState,
  Store,
  TestFileKeyRecord,
  WorktreeId,
} from "../core/types/index.js";
import { worktreeRoot } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import { notKeyed } from "./retry-unlisted.js";
import {
  BUSY_BOUND_MS,
  type Busy,
  isBusyAnswer,
  openForWrites,
  sessionOf,
  tellDaemonRetries,
  whileBusy,
} from "./store-writes.js";

const USAGE =
  "usage: squeal retry <test file>... [--reason load|environment]\n       squeal retry --cancel <test file>...\n";

/**
 * What the command was asked: queue retries, with a reason or, for a file
 * with no result at its key, none (011 C5 as amended 2026-10-20, row
 * 011-27); or withdraw pending ones.
 */
type Parsed =
  | { readonly kind: "ask"; readonly reason: RetryReason | null; readonly paths: readonly string[] }
  | { readonly kind: "cancel"; readonly paths: readonly string[] };

/** One file's line, whether its request was taken, and, if not, whether no listed revision holds it yet (011-134). */
interface Answer {
  readonly ok: boolean;
  readonly text: string;
  readonly unlisted?: boolean;
}

const refuse = (text: string): Answer => ({ ok: false, text });

/** Hooks for a test: the host's load, and the busy store's bound. */
export interface RetryInternal {
  readonly hostLoad?: () => HostLoad;
  readonly busyBoundMs?: number;
}

/**
 * `squeal retry <file>... [--reason load|environment]` and `squeal retry
 * --cancel <file>...` (spec 001 D6 as amended, 001-368). Stores each request
 * in the shared store and tells the worktree's daemon, which claims and runs
 * it; with no daemon it waits there for the next daemon at the file's key.
 * Each file's line prints once it is answered. Exit code 0 when every file
 * was queued or withdrawn, 1 when any was refused or the store stayed busy
 * past the bound (row 011-212), else 3 when any is in a revision the daemon
 * has not listed yet (row 011-134, gh-76), 2 on a usage error.
 */
export async function retryCommand(
  args: readonly string[],
  io: CliIo,
  internal: RetryInternal = {},
): Promise<number> {
  const parsed = parse(args);
  if (typeof parsed === "string") {
    io.stderr(`squeal retry: ${parsed}\n${USAGE}`);
    return 2;
  }
  const root = worktreeRoot(undefined, io);
  if (root === null) return 1;
  const store = openForWrites(root);
  if (store === null) {
    io.stderr(`squeal retry: no Squeal store for ${root}; start a daemon with squeal start\n`);
    return 1;
  }
  const worktreeId = worktreeIdFor(root);
  const cwd = io.cwd ?? process.cwd();
  const load = (internal.hostLoad ?? hostLoad)();
  const deadline = Date.now() + (internal.busyBoundMs ?? BUSY_BOUND_MS);
  let refused = 0;
  let unlisted = 0;
  try {
    const keys = store.testFileKeys.list(worktreeId);
    for (const path of parsed.paths) {
      const rel = inWorktree(root, cwd, path);
      const row = rel === null ? undefined : keys.find((k) => k.testFile.path === rel);
      const shown = rel ?? path;
      const where = { root, worktreeId, shown, deadline };
      const answer: Answer =
        row === undefined || row.key === null
          ? { ok: false, ...notKeyed(store, { root, worktreeId, rel, shown, given: path }, keys) }
          : parsed.kind === "cancel"
            ? cancelLine(store, row, where)
            : askLine(store, row, where, parsed.reason, sessionOf(io), load);
      if (answer.unlisted === true) unlisted++;
      else if (!answer.ok) refused++;
      io.stdout(`${answer.text}\n`);
    }
  } finally {
    store.close();
  }
  if (refused + unlisted < parsed.paths.length) io.stdout(await tellDaemon(root));
  return refused > 0 ? 1 : unlisted > 0 ? 3 : 0;
}

function parse(args: readonly string[]): Parsed | string {
  let reason: string | null = null;
  let cancel = false;
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--cancel") cancel = true;
    else if (arg === "--reason") {
      reason = args[++i] ?? "";
    } else if (arg.startsWith("--reason=")) reason = arg.slice("--reason=".length);
    else if (arg.startsWith("--")) return `unknown option "${arg}"`;
    else paths.push(arg);
  }
  if (paths.length === 0) return "names no test file";
  if (cancel) {
    return reason === null ? { kind: "cancel", paths } : "--cancel takes no --reason";
  }
  if (reason === null) return { kind: "ask", reason: null, paths };
  if (!RETRY_REASONS.includes(reason as RetryReason)) {
    return `--reason must be load or environment, not "${reason}"`;
  }
  return { kind: "ask", reason: reason as RetryReason, paths };
}

/** `path` from `cwd`, relative to `root` with `/`; `null` when outside it (a root-level `..foo` is inside). */
function inWorktree(root: AbsolutePath, cwd: string, path: string): string | null {
  return toRelative(root, (isAbsolute(path) ? path : resolve(cwd, path)) as AbsolutePath);
}

/** The worktree a request is asked in, the file as the reply shows it, and when a busy store's bound ends. */
interface Where {
  readonly root: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly shown: string;
  readonly deadline: EpochMs;
}

/** A file's line when the store stayed busy past the bound, as 011-01 words a busy read. */
function busyLine(not: string, shown: string, { busyMs }: Busy): Answer {
  return refuse(
    `${not}: ${shown}: store busy, waited ${busyMs} ms: another process holds the store's lock; ` +
      "run the command again for this file once it is released.",
  );
}

function askLine(
  store: Store,
  row: TestFileKeyRecord,
  where: Where,
  reason: RetryReason | null,
  asker: string,
  load: HostLoad,
): Answer {
  const { worktreeId, shown, deadline } = where;
  const key = row.key as string;
  const states = store.knownStates.list(worktreeId);
  const own = states.filter(
    (s) =>
      s.check.kind !== "setup" &&
      s.check.project === row.testFile.project &&
      s.check.testPath === row.testFile.path,
  );
  // Only a current FAIL is a counted failure (011-15); a stale one has no result at these inputs.
  if (!own.some((s) => s.outcome === "fail" && s.validity === "current")) {
    // Its run starts at once whatever the reason; the record keeps one for older readers.
    const kept = reason ?? "environment";
    const ask = {
      testFile: row.testFile,
      key,
      session: asker,
      reason: kept,
      at: Date.now(),
      worktreeId,
    };
    const pending = row.pending !== null || own.some((s) => s.validity === "pending");
    if (pending)
      return {
        ok: true,
        text: `${shown} has a run queued or running at its inputs already, so nothing more is queued. ${waitText(shown)}`,
      };
    if (own.length > 0 && own.every((s) => s.validity === "current")) {
      return refuse(`Not retried: ${shown} has no known failure in this worktree.`);
    }
    const answer = whileBusy(store, deadline, () => askNoResultRun(store, ask));
    if (isBusyAnswer(answer)) return busyLine("Not queued", shown, answer);
    if (answer.kind === "joined") {
      return {
        ok: true,
        text: `${shown} has a run asked at its inputs already, pending, so nothing more is queued. ${waitText(shown)}`,
      };
    }
    const state = noResultText(store, row, own, where, states);
    const whatever = reason === null ? "" : ", whatever the reason";
    return {
      ok: true,
      text:
        `Run queued: ${shown} has no result at its inputs (${state}). It runs once now at its normal priority${whatever}; ` +
        `that is its one run at these inputs, and it spends no retry of this session. ${waitText(shown)}`,
    };
  }
  if (reason === null) {
    return refuse(
      `Not retried: ${shown} has a known failure at its inputs; a retry of it needs --reason load or --reason environment, the cause outside the code.`,
    );
  }
  const others = pendingOf(store, row).filter((r) => r.session !== asker);
  const answer = whileBusy(store, deadline, () =>
    askRetry(store, {
      testFile: row.testFile,
      key,
      session: asker,
      reason,
      at: Date.now(),
      worktreeId,
    }),
  );
  if (isBusyAnswer(answer)) return busyLine("Not retried", shown, answer);
  if (answer.kind === "spent") return refuse(spentLine(shown, answer.record));
  const when =
    reason === "environment"
      ? "runs once more now"
      : loadAllows(load)
        ? `runs once more now: the one-minute load average is below the CPU count (${loadText(load)})`
        : `runs once more when the one-minute load average falls below the CPU count, however long that takes (${loadText(load)} now)`;
  const joins = others.length > 0 ? " It joins a retry another session asked for." : "";
  return {
    ok: true,
    text:
      `Retry queued (reason: ${reason}): ${shown} ${when}.${joins} ` +
      "Its FAIL stays counted until a retry passes; squeal status lists the retry while it is pending.",
  };
}

/** The named wait that waits for `shown`'s run and moves it ahead in the queue (011 C15). */
function waitText(shown: string): string {
  return `squeal status --wait 60000 ${shown} waits for its result and moves it ahead in the queue.`;
}

/**
 * The state of a file with no result at its key (011 C5, gh-36): `stale`, its
 * last result at other inputs, or `unknown` with why, as status words it.
 */
function noResultText(
  store: Store,
  row: TestFileKeyRecord,
  own: readonly KnownState[],
  { root, worktreeId }: Where,
  states: readonly KnownState[],
): string {
  if (own.length > 0 && own.every((s) => s.validity !== "unknown")) {
    return "stale: its last result is at other inputs";
  }
  const why = unknownReasons(store, worktreeId, states, root, Date.now()).of(row, own).reason;
  // Its first line: a stack the reason carries stays in status (011-02).
  const line = why?.split("\n")[0]?.trim() || "no reason was kept";
  return `unknown: ${cap(line, SUMMARY_MAX_CHARS)}`;
}

function spentLine(shown: string, record: RetryRecord): string {
  const how = record.end === null ? "it is still pending" : `${outcomeText(record.end.outcome)}`;
  return `Not retried: ${shown} was already retried in this session at its current inputs (${record.reason}; ${how}). The failure stands.`;
}

function cancelLine(
  store: Store,
  row: TestFileKeyRecord,
  { worktreeId, shown, deadline }: Where,
): Answer {
  const withdrawn = whileBusy(store, deadline, () =>
    cancelRetries(store, row.testFile, row.key as string, worktreeId, Date.now()),
  );
  if (isBusyAnswer(withdrawn)) return busyLine("Not withdrawn", shown, withdrawn);
  if (withdrawn.length === 0) return refuse(`No pending retry of ${shown} at its current inputs.`);
  const count = withdrawn.length === 1 ? "1 request" : `${withdrawn.length} requests`;
  return { ok: true, text: `Retry withdrawn: ${shown} (${count}).` };
}

function pendingOf(store: Store, row: TestFileKeyRecord): RetryRecord[] {
  return retriesAt(readRetries(store), row.testFile, row.key as string).filter(
    (r) => r.end === null,
  );
}

/** Tells the worktree's daemon; a line when none listens. */
async function tellDaemon(root: AbsolutePath): Promise<string> {
  if (await tellDaemonRetries(root)) return "";
  return "No daemon took the request now; it waits in the store for the next daemon at this file's inputs (squeal start starts one).\n";
}
