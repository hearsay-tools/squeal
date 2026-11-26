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
}

const NOT_RUN = 'whenLost "not-run"';
const LISTING_FAILED = "runner testFiles failed: ";
const DOWN = new Set(["unreachable", "refused", "not connected"]);
const SUMMARY_STATE =
  /: (awake|sleeping|connecting|not connected|degraded-disk|refused|unreachable|released)(?: \((.*?)\))?(?:;|$)/;

/** The outage the evidence records, or `null` when none applies under `whenLost: "not-run"`. */
export function outageOf(evidence: OutageEvidence): RemoteOutage | null {
  const summary = summaryOutage(evidence.summary);
  if (evidence.summary !== undefined && summary === null) return null;
  const direct = [
    ...evidence.reasons,
    ...(evidence.listingFailed === undefined ? [] : [evidence.listingFailed]),
  ]
    .map(reasonOutage)
    .find((o) => o !== null);
  const notes = summary === null ? [] : evidence.notes;
  const laneNote = notes
    .filter((n) => n.topic === "remote-lane" || n.topic?.startsWith("remote-lane:") === true)
    .map((n) => laneNoteOutage(n.text))
    .findLast((o) => o !== undefined);
  // The lane's newest note says its files run here (`whenLost: "local"`): no outage holds them.
  if (direct === undefined && laneNote === null) return null;
  const listing = notes
    .filter((n) => n.text.startsWith(LISTING_FAILED))
    .map((n) => reasonOutage(n.text.slice(LISTING_FAILED.length)))
    .findLast((o) => o !== null);
  const found = direct ?? laneNote ?? listing;
  if (found === undefined || found === null) return null;
  const more = [laneNote, listing, summary].find(
    (o) => o != null && (o.remote === found.remote || o === summary),
  );
  return {
    ...found,
    reason: found.reason ?? more?.reason ?? null,
    since: found.since ?? more?.since ?? null,
  };
}

/** The outage a snapshot records for files whose unknown reasons are `reasons`. */
export function snapshotOutage(
  s: Pick<StatusSnapshot, "remote" | "listingFailed" | "daemonNotes">,
  reasons: readonly (string | null | undefined)[],
): RemoteOutage | null {
  return outageOf({
    summary: s.remote,
    notes: s.daemonNotes,
    listingFailed: s.listingFailed,
    reasons: reasons.filter((r): r is string => typeof r === "string"),
  });
}

/** The outage the store records for `worktreeId`, with the unknown reasons of `paths`. */
export function storeOutage(
  store: Store,
  worktreeId: WorktreeId,
  paths: readonly string[] = [],
): RemoteOutage | null {
  const wanted = new Set(paths);
  const reasons = [...readUnknownFiles(store, worktreeId).values()]
    .filter((f) => wanted.has(f.testFile.path))
    .map((f) => f.reason);
  return outageOf({
    summary: readRemoteSummary(store, worktreeId),
    notes: readDaemonNotes(store, worktreeId),
    reasons,
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
  return unlisted ? storeOutage(store, worktreeId, paths) : null;
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
 * A named wait's outage: one recorded while a selected file has no current
 * result or the revision is not listed; `null` with every file current.
 */
export function waitOutage(wait: EndedNamed): RemoteOutage | null {
  const blocked =
    wait.result.testFilesListed === false || wait.files.some((f) => f.state !== "current");
  if (!blocked) return null;
  return snapshotOutage(
    wait.result,
    wait.files.map((f) => f.unknown?.reason),
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
  return reasonOutage(why) === null ? why : `${why}; ${proofRecoveryText}`;
}

/** A proof side's outage: the remote, its reason and time, the policy, the recovery. */
export function outageProofText(o: RemoteOutage): string {
  return `${outageText(o)}; ${proofRecoveryText}`;
}

/**
 * A recorded reason that names a remote: a run's failure (`remote X refused
 * (why); not run here (whenLost "not-run")`, `remote X unreachable; not run
 * here ...`) or a listing failure (`remote X unreachable since T (why); not
 * planned here (whenLost "not-run")`, `remote X refused: why; ...`).
 */
export function reasonOutage(text: string): RemoteOutage | null {
  if (!text.includes(NOT_RUN)) return null;
  const run = /remote (\S+) (refused \((.*)\)|unreachable); not run here/.exec(text);
  if (run !== null) {
    const refused = run[2]?.startsWith("refused") === true;
    return {
      remote: run[1] as string,
      state: refused ? "refused" : "unreachable",
      reason: refused ? (run[3] ?? null) : null,
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
 * unreachable since T (why); running here`. `undefined`: not such a note;
 * `null`: its files run here (`whenLost: "local"`).
 */
function laneNoteOutage(text: string): RemoteOutage | null | undefined {
  const m = /^remote (\S+) (?:refused: (.*)|unreachable since (\S+) \((.*)\)); (.+)$/.exec(text);
  if (m === null) return undefined;
  const [, remote, refusal, since, why, then] = m;
  if (then === "running here") return null;
  return {
    remote: remote as string,
    state: refusal === undefined ? "unreachable" : "refused",
    reason: refusal ?? why ?? null,
    since: since ?? null,
  };
}

/** The summary's outage when it says the remote is down; `null` otherwise. */
function summaryOutage(summary: string | undefined): RemoteOutage | null {
  if (summary === undefined) return null;
  const m = SUMMARY_STATE.exec(summary);
  if (m === null || !DOWN.has(m[1] as string)) return null;
  return {
    remote: summary.slice(0, m.index),
    state: m[1] as RemoteOutage["state"],
    reason: m[2] ?? null,
    since: null,
  };
}
