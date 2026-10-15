import { isAbsolute, relative, resolve, sep } from "node:path";
import { resolveCommonDir, worktreeIdFor } from "../core/fs/index.js";
import {
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
import { isStoreOpenFailure, openStore } from "../core/store/index.js";
import type { AbsolutePath, Store, TestFileKeyRecord, WorktreeId } from "../core/types/index.js";
import { askDaemon, CLI_SOCKET_TIMEOUT_MS, daemonSocket, worktreeRoot } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import { waitConsumer } from "./status-wait.js";

const USAGE =
  "usage: squeal retry <test file>... --reason load|environment\n       squeal retry --cancel <test file>...\n";

/** What the command was asked: queue retries with a reason, or withdraw pending ones. */
type Parsed =
  | { readonly kind: "ask"; readonly reason: RetryReason; readonly paths: readonly string[] }
  | { readonly kind: "cancel"; readonly paths: readonly string[] };

/** One file's line, and whether its request was taken. */
interface Answer {
  readonly ok: boolean;
  readonly text: string;
}

const refuse = (text: string): Answer => ({ ok: false, text });

/** Hooks for a test: the host's load. */
export interface RetryInternal {
  readonly hostLoad?: () => HostLoad;
}

/**
 * `squeal retry <file>... --reason load|environment` and `squeal retry
 * --cancel <file>...` (spec 001 D6 as amended, 001-368). Stores each request
 * in the shared store and tells the worktree's daemon, which claims and runs
 * it; with no daemon it waits there for the next daemon at the file's key.
 * Exit code 0 when every file was queued or withdrawn, 1 when any was not,
 * 2 on a usage error.
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
  const commonDir = resolveCommonDir(root);
  const store =
    commonDir === null
      ? null
      : openStore(commonDir, { create: false, busyTimeoutMs: CLI_SOCKET_TIMEOUT_MS });
  if (store === null || isStoreOpenFailure(store)) {
    io.stderr(`squeal retry: no Squeal store for ${root}; start a daemon with squeal start\n`);
    return 1;
  }
  const worktreeId = worktreeIdFor(root);
  const cwd = io.cwd ?? process.cwd();
  const load = (internal.hostLoad ?? hostLoad)();
  let refused = 0;
  const lines: string[] = [];
  try {
    const keys = store.testFileKeys.list(worktreeId);
    for (const path of parsed.paths) {
      const rel = inWorktree(root, cwd, path);
      const row = rel === null ? undefined : keys.find((k) => k.testFile.path === rel);
      const shown = rel ?? path;
      const answer: Answer =
        row === undefined || row.key === null
          ? refuse(notKeyed(store, worktreeId, rel, shown))
          : parsed.kind === "cancel"
            ? cancelLine(store, row, worktreeId, shown)
            : askLine(store, row, worktreeId, shown, parsed.reason, session(io), load);
      if (!answer.ok) refused++;
      lines.push(answer.text);
    }
  } finally {
    store.close();
  }
  io.stdout(`${lines.join("\n")}\n`);
  if (refused < parsed.paths.length) io.stdout(await tellDaemon(root));
  return refused === 0 ? 0 : 1;
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
  if (reason === null) return "--reason load or --reason environment is required";
  if (!RETRY_REASONS.includes(reason as RetryReason)) {
    return `--reason must be load or environment, not "${reason}"`;
  }
  return { kind: "ask", reason: reason as RetryReason, paths };
}

/** `path` from `cwd`, relative to `root` with `/`; `null` when outside it. */
function inWorktree(root: AbsolutePath, cwd: string, path: string): string | null {
  const rel = relative(root, isAbsolute(path) ? path : resolve(cwd, path));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/** The harness session the shell runs in; `""` when it names none. */
function session(io: CliIo): string {
  const env = io.env ?? process.env;
  const pi = env.PI_SESSION_ID === "" ? undefined : env.PI_SESSION_ID;
  return waitConsumer(env).session ?? pi ?? "";
}

function askLine(
  store: Store,
  row: TestFileKeyRecord,
  worktreeId: WorktreeId,
  shown: string,
  reason: RetryReason,
  asker: string,
  load: HostLoad,
): Answer {
  const key = row.key as string;
  const failing = store.knownStates
    .list(worktreeId)
    .some(
      (s) =>
        s.outcome === "fail" &&
        s.check.kind !== "setup" &&
        s.check.project === row.testFile.project &&
        s.check.testPath === row.testFile.path,
    );
  if (!failing) return refuse(`Not retried: ${shown} has no known failure in this worktree.`);
  const others = pendingOf(store, row).filter((r) => r.session !== asker);
  const answer = askRetry(store, {
    testFile: row.testFile,
    key,
    session: asker,
    reason,
    at: Date.now(),
    worktreeId,
  });
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

/**
 * Why `shown` has no keyed test file. A failed global setup (001-382) has no
 * key: the next run of its project clears it, which an edit or `run --all`
 * starts.
 */
function notKeyed(store: Store, worktreeId: WorktreeId, rel: string | null, shown: string): string {
  const setup = store.knownStates
    .list(worktreeId)
    .some((s) => s.check.kind === "setup" && s.outcome === "fail" && s.check.testPath === rel);
  return setup
    ? `Not retried: ${shown} is a global setup, which has no inputs to retry at; its FAIL clears when a run of its project starts, as the next edit or squeal run --all does.`
    : `Not retried: ${shown} is not a test file Squeal has keyed in this worktree.`;
}

function spentLine(shown: string, record: RetryRecord): string {
  const how = record.end === null ? "it is still pending" : `${outcomeText(record.end.outcome)}`;
  return `Not retried: ${shown} was already retried in this session at its current inputs (${record.reason}; ${how}). The failure stands.`;
}

function cancelLine(
  store: Store,
  row: TestFileKeyRecord,
  worktreeId: WorktreeId,
  shown: string,
): Answer {
  const withdrawn = cancelRetries(store, row.testFile, row.key as string, worktreeId, Date.now());
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
  const response = await askDaemon(await daemonSocket(root), { type: "retry" }).catch(() => null);
  if (response?.ok === true && response.type === "retry") return "";
  return "No daemon took the request now; it waits in the store for the next daemon at this file's inputs (squeal start starts one).\n";
}
