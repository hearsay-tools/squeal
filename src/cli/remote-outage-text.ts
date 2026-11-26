import { readDaemonNotes } from "../core/notes.js";
import { readUnknownFiles } from "../core/scheduler/unknown-files.js";
import { readHeader } from "../core/state/header.js";
import { readRemoteSummary } from "../core/status/remote-status.js";
import type { WorktreeId } from "../core/types/common.js";
import type { DaemonNote } from "../core/types/scheduler.js";
import type { StatusSnapshot } from "../core/types/status.js";
import type { Store } from "../core/types/store.js";
import type { TestFileKeyRecord } from "../core/types/store-records.js";
import { namedPaths } from "./no-verdict-lines.js";
import type { EndedNamed } from "./status-wait-lines.js";

/*
 * Row 026-31 (gh-278; spec 026 D8.3, D12; 021 D13): the recorded remote
 * outage that keeps a worktree's files from being listed or run, so a named
 * wait, `retry` and `proof` name the remote, its recorded reason and time,
 * the `whenLost: "not-run"` policy and the recovery, as plain status names
 * the remote. Only what the daemon recorded is read: the remote's summary
 * line (`summary.ts`), its lane's notes (`remote-lane`, `remote-lane:*`),
 * the listing failure (`runner testFiles failed: `) and the files' unknown
 * reasons (`lane.ts`'s run failure). Under `whenLost: "local"` the files run
 * here, so no outage explains them. A summary that says the remote is
 * healthy again ends the outage; with no summary, only direct evidence
 * counts: a listing failure the snapshot keeps for the current revision, or
 * a selected file's own unknown reason. Nothing recorded, `null`: callers
 * then print what they printed before this row.
 */

/** A remote's recorded outage under `whenLost: "not-run"`. */
export interface RemoteOutage {
  /** The lane's target or the summary's provider and machine. */
  readonly remote: string;
  readonly state: "unreachable" | "refused" | "not connected";
  /** The recorded reason, such as `the host ended`; `null` when none was recorded. */
  readonly reason: string | null;
  /** When the remote went down, ISO, as the lane recorded it; `null` when not recorded. */
  readonly since: string | null;
}

/** The recorded evidence of one worktree, from a snapshot or the store. */
export interface OutageEvidence {
  /** The remote's summary line (`remote` of the snapshot). */
  readonly summary?: string | undefined;
  /** The daemon's notes; only remote topics and listing failures are read. */
  readonly notes: readonly DaemonNote[];
  /** A listing failure known to be the current revision's (the snapshot's `listingFailed`). */
  readonly listingFailed?: string | undefined;
  /** The selected files' recorded unknown reasons. */
  readonly reasons: readonly string[];
  /**
   * The worktree has not listed its test files (or keyed none), so a remote
   * that plans them may be what holds them. Without it only direct
   * evidence, a selected file's reason or a listing failure, names an outage.
   */
  readonly unlisted?: boolean;
}

const NOT_RUN = 'whenLost "not-run"';
const LISTING_FAILED = "runner testFiles failed: ";
const DOWN = new Set(["unreachable", "refused", "not connected"]);
const SUMMARY_STATE =
  /: (awake|sleeping|connecting|not connected|degraded-disk|refused|unreachable|released)(?: \((.*?)\))?(?:;|$)/;
const PLANNING_REMOTE = /; planning remote(?:;|$)/;

/**
 * The outage the evidence records, or `null` when none applies under
 * `whenLost: "not-run"`. Review 0.1.637 B4: a lane note never stands in for
 * the cause of a selected file. Direct evidence (a selected file's reason,
 * the listing failure) names the outage, and notes and the summary of the
 * same remote only add its reason and time; with none, the outage holds the
 * files only while they are not listed and the remote plans them.
 */
