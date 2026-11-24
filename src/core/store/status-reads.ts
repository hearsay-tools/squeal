import { testFileId } from "../keys/reverse-index.js";
import {
  type FileStates,
  noPending,
  type StatesGroup,
  type WorktreeStates,
  worktreeStatesOf,
} from "../state/file-class.js";
import type { WorktreeId } from "../types/common.js";
import {
  importIdOf,
  type KnownOutcome,
  type KnownState,
  type ResultOrigin,
  type Validity,
} from "../types/state.js";
import type { Store } from "../types/store.js";
import { num, numOrNull, oneOf, oneOfOrNull, str, strOrNull } from "./codec.js";
import type { Connection, Row } from "./connection.js";
import { SELECT_STATES, toKnownState } from "./repos/states.js";
import { connectionOf, readTransaction } from "./store.js";

/*
 * Spec 025 D11 (row 025-11): what `squeal status` reads of a worktree's
 * known states, by SQL that counts them in the store, so a worktree with
 * 20,000 checks decodes no `KnownState` per check. Each read only selects:
 * it writes nothing and names no index, so an older store or one opened
 * read-only reads alike. A module of its own, not a repository method: status
 * alone reads it, and it decides nothing a check stores, so it stays out of
 * the key-format validity path's bundle (011 C3), which every repository is
 * in (as `view-seed.ts`).
 */

const VALIDITIES = ["current", "pending", "stale", "unknown"] as const;
const OUTCOMES = ["pass", "fail", "skip", "unknown"] as const;
const KINDS = ["test", "file", "setup"] as const;
const PHASES = ["queued", "running"] as const;

const FROM = "FROM known_states s JOIN checks c ON c.id = s.check_id WHERE s.worktree_id = ?";

/**
 * `worktreeId`'s known states counted (`WorktreeStates`), in one read
 * transaction. A store `openStore` did not open as it is (a `Proxy` of one,
 * as the e2e probe and tests wrap it) has no connection here: its states are
 * counted from `knownStates.list`, to the same counts.
 */
export function readWorktreeStates(store: Store, worktreeId: WorktreeId): WorktreeStates {
  return readTransaction(store, () => {
    const conn = connection(store);
    if (conn === null) return worktreeStatesOf(store.knownStates.list(worktreeId));
    return { ...stateCounts(conn, worktreeId), notable: notableStates(conn, worktreeId) };
  });
}

function connection(store: Store): Connection | null {
  try {
    return connectionOf(store);
  } catch {
    return null;
  }
}

/** A `StatesTally` or a `FileStates` as `stateCounts` adds to it. */
type Tally = {
  count: number;
  validity: Record<Validity, number>;
  outcome: Record<KnownOutcome, number>;
  running: boolean;
};
type FileTally = Omit<FileStates, "all" | "checks" | "currentAt" | "currentUpTo" | "pending"> & {
  all: Tally;
  checks: Tally;
  currentAt: number | null;
  currentUpTo: number | null;
  pending: ReturnType<typeof noPending>;
};

const tally = (): Tally => ({
  count: 0,
  validity: { current: 0, pending: 0, stale: 0, unknown: 0 },
  outcome: { pass: 0, fail: 0, skip: 0, unknown: 0 },
  running: false,
});

/**
 * The states counted (`WorktreeStates.groups`) and each test file's
 * (`WorktreeStates.files`), from one grouped read: a row per test file,
 * check kind, validity, outcome, phase and origin, a few per file whatever
 * its number of checks. Grouped by the stored columns, not by expressions
 * of them, which the store would compute for every state
 * (`tasks/025-11-notes.md`).
 */
export function stateCounts(
  conn: Connection,
  worktreeId: WorktreeId,
): Pick<WorktreeStates, "groups" | "files"> {
  const rows = conn.all(
    `SELECT c.project AS project, c.test_path AS test_path, c.kind AS kind,
       s.validity AS validity, s.outcome AS outcome, s.pending_phase AS pending_phase,
       s.origin_kind AS origin_kind, s.origin_worktree AS origin_worktree,
       s.origin_commit AS origin_commit,
       COUNT(*) AS n, MIN(s.observed_at) AS observed_from, MAX(s.observed_at) AS observed_to
     ${FROM} GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9`,
    worktreeId,
  );
  const groups = new Map<string, StatesGroup>();
  const files = new Map<string, FileTally>();
  for (const row of rows) {
    const current = row.validity === "current";
    // No count reads a state's origin unless it is current.
    const origin = current ? [row.origin_kind, row.origin_worktree, row.origin_commit] : [];
    const id = JSON.stringify([row.kind, row.validity, row.outcome, ...origin]);
    const same = groups.get(id);
    const group: StatesGroup = same ?? {
      kind: oneOf(row, "kind", KINDS),
      validity: oneOf(row, "validity", VALIDITIES),
      outcome: oneOf(row, "outcome", OUTCOMES),
      origin: current ? originOf(row) : null,
      count: 0,
    };
    const n = num(row, "n");
    groups.set(id, { ...group, count: group.count + n });
    addToFile(files, row, group, n);
  }
  return { groups: [...groups.values()], files };
}

