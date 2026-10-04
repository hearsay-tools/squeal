import { CLOSURE_METHOD, testFileId } from "../keys/index.js";
import { readHeader, testFileKeyOf, toKnownFailure } from "../state/index.js";
import { META_STORE_RECOVERED, worktreeIdFor } from "../store/index.js";
import {
  type AbsolutePath,
  type CheckBreakdown,
  type DaemonLiveness,
  type DaemonRecord,
  type EpochMs,
  type InheritedSource,
  type KnownState,
  PAYLOAD_SCHEMA_VERSION,
  type StatusBuilder,
  type StatusResult,
  type StatusSnapshot,
  type Store,
  type TestFileKeyRecord,
  type WorktreeId,
} from "../types/index.js";
import { readDaemonNotes } from "./notes.js";
import { type StatusStoreOptions, unavailable, withStatusStore } from "./open.js";

export interface StatusOptions extends StatusStoreOptions {
  readonly now?: () => EpochMs;
}

/**
 * A heartbeat counts as live up to this many intervals old, so a daemon that
 * is a little late with its write is not reported down. Spec 001 D10: "no
 * daemon running since <time>" when the heartbeat is older than its interval.
 */
export const HEARTBEAT_GRACE_INTERVALS = 2;

/**
 * `squeal status` for the worktree containing `cwd`. Reads the store
 * directly and needs no daemon (spec 001 D7).
 */
export function readStatus(cwd: AbsolutePath, options: StatusOptions = {}): StatusResult {
  const now = options.now ?? Date.now;
  return withStatusStore(cwd, options, ({ store, root }) => buildSnapshot(store, root, now()));
}

export interface StatusBuilderOptions {
  readonly now?: () => EpochMs;
}

/**
 * The store-backed `StatusBuilder`. Resolves the worktree root through the
 * `worktrees` table; a worktree with no row is `not-registered`.
 */
export function createStatusBuilder(
  store: Store,
  options: StatusBuilderOptions = {},
): StatusBuilder {
  const now = options.now ?? Date.now;
  return {
    build(worktreeId) {
      const worktree = store.worktrees.get(worktreeId);
      if (worktree === null) {
        return unavailable(
          "not-registered",
          `worktree ${worktreeId} is not registered in the store`,
        );
      }
      return snapshot(store, worktreeId, worktree.root, now());
    },
  };
}

/** The D7 snapshot of the worktree at `root` from an open store. */
export function buildSnapshot(store: Store, root: AbsolutePath, now: EpochMs): StatusSnapshot {
  return snapshot(store, worktreeIdFor(root), root, now);
}

function snapshot(
  store: Store,
  worktreeId: WorktreeId,
  root: AbsolutePath,
  now: EpochMs,
): StatusSnapshot {
  const worktree = store.worktrees.get(worktreeId);
  const revision = store.revisions.latest(worktreeId);
  const states = store.knownStates.list(worktreeId);
  const keys = store.testFileKeys.list(worktreeId);
  const header = readHeader(store, worktreeId, states, keys);

  const notes: string[] = [];
  if (worktree === null) {
    notes.push("this worktree is not registered in the store; no daemon has run here");
  }
  if (revision === null) notes.push("no revision recorded for this worktree yet");
  const recovered = recoveryNote(store.meta.get(META_STORE_RECOVERED));
  if (recovered !== null) notes.push(recovered);

  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    available: true,
    worktreeId,
    worktreeRoot: worktree?.root ?? root,
    ...header,
    head: revision?.head ?? null,
    dirty: revision?.dirty ?? false,
    daemon: liveness(worktree?.daemon ?? null, now),
    knownFailures: states.flatMap((s) => toKnownFailure(s, header.revision) ?? []),
    inherited: inheritedSources(store, states),
    breakdown: breakdown(states, keys),
    closureMethod: CLOSURE_METHOD,
    storeSchemaVersion: store.schemaVersion,
    notes,
    daemonNotes: readDaemonNotes(store, worktreeId),
  };
}

function liveness(daemon: DaemonRecord | null, now: EpochMs): DaemonLiveness {
  if (daemon === null) return { state: "down", since: null };
  const age = now - daemon.heartbeatAt;
  if (age <= daemon.heartbeatIntervalMs * HEARTBEAT_GRACE_INTERVALS) {
    return { state: "alive", lastHeartbeatAt: daemon.heartbeatAt };
  }
  return { state: "down", since: daemon.heartbeatAt };
}

/** Current inherited results grouped by source worktree and commit, largest group first. */
function inheritedSources(
  store: Store,
  states: readonly KnownState[],
): StatusSnapshot["inherited"] {
  const groups = new Map<
    string,
    { worktreeId: WorktreeId; commit: string | null; count: number }
  >();
  let count = 0;
  for (const s of states) {
    if (s.validity !== "current" || s.origin?.kind !== "inherited") continue;
    count++;
    const id = JSON.stringify([s.origin.worktreeId, s.origin.commit]);
    const group = groups.get(id) ?? {
      worktreeId: s.origin.worktreeId,
      commit: s.origin.commit,
      count: 0,
    };
    group.count++;
    groups.set(id, group);
  }
  const sources: InheritedSource[] = [...groups.values()]
    .map((g) => ({ ...g, worktreeRoot: store.worktrees.get(g.worktreeId)?.root ?? null }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.worktreeId.localeCompare(b.worktreeId) ||
        String(a.commit).localeCompare(String(b.commit)),
    )
    .map(({ worktreeId, worktreeRoot, commit, count }) => ({
      worktreeId,
      worktreeRoot,
      commit,
      count,
    }));
  return { count, sources };
}

/**
 * Known states are authoritative for check counts and pending phase. A
 * pending check without a phase takes its test file's phase from
 * `test_file_keys`, else counts as queued.
 */
function breakdown(
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
): CheckBreakdown {
  const filePhase = new Map(keys.map((k) => [testFileId(k.testFile), k.pending]));
  const currentByOutcome = { pass: 0, fail: 0, skip: 0, unknown: 0 };
  const pendingByPhase = { queued: 0, running: 0 };
  const filesWithChecks = new Set<string>();
  for (const s of states) {
    const file = testFileKeyOf(s.check);
    filesWithChecks.add(file);
    if (s.validity === "current") currentByOutcome[s.outcome]++;
    if (s.validity === "pending")
      pendingByPhase[s.pendingPhase ?? filePhase.get(file) ?? "queued"]++;
  }
  const testFilesWithoutChecks = keys.filter(
    (k) => !filesWithChecks.has(testFileId(k.testFile)),
  ).length;
  return { currentByOutcome, pendingByPhase, testFiles: keys.length, testFilesWithoutChecks };
}

/** Spec 001 D12: "status says the baseline was lost." */
function recoveryNote(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const { at, movedTo } = JSON.parse(raw) as { at?: unknown; movedTo?: unknown };
    const when = typeof at === "number" ? ` at ${new Date(at).toISOString()}` : "";
    const where = typeof movedTo === "string" ? ` (corrupt file moved to ${movedTo})` : "";
    return `store was recovered from corruption${when}; the baseline was lost${where}`;
  } catch {
    return `store was recovered from corruption; the baseline was lost (${raw})`;
  }
}