export function outageOf(evidence: OutageEvidence): RemoteOutage | null {
  const summary = summaryState(evidence.summary);
  if (evidence.summary !== undefined && summary === null) return null;
  const direct = [
    ...evidence.reasons,
    ...(evidence.listingFailed === undefined ? [] : [evidence.listingFailed]),
  ]
    .map(reasonOutage)
    .find((o) => o !== null);
  // A summary that says the remote is healthy again ends the outage its older records name.
  if (summary !== null && !DOWN.has(summary.state)) {
    return direct === undefined || sameRemote(summary.remote, direct.remote) ? null : direct;
  }
  // With no summary only direct evidence counts.
  if (summary === null) return direct ?? null;
  const down = summary as RemoteOutage;
  const lanes = evidence.notes
    .filter((n) => n.topic === "remote-lane" || n.topic?.startsWith("remote-lane:") === true)
    .map((n) => laneNoteOutage(n.text))
    .filter((n) => n !== undefined);
  const listings = evidence.notes
    .filter((n) => n.text.startsWith(LISTING_FAILED))
    .map((n) => reasonOutage(n.text.slice(LISTING_FAILED.length)))
    .filter((o) => o !== null);
  const newest = (remote: string) => [
    ...lanes.flatMap((n) => (n.outage !== null && sameRemote(n.remote, remote) ? [n.outage] : [])),
    ...listings.filter((o) => sameRemote(o.remote, remote)),
  ];
  if (direct !== undefined) return enriched(direct, [...newest(direct.remote).reverse(), down]);
  if (evidence.unlisted !== true) return null;
  // The remote's newest lane note says its files run here (`whenLost: "local"`): no outage holds them.
  const lane = lanes.findLast((n) => sameRemote(n.remote, down.remote));
  if (lane !== undefined && lane.outage === null) return null;
  const listing = listings.findLast((o) => sameRemote(o.remote, down.remote));
  const planned = PLANNING_REMOTE.test(evidence.summary ?? "") ? lane?.outage : undefined;
  const found = planned ?? listing;
  if (found === undefined) return null;
  return enriched(found, [...newest(found.remote).reverse(), down]);
}

/** `found` with the reason and the time it lacks, from the first of `others` of the same remote that records it. */
function enriched(found: RemoteOutage, others: readonly RemoteOutage[]): RemoteOutage {
  const same = others.filter((o) => sameRemote(o.remote, found.remote));
  return {
    ...found,
    reason: found.reason ?? same.find((o) => o.reason !== null)?.reason ?? null,
    since: found.since ?? same.find((o) => o.since !== null)?.since ?? null,
  };
}

/** A lane's target (`cmd:lan-1`) and the summary's provider and machine (`command cmd:lan-1`) name one remote. */
function sameRemote(a: string, b: string): boolean {
  return a === b || a.endsWith(` ${b}`) || b.endsWith(` ${a}`);
}

/** The outage a snapshot records for files whose unknown reasons are `reasons`. */
export function snapshotOutage(
  s: Pick<StatusSnapshot, "remote" | "listingFailed" | "daemonNotes">,
  reasons: readonly (string | null | undefined)[],
  unlisted = false,
): RemoteOutage | null {
  return outageOf({
    summary: s.remote,
    notes: s.daemonNotes,
    listingFailed: s.listingFailed,
    reasons: reasons.filter((r): r is string => typeof r === "string"),
    unlisted,
  });
}

/**
 * The outage the store records for `worktreeId` that explains `paths`: by
 * their own unknown reasons, or, with `unlisted`, the remote that plans the
 * files the worktree has not listed.
 */
export function storeOutage(
  store: Store,
  worktreeId: WorktreeId,
  paths: readonly string[] = [],
  unlisted = false,
): RemoteOutage | null {
  const wanted = new Set(paths);
  const reasons = [...readUnknownFiles(store, worktreeId).values()]
    .filter((f) => wanted.has(f.testFile.path))
    .map((f) => f.reason);
  return outageOf({
    summary: readRemoteSummary(store, worktreeId),
    notes: readDaemonNotes(store, worktreeId),
    reasons,
    unlisted,
  });
}

/**
 * The outage that explains why `worktreeId` has no key for a file: its test
 * files are not listed (or its runner part is pending, or nothing is keyed)
 * while a remote outage is recorded.
 */
export function listingOutage(
  store: Store,
  worktreeId: WorktreeId,
  keys: readonly TestFileKeyRecord[],
  paths: readonly string[] = [],
): RemoteOutage | null {
  const header = readHeader(store, worktreeId, undefined, keys);
  const unlisted =
    header.testFilesListed !== true || header.runnerPartPending === true || keys.length === 0;
  return unlisted ? storeOutage(store, worktreeId, paths, true) : null;
}

/** `remote cmd:lan-1 unreachable since <ISO> (the host ended); nothing runs here in its place (whenLost "not-run")`. */
export function outageText(o: RemoteOutage): string {
  const since = o.since === null ? "" : ` since ${o.since}`;
  const reason = o.reason === null ? "" : ` (${o.reason})`;
  return `remote ${o.remote} ${o.state}${since}${reason}; nothing runs here in its place (${NOT_RUN})`;
}

/**
 * The recovery: status for the remote, then once it is ready the named wait,
 * and `retry` for keyed files (an unlisted file has no key to retry at).
 */
export function recoveryText(command: string, paths: string, listed: boolean): string {
  const wait = `\`${command} status --wait 60000 ${paths}\` waits for ${listed ? "the result" : "the listing and the result"}`;
  return listed
    ? `check \`${command} status\`; once the remote is ready, ${retryText(command, paths)} and ${wait}`
    : `check \`${command} status\`; once the remote is ready, ${wait}`;
}

