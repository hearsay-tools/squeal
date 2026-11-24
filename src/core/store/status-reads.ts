import { testFileId } from "../keys/reverse-index.js";
import type { FileStates, StatesGroup, StatesTally, WorktreeStates } from "../state/file-class.js";
import type { WorktreeId } from "../types/common.js";
import { importIdOf, type KnownOutcome, type ResultOrigin, type Validity } from "../types/state.js";
import type { Store } from "../types/store.js";
import { num, numOrNull, oneOf, str, strOrNull } from "./codec.js";
import type { Row } from "./connection.js";
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

const FROM = "FROM known_states s JOIN checks c ON c.id = s.check_id WHERE s.worktree_id = ?";

/** `worktreeId`'s known states counted (`WorktreeStates`), in one read transaction. */
export function readWorktreeStates(store: Store, worktreeId: WorktreeId): WorktreeStates {
  return readTransaction(store, () => ({
    groups: stateGroups(store, worktreeId),
    files: fileStates(store, worktreeId),
    notable: notableStates(store, worktreeId),
  }));
}

/**
 * The states counted by check kind, validity, outcome and, when current,
 * origin: a few rows whatever the worktree's size.
 */
export function stateGroups(store: Store, worktreeId: WorktreeId): StatesGroup[] {
  const current = (column: string) =>
    `CASE WHEN s.validity = 'current' THEN s.${column} END AS ${column}`;
  return connectionOf(store)
    .all(
      `SELECT c.kind AS kind, s.validity AS validity, s.outcome AS outcome,
         ${current("origin_kind")}, ${current("origin_worktree")}, ${current("origin_commit")},
         COUNT(*) AS n
       ${FROM} GROUP BY 1, 2, 3, 4, 5, 6`,
      worktreeId,
    )
    .map((row) => ({
      kind: oneOf(row, "kind", KINDS),
      validity: oneOf(row, "validity", VALIDITIES),
      outcome: oneOf(row, "outcome", OUTCOMES),
      origin: originOf(row),
      count: num(row, "n"),
    }));
}

/** Each test file with a state, by `testFileId`: its states counted, one row per file. */
export function fileStates(store: Store, worktreeId: WorktreeId): Map<string, FileStates> {
  const tally = (prefix: string, only: string) => [
    `SUM(${only}) AS ${prefix}n`,
    ...VALIDITIES.map((v) => `SUM(${only} AND s.validity = '${v}') AS ${prefix}v_${v}`),
    ...OUTCOMES.map((o) => `SUM(${only} AND s.outcome = '${o}') AS ${prefix}o_${o}`),
    `MAX(${only} AND s.pending_phase IS 'running') AS ${prefix}running`,
  ];
  const rows = connectionOf(store).all(
    `SELECT c.project AS project, c.test_path AS test_path,
       ${[...tally("a_", "1"), ...tally("t_", "c.kind != 'setup'")].join(", ")},
       MIN(CASE WHEN s.validity = 'current' THEN s.observed_at END) AS current_at,
       MAX(CASE WHEN s.validity = 'current' THEN s.observed_at END) AS current_up_to
     ${FROM} GROUP BY c.project, c.test_path ORDER BY c.project, c.test_path`,
    worktreeId,
  );
  const files = new Map<string, FileStates>();
  for (const row of rows) {
    const testFile = { project: str(row, "project"), path: str(row, "test_path") };
    files.set(testFileId(testFile), {
      testFile,
      all: tallyFrom(row, "a_"),
      checks: tallyFrom(row, "t_"),
      currentAt: numOrNull(row, "current_at"),
      currentUpTo: numOrNull(row, "current_up_to"),
    });
  }
  return files;
}

function tallyFrom(row: Row, prefix: string): StatesTally {
  const count = (column: string) => num(row, `${prefix}${column}`);
  const validity = {} as Record<Validity, number>;
  for (const v of VALIDITIES) validity[v] = count(`v_${v}`);
  const outcome = {} as Record<KnownOutcome, number>;
  for (const o of OUTCOMES) outcome[o] = count(`o_${o}`);
  return { count: count("n"), validity, outcome, running: count("running") > 0 };
}

/**
 * The states `WorktreeStates.notable` holds (`isNotable`), in
 * `knownStates.list` order: on a worktree whose checks pass and are
 * current, its global setups' and nothing else.
 */
export function notableStates(store: Store, worktreeId: WorktreeId) {
  return connectionOf(store)
    .all(
      `${SELECT_STATES} WHERE s.worktree_id = ?
         AND (s.validity != 'current' OR s.outcome = 'fail' OR c.kind = 'setup')
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
 * only while the store holds an import (`readImports`).
 */
export function importCountsByFile(store: Store, worktreeId: WorktreeId): ImportCounts {
  const rows = connectionOf(store).all(
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