/** Adds `row`'s `n` states, of `group`, to its test file's tallies in `files`. */
function addToFile(files: Map<string, FileTally>, row: Row, group: StatesGroup, n: number): void {
  const testFile = { project: str(row, "project"), path: str(row, "test_path") };
  const id = testFileId(testFile);
  let file = files.get(id);
  if (file === undefined) {
    const pending = noPending();
    file = { testFile, all: tally(), checks: tally(), currentAt: null, currentUpTo: null, pending };
    files.set(id, file);
  }
  const phase = oneOfOrNull(row, "pending_phase", PHASES);
  const running = phase === "running";
  if (group.validity === "pending") file.pending[group.kind][phase ?? "none"] += n;
  // A global setup's state is the file's at its path, never one of its checks'.
  for (const own of group.kind === "setup" ? [file.all] : [file.all, file.checks]) {
    own.count += n;
    own.validity[group.validity] += n;
    own.outcome[group.outcome] += n;
    own.running ||= running;
  }
  if (group.validity !== "current") return;
  const from = numOrNull(row, "observed_from");
  const to = numOrNull(row, "observed_to");
  if (from === null || to === null) return;
  file.currentAt = file.currentAt === null ? from : Math.min(file.currentAt, from);
  file.currentUpTo = file.currentUpTo === null ? to : Math.max(file.currentUpTo, to);
}

/**
 * The states `WorktreeStates.notable` holds (`isNotable`), in
 * `knownStates.list` order: on a worktree whose checks pass, its global
 * setups' and nothing else, though every one is pending.
 */
export function notableStates(conn: Connection, worktreeId: WorktreeId): KnownState[] {
  return conn
    .all(
      `${SELECT_STATES} WHERE s.worktree_id = ?
         AND (s.outcome = 'fail' OR s.validity = 'unknown' OR c.kind = 'setup')
       ORDER BY c.project, c.test_path, c.kind, c.full_name`,
      worktreeId,
    )
    .map(toKnownState);
}

/** Spec 018 D5: a test file's current test and file states, and how many came from each import. */
export interface ImportCounts {
  /** How many of the file's (`testFileId`) test and file checks are current. */
  current(id: string): number;
  /** Of those, how many came from each import, by import id. */
  fromImport(id: string): ReadonlyMap<string, number>;
}

/**
 * `ImportCounts` by SQL: a row per test file and origin. Status reads it
 * only while the store holds an import (`readImports`); a wrapped store
 * (`readWorktreeStates`) counts from `knownStates.list`.
 */
export function importCountsByFile(store: Store, worktreeId: WorktreeId): ImportCounts {
  const conn = connection(store);
  if (conn === null) return importCountsOf(store.knownStates.list(worktreeId));
  const rows = conn.all(
    `SELECT c.project AS project, c.test_path AS test_path, s.origin_kind AS origin_kind,
       s.origin_worktree AS origin_worktree, NULL AS origin_commit, COUNT(*) AS n
     ${FROM} AND s.validity = 'current' AND c.kind != 'setup'
     GROUP BY c.project, c.test_path, s.origin_kind, s.origin_worktree`,
    worktreeId,
  );
  const current = new Map<string, number>();
  const imported = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const id = testFileId({ project: str(row, "project"), path: str(row, "test_path") });
    const n = num(row, "n");
    current.set(id, (current.get(id) ?? 0) + n);
    const origin = originOf(row);
    if (origin?.kind !== "imported") continue;
    const counts = imported.get(id) ?? new Map<string, number>();
    counts.set(origin.importId, (counts.get(origin.importId) ?? 0) + n);
    imported.set(id, counts);
  }
  return countsFrom(current, imported);
}

/** `ImportCounts` of `states`, as `knownStates.list` reads them. */
export function importCountsOf(states: readonly KnownState[]): ImportCounts {
  const current = new Map<string, number>();
  const imported = new Map<string, Map<string, number>>();
  for (const s of states) {
    if (s.validity !== "current" || s.check.kind === "setup") continue;
    const id = testFileId({ project: s.check.project, path: s.check.testPath });
    current.set(id, (current.get(id) ?? 0) + 1);
    if (s.origin?.kind !== "imported") continue;
    const counts = imported.get(id) ?? new Map<string, number>();
    counts.set(s.origin.importId, (counts.get(s.origin.importId) ?? 0) + 1);
    imported.set(id, counts);
  }
  return countsFrom(current, imported);
}

function countsFrom(
  current: ReadonlyMap<string, number>,
  imported: ReadonlyMap<string, ReadonlyMap<string, number>>,
): ImportCounts {
  const none: ReadonlyMap<string, number> = new Map();
  return {
    current: (id) => current.get(id) ?? 0,
    fromImport: (id) => imported.get(id) ?? none,
  };
}

/**
 * A state's origin from its stored columns, as the known-state repository
 * reads it (`repos/states.ts`, `toOrigin`, which stays in the validity
 * path's bundle): a kind a later release stores reads as no known origin,
 * and no kind with an import's mark as its worktree as that import's.
 */
function originOf(row: Row): ResultOrigin | null {
  const stored = strOrNull(row, "origin_kind");
  const kind = stored === "own" || stored === "inherited" ? stored : null;
  if (stored !== null && kind === null) return null;
  if (kind === null) {
    const marked = strOrNull(row, "origin_worktree");
    const importId = marked === null ? null : importIdOf(marked);
    if (importId === null) return null;
    return { kind: "imported", importId, commit: strOrNull(row, "origin_commit") };
  }
  if (kind === "own") return { kind };
  return {
    kind,
    worktreeId: str(row, "origin_worktree"),
    commit: strOrNull(row, "origin_commit"),
  };
}
