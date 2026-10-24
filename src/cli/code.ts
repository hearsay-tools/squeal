import { relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { functionName } from "../core/delivery/code-format.js";
import type { ShellSession } from "../core/delivery/code-since.js";
import { codeSource, withCode } from "../core/delivery/code-source.js";
import { daemonLiveness } from "../core/delivery/index.js";
import { worktreeIdFor } from "../core/fs/index.js";
import { CLI_READ_RETRY_MS, type StatusContext, withStatusStore } from "../core/status/index.js";
import { plural } from "../core/text.js";
import type { DecisionKind } from "../core/types/code.js";
import type {
  AbsolutePath,
  EpochMs,
  RelativePath,
  StatusUnavailable,
} from "../core/types/index.js";
import { coverageLines, coverageWords } from "./code-coverage.js";
import { type CodeReport, type CodeReportFile, readCodeReport } from "./code-report.js";
import type { CliIo } from "./main.js";
import { type DaemonSync, SYNC_POLL_MS, syncDaemon } from "./status-sync.js";
import { STATUS_WAIT_SETTLE_MS, waitConsumer } from "./status-wait.js";

/*
 * Spec 015 D6: `squeal code [<path>...] [--changed | --told] [--json]`, the details
 * a delivery and status only count. Exit 0 with an answer, 1 when the
 * stores cannot answer (complexity off, no code store yet, status
 * unavailable), 2 on a usage error.
 */

export const CODE_USAGE = "squeal code [<path>...] [--changed | --told] [--json]";

const OPTIONS = ["--json", "--changed", "--told"];

/** How often `squeal code` reads the code store while it waits for the pass over a pending file. */
export const CODE_POLL_MS = 50;

export interface CodeCommandOptions {
  /** Default `STATUS_WAIT_SETTLE_MS`: the longest it waits for the pass over a pending file. */
  readonly settleMs?: number;
  /** Default `CODE_POLL_MS`. */
  readonly pollMs?: number;
  /** Clock for the daemon's heartbeat age. Default `Date.now`. */
  readonly now?: () => EpochMs;
  /** Default `syncDaemon`; tests replace it. */
  readonly sync?: (root: AbsolutePath, pollMs: number) => DaemonSync;
}

/** Why the code store gave no answer, as a line. */
type NoAnswer = { readonly message: string };

/** A report, and the root of the live daemon whose pass may still count its pending files. */
type Answer = { readonly report: CodeReport; readonly live: AbsolutePath | null };

const hasPending = (report: CodeReport) => report.files.some((f) => f.reason === "pending");

/** `if 12, logical 6`: the decision points by kind, most first. */
function decisionsText(decisions: Readonly<Partial<Record<DecisionKind, number>>>): string {
  return Object.entries(decisions)
    .sort(([a, x = 0], [b, y = 0]) => y - x || a.localeCompare(b))
    .map(([kind, n]) => `${kind} ${n}`)
    .join(", ");
}

const kib = (bytes: number) => `${Math.round(bytes / 1024)} KiB`;

function fileLine(f: CodeReportFile, limit: number): string {
  switch (f.reason) {
    case "too-big":
      return `  ${f.path}: ${kib(f.size)}, over the ${kib(limit)} limit; its functions are not counted`;
    case "parse-error":
      return `  ${f.path}: does not parse; ${plural(f.unknown ?? 0, "function")} in its errors not judged`;
    case "not-counted":
      return `  ${f.path}: not counted yet`;
    case "pending":
      return `  ${f.path}: pending: changed since revision ${f.revision}, not counted yet`;
    case "could-not-count":
      return `  ${f.path}: unknown: could not count (${f.error})`;
  }
}

/** Without paths, what the functions listed are: over, changed, or over and told (row 015-27). */
function whatListed({ threshold, changedSince, told }: CodeReport): string {
  if (changedSince !== undefined) return "changed";
  if (told === undefined) return `over ${threshold}`;
  const who = told?.scope === "worktree" ? "a session in this worktree was" : "this session was";
  return `over ${threshold} that ${who} told about`;
}

/** The line after the head on whose registration or views the list is of. */
function scopeLines({ changedSince: changed, told }: CodeReport): string[] {
  if (changed === null) {
    return ["No session is registered in this worktree, so nothing changed since one started."];
  }
  if (changed !== undefined) {
    return [
      `Changed since revision ${changed.revision}, ${changed.scope === "session" ? "when this session registered" : "the oldest registration in this worktree"}.`,
    ];
  }
  if (told === null) return ["No session is registered in this worktree, so none was told."];
  return told?.scope === "worktree"
    ? ["This shell's session is not registered here, so these are told to any session that is."]
    : [];
}

/** The human rendering of a report. */
export function formatCodeReport(report: CodeReport): string {
  const { threshold } = report;
  const head =
    report.paths === null
      ? `Complexity: ${plural(report.functions.length, "function")} ${whatListed(report)}`
      : `Complexity: ${plural(report.functions.length, "function")} in ${report.paths.join(", ") || "."}, threshold ${threshold}`;
  const since = scopeLines(report);
  const lines = report.functions.map((f) => {
    const where = f.line === null ? f.path : `${f.path}:${f.line}`;
    const decisions = decisionsText(f.decisions);
    const cc =
      f.complexity === null
        ? "not counted"
        : `CC ${f.complexity}${decisions === "" ? "" : ` (${decisions})`}`;
    const state =
      f.outcome === "fail"
        ? `over since revision ${f.changedAt}`
        : f.outcome === "pass"
          ? "at or under"
          : f.outcome;
    return `  ${where}  ${functionName({ ...f, kind: "code" })}  ${cc}, ${state}${coverageWords(f.coverage)}`;
  });
  // Spec 015 D9 (row 015-12): CRAP and the functions no in-process test reaches.
  const coverage = coverageLines(report.coverage, report.changedSince !== undefined, "squeal");
  const files =
    report.files.length === 0
      ? []
      : ["Not judged:", ...report.files.map((f) => fileLine(f, report.maxFileBytes))];
  return `${[head, ...since, ...lines, ...coverage, ...files].join("\n")}\n`;
}

/** What one `squeal code` asks of the stores. */
interface Request {
  readonly cwd: AbsolutePath;
  readonly positional: readonly string[];
  readonly changed: boolean;
  readonly told: boolean;
  readonly shell: ShellSession | null;
  readonly now: () => EpochMs;
}

/** One read of the stores: the report, and whether a daemon validates, or why there is none. */
function answer({ store, root, commonDir }: StatusContext, request: Request): Answer | NoAnswer {
  const { cwd, positional } = request;
  const paths: RelativePath[] | null =
    positional.length === 0 ? null : positional.map((p) => relative(root, resolve(cwd, p)));
  const outside = paths?.find((p) => p.startsWith(".."));
  if (outside !== undefined) return { message: `"${outside}" is outside the worktree ${root}` };
  const id = worktreeIdFor(root);
  const source = codeSource(commonDir, root);
  const report = withCode(source, ({ store: code, complexity }) =>
    code.read(() =>
      readCodeReport(store, code, id, complexity, {
        paths,
        changed: request.changed,
        told: request.told,
        shell: request.shell,
        root,
      }),
    ),
  );
  if (report === null) {
    return source.policy() === null
      ? { message: "Complexity is off: complexity.enabled is not true in squeal.config.json." }
      : { message: "The code store cannot be read." };
  }
  if (report === "missing") {
    return { message: "Complexity: no file counted yet; the daemon counts once it runs." };
  }
  const daemon = store.worktrees.get(id)?.daemon ?? null;
  return { report, live: daemonLiveness(daemon, request.now()).state === "alive" ? root : null };
}

/**
 * `squeal code`. Row 015-22 (lessons, P4): with paths, a file edited since
 * its count is `pending`. While a daemon validates, it is asked to sync, as
 * `squeal status <path>` asks (011-28), and the code store is read again
 * until the pass counted every pending file or `settleMs` passed; without
 * one no pass comes, so it answers at once, and synchronously.
 */
export function codeCommand(
  args: readonly string[],
  io: CliIo,
  options: CodeCommandOptions = {},
): number | Promise<number> {
  const json = args.includes("--json");
  const changed = args.includes("--changed");
  const told = args.includes("--told");
  const unknown = args.find((a) => a.startsWith("--") && !OPTIONS.includes(a));
  if (unknown !== undefined) {
    io.stderr(`squeal code: unknown option "${unknown}"\n\nUsage: ${CODE_USAGE}\n`);
    return 2;
  }
  if (changed && told) {
    io.stderr(`squeal code: --changed and --told do not combine\n\nUsage: ${CODE_USAGE}\n`);
    return 2;
  }
  const positional = args.filter((a) => !a.startsWith("--"));
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  const request: Request = {
    cwd,
    positional,
    changed,
    told,
    shell: waitConsumer(env),
    now: options.now ?? Date.now,
  };
  const read = () =>
    withStatusStore(cwd, { busyRetryMs: CLI_READ_RETRY_MS }, (context) => answer(context, request));
  const first = read();
  if (!("report" in first) || first.live === null || !hasPending(first.report)) {
    return print(first, json, io);
  }
  return waitForPass(first.live, read, options).then((last) => print(last, json, io));
}

/** Reads again until no file is pending, or `settleMs` passed since the first read. */
async function waitForPass<T extends Answer | NoAnswer | StatusUnavailable>(
  root: AbsolutePath,
  read: () => T,
  options: CodeCommandOptions,
): Promise<T> {
  const started = performance.now();
  const settleMs = options.settleMs ?? STATUS_WAIT_SETTLE_MS;
  const pollMs = options.pollMs ?? CODE_POLL_MS;
  // The daemon stores the edit's revision now, not after its watcher's quiet; the pass follows it.
  const sync = (options.sync ?? syncDaemon)(root, SYNC_POLL_MS);
  try {
    for (;;) {
      const left = settleMs - (performance.now() - started);
      await sleep(Math.max(0, Math.min(pollMs, left)));
      const next = read();
      if (!("report" in next) || !hasPending(next.report) || left <= pollMs) return next;
    }
  } finally {
    sync.stop();
  }
}

/** Prints a report, or why there is none. */
function print(read: Answer | NoAnswer | StatusUnavailable, json: boolean, io: CliIo): number {
  if (!("report" in read)) {
    const answer = "available" in read ? read : { v: 1, available: false, message: read.message };
    io.stdout(json ? `${JSON.stringify(answer, null, 2)}\n` : `${read.message}\n`);
    return 1;
  }
  io.stdout(json ? `${JSON.stringify(read.report, null, 2)}\n` : formatCodeReport(read.report));
  return 0;
}
