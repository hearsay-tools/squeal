import { testFileId } from "../keys/index.js";
import {
  type CheckId,
  type CheckKey,
  type DiagnosticFingerprint,
  type EpochMs,
  type RevisionNumber,
  type RunOutcome,
  type SourceLocation,
  type Store,
  type TestFileRef,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";

/*
 * Spec 011 C5 as amended 2026-10-23 (row 011-135, `tasks/011-135/design.md`
 * section 2.2; code row 011-145): the newest focused run of each test
 * file, in one meta row per worktree (`focusedMetaKey`). It is never a
 * result: no `results` or `known_states` row comes from a focused run, so
 * it is never current, a known failure, a transition, a checkpoint or a
 * duration. The daemon
 * writes an entry twice, at the run's start with `endedAt` null and at its
 * end; status and `why` (row 011-146) read it.
 */

/** The row holds at most this many files, the oldest entry dropped first. */
export const FOCUSED_FILES = 20;

/** Each entry keeps at most this many selected checks, with a count of the rest. */
export const FOCUSED_CHECKS = 50;

/**
 * How a focused run ended: `discarded` when an input of its file changed
 * during it (the stability check, C4), with the reason; the others as a
 * run's end, `cancelled` for a stop's or a hold's cancel.
 */
export type FocusedEnd = "completed" | "discarded" | "crashed" | "timed-out" | "cancelled";

/** One selected check of a focused run, or its file-level check when the file failed to load. */
export interface FocusedCheck {
  readonly check: CheckId;
  readonly outcome: RunOutcome;
  readonly durationMs: number;
  readonly summary: string | null;
  readonly location: SourceLocation | null;
  readonly fingerprint: DiagnosticFingerprint | null;
}

/** The newest focused run of one test file. */
export interface FocusedRun {
  readonly testFile: TestFileRef;
  /** The file's key when the run started: the entry applies while it is still the file's key. */
  readonly key: CheckKey;
  /** The revision the run started at. */
  readonly revision: RevisionNumber;
  /** The `--check` texts it ran for. */
  readonly texts: readonly string[];
  readonly runId: string;
  /** The run's log, as for any run; pruned with the run's row. */
  readonly logDir: string;
  readonly startedAt: EpochMs;
  /** `null` while it runs. */
  readonly endedAt: EpochMs | null;
  /** `null` while it runs. */
  readonly end: FocusedEnd | null;
  /** Why it was discarded, crashed or timed out; `null` otherwise. */
  readonly reason: string | null;
  /** The checks the runner collected in the file; `null` while it runs or when its filter hides them. */
  readonly collected: number | null;
  /** How many checks held a text, the ones that ran; `null` while it runs or when it did not end completed. */
  readonly matched: number | null;
  /** The selected checks, at most `FOCUSED_CHECKS`. */
  readonly checks: readonly FocusedCheck[];
  /** How many selected checks `checks` leaves out. */
  readonly more: number;
}

/** `meta` key of `worktreeId`'s focused runs: a JSON list of `FocusedRun`, oldest first. */
export function focusedMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("focused", worktreeId);
}

/** `worktreeId`'s focused runs, oldest first; none without a row or with one that does not parse. */
export function readFocused(store: Store, worktreeId: WorktreeId): FocusedRun[] {
  const raw = store.meta.get(focusedMetaKey(worktreeId));
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isFocusedRun) : [];
  } catch {
    return [];
  }
}

/**
 * Writes `runs` into `worktreeId`'s row: each replaces its file's entry and
 * goes last, and the oldest entries go past `FOCUSED_FILES`.
 */
export function writeFocused(
  store: Store,
  worktreeId: WorktreeId,
  runs: readonly FocusedRun[],
): void {
  if (runs.length === 0) return;
  const ids = new Set(runs.map((run) => testFileId(run.testFile)));
  const kept = readFocused(store, worktreeId).filter((run) => !ids.has(testFileId(run.testFile)));
  const all = [...kept, ...runs].slice(-FOCUSED_FILES);
  store.meta.set(focusedMetaKey(worktreeId), JSON.stringify(all));
}

function isFocusedRun(value: unknown): value is FocusedRun {
  if (typeof value !== "object" || value === null) return false;
  const run = value as Record<string, unknown>;
  const file = run.testFile as Record<string, unknown> | null | undefined;
  return (
    typeof file?.project === "string" &&
    typeof file.path === "string" &&
    typeof run.key === "string" &&
    typeof run.revision === "number" &&
    typeof run.runId === "string" &&
    Array.isArray(run.texts) &&
    Array.isArray(run.checks)
  );
}
