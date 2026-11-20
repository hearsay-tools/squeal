import { FILE_ERROR } from "../core/code/gate/evidence.js";
import type { KeyAt } from "../core/commit/at-keys-checkout.js";
import type { Changed } from "../core/commit/at-keys-walk.js";
import { compare } from "../core/fs/compare.js";
import type { CommitSha, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import { importIdOf } from "../core/types/state.js";
import type { ResultRecord } from "../core/types/store-records.js";
import { type AtNext, nextLine } from "./status-at-next.js";
import { fileLines, isNew, newFileLines, proofCommand } from "./status-at-report-files.js";
import { type RunUse, runLines } from "./status-at-report-run.js";

export type { RunUse };

/*
 * Spec 023 D1 and D3 (row 023-06): one test file's state at a commit and
 * now, the comparison of the two, and the report in text and JSON.
 */

/** Where a stored result came from (D3: local run, import from CI, or this command's run). */
export interface Origin {
  /**
   * `ci`: CI's export for the commit (row 023-17); `import`: a `squeal
   * import`; `own`: this worktree; `worktree`: another one; `run`: this
   * command's `--run`, in its checkout (row 023-07).
   */
  readonly kind: "ci" | "import" | "own" | "worktree" | "run";
  /** The worktree that stored it; `null` for `ci` and `run`. */
  readonly worktreeId: WorktreeId | null;
  /** The commit its run recorded. */
  readonly commit: CommitSha;
  /** With `run`: the shared store holds the result at the file's key (review wave-7 B7). */
  readonly stored?: boolean;
  /**
   * Row 023-18 (D2): with `run` and `stored: false`, why: the gate's own
   * reason for not keeping it, or coverage off at the commit.
   */
  readonly notStored?: string;
}

/** One side of one test file (D3). */
export type SideState =
  | { readonly state: "pass"; readonly key: string; readonly origin: Origin }
  | {
      readonly state: "fail";
      readonly key: string;
      readonly origin: Origin;
      /** The failed tests' names, sorted; `(file-level error)` for the file's own. */
      readonly failed: readonly string[];
    }
  | {
      readonly state: "no result";
      readonly key: string;
      /** The daemon's run for the key is queued or running. */
      readonly pending?: "queued" | "running";
      /** Row 023-29 (R8): with `--run`, at the commit: the change did not select it, so it did not run. */
      readonly notSelected?: true;
    }
  | { readonly state: "absent" }
  | { readonly state: "not determined"; readonly reason: string }
  /** Row 023-07, D4.6: `--run` selected it and did not start it, for want of budget or of its `prepare`. */
  | { readonly state: "not run"; readonly reason: "budget" | "prepare" }
  /**
   * Row 023-07, D4.9: its closure at the commit reads a path git does not
   * hold there; or ("Whole-checkout check") the install changed the
   * checkout, so its key is not the commit's. `ran`: `--run` ran it there
   * with this outcome, and stored nothing.
   */
  | {
      readonly state: "not comparable";
      readonly reason: string;
      readonly ran?: "pass" | "fail";
      readonly failed?: readonly string[];
    };

/** D3's comparison. */
export type Change = "pass -> fail" | "fail -> pass" | "unchanged" | "unknown";

export interface FileReport {
  readonly ref: TestFileRef;
  readonly at: SideState;
  readonly now: SideState;
  readonly change: Change;
}

/** A record as row 023-17 may mark it: `origin: "ci"` for one built from CI's export. */
type Marked = ResultRecord & { readonly origin?: string };

/** The state the results at `key` give: fail when one failed, else pass; `no result` when none. */
export function stateOf(key: string, records: readonly ResultRecord[], own: WorktreeId): SideState {
  if (records.length === 0) return { state: "no result", key };
  const newest = records.reduce((a, b) =>
    b.provenance.recordedAt > a.provenance.recordedAt ? b : a,
  );
  const origin = originOf(newest, own);
  const failed = records.filter((r) => r.outcome === "fail");
  if (failed.length === 0) return { state: "pass", key, origin };
  const names = new Set(
    failed.map((r) => (r.check.kind === "test" ? r.check.fullName : FILE_ERROR)),
  );
  return { state: "fail", key, origin, failed: [...names].sort(compare) };
}

/** The commit side of one file from `keysAtCommit`'s answer. */
export function commitState(at: KeyAt | undefined, own: WorktreeId): SideState {
  if (at === undefined) return { state: "absent" };
  if ("key" in at) return stateOf(at.key, at.stored, own);
  const { reason, detail } = at.notDetermined;
  if (reason === "absent") return { state: "absent" };
  // Row 023-07 (re-review B5): the checkout's file is not the commit's.
  if (reason === "changed") return { state: "not comparable", reason: detail };
  return { state: "not determined", reason: `${reason}: ${detail}` };
}

export function originOf(record: ResultRecord, own: WorktreeId): Origin {
  const { worktreeId, commit } = record.provenance;
  if ((record as Marked).origin === "ci") return { kind: "ci", worktreeId: null, commit };
  if (importIdOf(worktreeId) !== null) return { kind: "import", worktreeId, commit };
  return { kind: worktreeId === own ? "own" : "worktree", worktreeId, commit };
}

const known = (s: SideState) => s.state === "pass" || s.state === "fail";

export function change(at: SideState, now: SideState): Change {
  if (!known(at) || !known(now)) return "unknown";
  if (at.state === now.state) return "unchanged";
  return at.state === "pass" ? "pass -> fail" : "fail -> pass";
}

/** Every file of either side, with its comparison, by path. */
export function compareSides(
  refs: readonly TestFileRef[],
  at: (ref: TestFileRef) => SideState,
  now: (ref: TestFileRef) => SideState,
): FileReport[] {
  return refs
    .map((ref) => {
      const [a, n] = [at(ref), now(ref)];
      return { ref, at: a, now: n, change: change(a, n) };
    })
    .sort((x, y) => compare(x.ref.path, y.ref.path) || compare(x.ref.project, y.ref.project));
}

/** D1: 0 when every file is known on both sides, 3 otherwise. */
export function exitCode(files: readonly FileReport[]): 0 | 3 {
  return files.every((f) => f.change !== "unknown") ? 0 : 3;
}

export type Counts = Readonly<Record<Change, number>>;

export function countsOf(files: readonly FileReport[]): Counts {
  const counts = { "pass -> fail": 0, "fail -> pass": 0, unchanged: 0, unknown: 0 };
  for (const f of files) counts[f.change]++;
  return counts;
}

/** D3, Non-goals: results are kept 7 days. */
export const KEPT_DAYS = 7;
const DAY_MS = 86_400_000;

/** D3: most files have no result at the commit, and it is older than the 7 days results are kept. */
export function pastRetention(
  files: readonly FileReport[],
  commitTimeMs: number,
  nowMs: number,
): boolean {
  const missing = files.filter((f) => f.at.state === "no result").length;
  return missing * 2 > files.length && nowMs - commitTimeMs > KEPT_DAYS * DAY_MS;
}

/** What the current side was read from. */
export type NowSource =
  | {
      readonly kind: "daemon";
      readonly revision: number | null;
      /** Row 023-19 (P5): files the daemon did not list yet, read at the working tree's keys. */
      readonly late?: number;
    }
  | {
      readonly kind: "stored";
      /** Row 023-19 (P5): `listing`, a daemon runs and has listed no test file yet. */
      readonly why?: "listing";
    };

export interface AtReport {
  readonly commit: string;
  readonly commitTimeMs: number;
  readonly head: CommitSha;
  readonly dirty: boolean;
  readonly now: NowSource;
  readonly checkoutMs: number | null;
  /** Row 023-07: the whole-checkout check's time, within `checkoutMs`. */
  readonly inputCheckMs?: number | null;
  /** Row 023-07: the first path the install changed in the checkout; `null` or absent when none. */
  readonly changed?: Changed | null;
  /** Why the checkout gave no keys; `null` when it did, or none was needed. */
  readonly failure: string | null;
  readonly files: readonly FileReport[];
  /**
   * Row 023-19 (P4): the named paths that select no test file, by path or by
   * closure, at the commit or now; absent when none.
   */
  readonly unmatched?: readonly string[];
  /** Row 023-07: `--run`'s budget use; absent without `--run`. */
  readonly run?: RunUse;
  /** Row 023-24 (Q1): without `--run`, the command that runs the files with no result; absent when none. */
  readonly next?: AtNext;
}

const short = (sha: string | null) => (sha === null ? "none" : sha.slice(0, 9));

/** D3: what the current side was read from (row 023-19, P5: a daemon still listing). */
function nowText(now: NowSource): string {
  const stored = "now is the stored results at the working tree's keys";
  if (now.kind === "stored" && now.why === "listing")
    return `This worktree's daemon has not listed its test files yet: ${stored}.`;
  if (now.kind === "stored") return `No daemon runs in this worktree: ${stored}.`;
  const revision = now.revision === null ? "" : ` at revision ${now.revision}`;
  const late = now.late ?? 0;
  if (late === 0) return `Now is this worktree's daemon${revision}.`;
  const files =
    late === 1 ? "1 test file it has not listed is" : `${late} test files it has not listed are`;
  return `Now is this worktree's daemon${revision}; ${files} read at the working tree's keys.`;
}

/** The input check's share of the checkout's time, when one ran. */
const checkText = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? "" : ` (checked against the commit in ${ms} ms)`;

/**
 * D3's text: a header, each changed file on one line, the unknown files
 * by group (row 023-19, P6; every file with `full`), new files' pointer to
 * `squeal proof` (P8), the counts, the run, the 7-day line.
 */
export function formatAt(report: AtReport, nowMs: number, full = false): string {
  const at = short(report.commit);
  const head = `HEAD ${short(report.head)}${report.dirty ? ", dirty" : ""}`;
  const lines = [
    // Row 023-24 (Q2): agents ran `--at HEAD` as the "after" side.
    `squeal status --at ${at}: ${report.files.length} test files at ${at} against the working tree (${head}); one call is the whole comparison`,
  ];
  lines.push(nowText(report.now));
  if (report.checkoutMs !== null) {
    lines.push(
      `Keys at ${at} from a temporary checkout, ${(report.checkoutMs / 1000).toFixed(1)} s${checkText(report.inputCheckMs)}.`,
    );
  }
  if (report.failure !== null) lines.push(`The checkout gave no keys: ${report.failure}`);
  if (report.changed !== undefined && report.changed !== null) {
    const { path, by } = report.changed;
    // Row 023-18 (D3): git's own checkout rules, found before the install, or the install.
    const what =
      by === "git"
        ? `Git's checkout rules (.gitattributes) wrote ${path} otherwise than ${at} holds it`
        : `The install changed the checkout (${path} differs from ${at})`;
    lines.push(`${what}, so its keys and results are not ${at}'s and nothing from it is stored.`);
  }
  // Row 023-19 (P6, P8): unknown files by group; a pointer to `squeal proof` for each new file.
  const files = fileLines(report.files, at, full);
  lines.push(...files.lines);
  // Row 023-19 (P4): as `squeal status <path>` says it.
  for (const path of report.unmatched ?? [])
    lines.push(`no test file's closure holds ${path}, at ${at} or now`);
  if (files.folded) lines.push("`--full` lists every file; `--json` gives each file's states.");
  lines.push(...newFileLines(report.files, report.commit, full));
  const c = countsOf(report.files);
  lines.push(
    `${c["pass -> fail"]} pass -> fail, ${c["fail -> pass"]} fail -> pass, ${c.unchanged} unchanged, ${c.unknown} unknown`,
  );
  // A failed checkout ran nothing; its line above says why.
  if (report.run !== undefined && report.failure === null) lines.push(...runLines(report.run, at));
  if (pastRetention(report.files, report.commitTimeMs, nowMs)) {
    const days = Math.floor((nowMs - report.commitTimeMs) / DAY_MS);
    lines.push(
      `Results are kept ${KEPT_DAYS} days; ${at} is ${days} days old, so most of its files have no result.`,
    );
  }
  const next = nextLine(report.next, at);
  if (next !== null) lines.push(next);
  return `${lines.join("\n")}\n`;
}

/** D1's versioned JSON report. */
export const AT_REPORT_VERSION = "squeal-status-at/1";

export function jsonAt(report: AtReport): string {
  const value = {
    version: AT_REPORT_VERSION,
    commit: report.commit,
    commitTime: new Date(report.commitTimeMs).toISOString(),
    head: report.head,
    dirty: report.dirty,
    now: report.now,
    checkoutMs: report.checkoutMs,
    inputCheckMs: report.inputCheckMs ?? null,
    changed: report.changed?.path ?? null,
    changedBy: report.changed?.by ?? null,
    failure: report.failure,
    counts: countsOf(report.files),
    unmatched: report.unmatched ?? [],
    run: report.run ?? null,
    next: report.next ?? null,
    files: report.files.map((f) => ({
      project: f.ref.project,
      path: f.ref.path,
      change: f.change,
      at: f.at,
      now: f.now,
      // Row 023-19 (P8): a test new since the commit, and the command that proves it red there.
      ...(isNew(f) ? { proof: proofCommand(f.ref.path, report.commit) } : {}),
    })),
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}
