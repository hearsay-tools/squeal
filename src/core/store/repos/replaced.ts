import { isRecord } from "../../fs/index.js";
import type {
  CheckKey,
  EpochMs,
  FailingRow,
  ReplacedFailure,
  ResultRecord,
} from "../../types/index.js";
import { CHECK_COLUMNS, checkParams, strOrNull, toResult } from "../codec.js";
import type { Connection } from "../connection.js";
import { readMetaList, writeMetaList } from "./meta-list.js";

/*
 * 011 C5 as amended 2026-10-21 (row 011-77, gh-54; `tasks/011-64/design.md`
 * section 3): a failing row that a pass replaces at the same key, by a
 * retry, a re-run or another worktree's run, is kept as a replaced failure.
 * Every flip is its own entry, keyed by check, key and failing run. The
 * newest 4 per check and 1,024 in all are kept, each until its failure is
 * older than the retention cutoff (C7); meanwhile prune keeps its failure
 * text, its run and its run log. It is history: no known state, transition,
 * delivery, lookup or held fail reads it. It lives in the store layer, off
 * the key-format alarm's path (design section 4), so prune can read it.
 */

/** `meta` key of the replaced failures of every worktree, oldest first: the rows they outlive are shared. */
export const REPLACED_META_KEY = "replaced-failures";

/** The most replaced failures kept per check; past that its flaky note says the check flips. */
export const REPLACED_PER_CHECK = 4;

/** The most replaced failures kept in all, as every shared `meta` list keeps. */
export const REPLACED_KEPT = 1_024;

/** The failing rows at a key, with the text id a `ResultRecord` does not carry; through `results_by_key`. */
const FAILING_AT = `SELECT r.*, ${CHECK_COLUMNS}, f.summary, f.errors FROM results r
  JOIN checks c ON c.id = r.check_id LEFT JOIN failure_texts f ON f.id = r.failure_id
  WHERE r.key = ? AND r.outcome = 'fail'`;

export function failingAt(conn: Connection, key: CheckKey): FailingRow[] {
  return conn
    .all(FAILING_AT, key)
    .map((row) => ({ result: toResult(row), failureId: strOrNull(row, "failure_id") }));
}

/** Every kept entry, oldest first; empty when none or unreadable, and an entry that does not parse is left out. */
export function readReplaced(conn: Connection): ReplacedFailure[] {
  return readMetaList(conn, REPLACED_META_KEY, isEntry);
}

/** See `FailureRepo.keepReplaced`. A fail replaced by a fail is the same failure stored again: not kept. */
export function keepReplaced(
  conn: Connection,
  failing: readonly FailingRow[],
  records: readonly ResultRecord[],
  loadOf: (runId: string) => number | null,
): number {
  if (failing.length === 0) return 0;
  const passes = new Map(
    records.filter((r) => r.outcome === "pass").map((r) => [identity(r.check), r]),
  );
  const added: ReplacedFailure[] = [];
  for (const { result, failureId } of failing) {
    const pass = passes.get(identity(result.check));
    if (pass === undefined || pass.key !== result.key) continue;
    added.push({
      check: result.check,
      key: result.key,
      provenance: result.provenance,
      durationMs: result.durationMs,
      location: result.location,
      fingerprint: result.fingerprint,
      summary: result.summary,
      failureId,
      loadPerCpu: loadOf(result.provenance.runId),
      replacedBy: {
        runId: pass.provenance.runId,
        worktreeId: pass.provenance.worktreeId,
        recordedAt: pass.provenance.recordedAt,
      },
    });
  }
  if (added.length === 0) return 0;
  conn.transaction(() =>
    writeMetaList(conn, REPLACED_META_KEY, capped([...readReplaced(conn), ...added])),
  );
  return added.length;
}

/** Drops the entries whose failure is older than `cutoff`; inside the caller's transaction. Returns how many. */
export function expireReplaced(conn: Connection, cutoff: EpochMs): number {
  const entries = readReplaced(conn);
  const kept = entries.filter((e) => e.provenance.recordedAt >= cutoff);
  if (kept.length < entries.length) writeMetaList(conn, REPLACED_META_KEY, kept);
  return entries.length - kept.length;
}

/** The runs and failure texts the kept entries name, which prune keeps; read inside its transaction. */
export function keptByReplaced(conn: Connection): { runs: string[]; texts: string[] } {
  const entries = readReplaced(conn);
  return {
    runs: entries.map((e) => e.provenance.runId),
    texts: entries.flatMap((e) => (e.failureId === null ? [] : [e.failureId])),
  };
}

/**
 * `entries`, oldest first, without an earlier entry of the same check, key
 * and failing run, cut to the newest `REPLACED_PER_CHECK` of each check and
 * the newest `REPLACED_KEPT` in all.
 */
function capped(entries: readonly ReplacedFailure[]): ReplacedFailure[] {
  const seen = new Set<string>();
  const perCheck = new Map<string, number>();
  const kept: ReplacedFailure[] = [];
  for (let i = entries.length - 1; i >= 0 && kept.length < REPLACED_KEPT; i--) {
    const entry = entries[i] as ReplacedFailure;
    const check = identity(entry.check);
    const id = JSON.stringify([check, entry.key, entry.provenance.runId]);
    const count = perCheck.get(check) ?? 0;
    if (seen.has(id) || count >= REPLACED_PER_CHECK) continue;
    seen.add(id);
    perCheck.set(check, count + 1);
    kept.push(entry);
  }
  return kept.reverse();
}

function identity(check: ResultRecord["check"]): string {
  return JSON.stringify(checkParams(check));
}

function isEntry(value: unknown): value is ReplacedFailure {
  if (!isRecord(value) || !isRecord(value.check) || !isRecord(value.provenance)) return false;
  const { check, provenance: p, replacedBy: by } = value;
  return (
    typeof check.project === "string" &&
    typeof check.testPath === "string" &&
    typeof check.kind === "string" &&
    typeof value.key === "string" &&
    typeof p.runId === "string" &&
    typeof p.worktreeId === "string" &&
    typeof p.revision === "number" &&
    typeof p.recordedAt === "number" &&
    typeof value.durationMs === "number" &&
    (value.failureId === null || typeof value.failureId === "string") &&
    (value.loadPerCpu === null || typeof value.loadPerCpu === "number") &&
    isRecord(by) &&
    typeof by.runId === "string" &&
    typeof by.worktreeId === "string" &&
    typeof by.recordedAt === "number"
  );
}