/** `\`squeal retry a.test.ts\` runs them again`. */
export function retryText(command: string, paths: string): string {
  return `\`${command} retry ${paths}\` runs them again`;
}

/**
 * A named wait's outage: one a selected file with no current result
 * records, or the remote that plans the files of a revision not listed;
 * `null` with every file current, or when the outage explains no selected
 * file (review 0.1.637 B4: a local timeout beside another runner's outage).
 */
export function waitOutage(wait: EndedNamed): RemoteOutage | null {
  const unlisted = wait.result.testFilesListed === false;
  const held = wait.files.filter((f) => f.state !== "current");
  if (!unlisted && held.length === 0) return null;
  return snapshotOutage(
    wait.result,
    held.map((f) => f.unknown?.reason),
    unlisted,
  );
}

/** A named wait's `Remote:` line under its revision line, while an outage holds its files. */
export function namedRemoteLines(wait: EndedNamed, command: string): string[] {
  const o = waitOutage(wait);
  if (o === null) return [];
  const listed = wait.result.testFilesListed !== false;
  return [`Remote: ${outageText(o)}; ${recoveryText(command, namedPaths(wait), listed)}.`];
}

/** Proof's recovery: its sides read unknown until the remote is ready (never a pass). */
const proofRecoveryText = "the side stays unknown; run the proof again once the remote is ready";

/** `why`, a side's unknown detail, with the policy and the recovery when it records a remote outage. */
export function sideOutageText(why: string): string {
  if (reasonOutage(why) === null || why.endsWith(proofRecoveryText)) return why;
  return `${why}; ${proofRecoveryText}`;
}

/** A proof side's outage: the remote, its reason and time, the policy, the recovery. */
export function outageProofText(o: RemoteOutage): string {
  return `${outageText(o)}; ${proofRecoveryText}`;
}

/**
 * A recorded reason that names a remote: a run's failure (`remote X refused
 * (why); not run here (whenLost "not-run")`, `remote X unreachable; not run
 * here ...`, and since row 026-30 a lost run's `remote X unreachable during
 * the run of N files (why); not run here (whenLost "not-run"); waits retry
 * once X reconnects ...`) or a listing failure (`remote X unreachable since
 * T (why); not planned here (whenLost "not-run")`, `remote X refused: why;
 * ...`). A runner's prefix (`vitest: `) may come first; `why` keeps its own
 * parentheses, as in `the vitest runner host exited (signal SIGKILL)`.
 */
export function reasonOutage(text: string): RemoteOutage | null {
  if (!text.includes(NOT_RUN)) return null;
  const run =
    /remote (\S+) (?:refused \((.*)\)|unreachable(?: during the run of \d+ files \((.*)\))?); not run here/.exec(
      text,
    );
  if (run !== null) {
    const [, remote, refusal, lost] = run;
    return {
      remote: remote as string,
      state: refusal === undefined ? "unreachable" : "refused",
      reason: refusal ?? lost ?? null,
      since: null,
    };
  }
  const listing =
    /remote (\S+) (?:(refused): (.*)|(unreachable) since (\S+) \((.*)\)|(not connected) \((.*)\)); not planned here/.exec(
      text,
    );
  if (listing === null) return null;
  const [, remote, refused, refusal, unreachable, since, why, waiting, cause] = listing;
  const state = refused ?? unreachable ?? waiting;
  return {
    remote: remote as string,
    state: state as RemoteOutage["state"],
    reason: refusal ?? why ?? cause ?? null,
    since: since ?? null,
  };
}

/**
 * The lane's status note: `remote X refused: why; 3 files not run`, `remote X
 * unreachable since T (why); running here`, with its remote. `undefined`:
 * not such a note; `outage` `null`: its files run here (`whenLost: "local"`).
 */
function laneNoteOutage(
  text: string,
): { readonly remote: string; readonly outage: RemoteOutage | null } | undefined {
  const m = /^remote (\S+) (?:refused: (.*)|unreachable since (\S+) \((.*)\)); (.+)$/.exec(text);
  if (m === null) return undefined;
  const [, at, refusal, since, why, then] = m;
  const remote = at as string;
  if (then === "running here") return { remote, outage: null };
  return {
    remote,
    outage: {
      remote,
      state: refusal === undefined ? "unreachable" : "refused",
      reason: refusal ?? why ?? null,
      since: since ?? null,
    },
  };
}

/** The summary's remote and its state, with the reason it gives; `null` when it names no state. */
function summaryState(
  summary: string | undefined,
): (Omit<RemoteOutage, "state"> & { readonly state: string }) | null {
  if (summary === undefined) return null;
  const m = SUMMARY_STATE.exec(summary);
  if (m === null) return null;
  return {
    remote: summary.slice(0, m.index),
    state: m[1] as string,
    reason: m[2] ?? null,
    since: null,
  };
}
