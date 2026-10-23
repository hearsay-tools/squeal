import { testFileId } from "../keys/index.js";
import type { EpochMs, RelativePath, RunReport, TestFileRef } from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import {
  FOCUSED_CHECKS,
  type FocusedCheck,
  type FocusedEnd,
  type FocusedRun,
  writeFocused,
} from "./focused-row.js";
import type { Ledger } from "./ledger.js";
import { fileCheck } from "./records.js";
import type { Moved } from "./stability.js";
import { endTier, type Tier } from "./tiers.js";

/*
 * Spec 011 C4 and C15 as amended 2026-10-23 (code row 011-145): how a
 * focused tier (`selectFocusedTier`) ends. It stores nothing under a key;
 * each file's outcome goes to the focused meta row (`writeFocused`).
 */

/** What a focused tier's record read outside the lock (`TierRecords`). */
export interface FocusedEnded {
  /** Its inputs that moved or were touched since its selection (`unstableInputs`). */
  readonly inputs: Moved;
  /** The install moved during the run, or the daemon's runtime went. */
  readonly installMoved: boolean;
  /** A stop's or a hold's cancel reached the run. */
  readonly cancelled: boolean;
}

/**
 * Records a focused tier that ended: one closed `runs` row, so its log is
 * pruned with it as any run's and no reader of open runs counts its files
 * running, and each file's entry in the focused meta row. Nothing else: no
 * result, known state, transition, duration, closure, observed path, claim
 * or discard count (C4). A file an input of which changed during the run
 * (the stability check), or whose run the runner withheld, ends
 * `discarded`; it and a cancelled one wait for another run at the file's
 * new key while the deadline holds (C15). Returns the paths that moved, for
 * the caller to reconcile.
 */
export function recordFocusedTier(
  context: SchedulerContext,
  ledger: Ledger,
  tier: Tier,
  report: RunReport,
  ended: FocusedEnded,
): RelativePath[] {
  const { store, worktreeId } = context;
  endTier(context, ledger, tier);
  const now = context.now() as EpochMs;
  const moved = new Set([...ended.inputs.changed, ...ended.inputs.touched]);
  const withheld = new Set((report.withheld ?? []).map(testFileId));
  const completed = new Set(report.completedFiles.map(testFileId));
  const runs = tier.files.map((f, i): FocusedRun => {
    const ref = f.file.ref;
    const texts = tier.focus?.[i]?.texts ?? [];
    const changed = f.inputs.filter((path) => moved.has(path) || tier.changes.has(path));
    const discard =
      (ended.installMoved ? "the install moved during the run" : null) ??
      (withheld.has(f.file.id) ? (report.failure ?? "the runner withheld the run") : null) ??
      (changed.length > 0 ? `${changed.slice(0, 3).join(", ")} changed during the run` : null);
    const end: FocusedEnd =
      discard !== null
        ? "discarded"
        : completed.has(f.file.id)
          ? "completed"
          : ended.cancelled
            ? "cancelled"
            : report.end === "completed"
              ? "crashed"
              : report.end;
    const count = report.focused?.find((c) => testFileId(c.testFile) === f.file.id);
    const checks = end === "completed" ? focusedChecks(context, report, ref) : [];
    return {
      testFile: ref,
      key: f.key,
      revision: tier.revision.number,
      texts,
      runId: tier.runId,
      logDir: tier.logDir,
      startedAt: (tier.startedAt ?? now) as EpochMs,
      endedAt: now,
      end,
      reason: discard ?? (end === "crashed" || end === "timed-out" ? report.failure : null),
      collected: count?.collected ?? null,
      matched: end === "completed" ? (count?.matched ?? null) : null,
      checks: checks.slice(0, FOCUSED_CHECKS),
      more: Math.max(0, checks.length - FOCUSED_CHECKS),
    };
  });
  store.transaction(() => {
    store.runs.start({
      id: tier.runId,
      worktreeId,
      revision: tier.revision.number,
      testFiles: tier.files.map((f) => f.file.ref),
      checkpointId: null,
      logDir: tier.logDir,
      startedAt: (tier.startedAt ?? now) as EpochMs,
    });
    store.runs.finish(tier.runId, report.end, now);
    writeFocused(store, worktreeId, runs);
  });
  const again = new Set(
    runs
      .filter((run) => run.end === "discarded" || run.end === "cancelled")
      .map((run) => testFileId(run.testFile)),
  );
  ledger.queue.focused.ended(tier.runId, (id) => again.has(id), now);
  return [...moved].sort();
}

/** A focused tier never recorded (an error stopped the pump): its entries wait for another run. */
export function requeueFocusedTier(context: SchedulerContext, ledger: Ledger, tier: Tier): void {
  endTier(context, ledger, tier);
  ledger.queue.focused.ended(tier.runId, () => true, context.now());
}

/** The selected checks `report` holds of `ref`, and its file-level check when the file failed to load. */
function focusedChecks(
  context: SchedulerContext,
  report: RunReport,
  ref: TestFileRef,
): FocusedCheck[] {
  const inFile = (check: { project: string; testPath: string }) =>
    check.project === ref.project && check.testPath === ref.path;
  const checks: FocusedCheck[] = report.results
    .filter((result) => inFile(result.check))
    .map((result) => ({
      check: result.check,
      outcome: result.outcome,
      durationMs: result.durationMs,
      location: result.location,
      ...(result.outcome === "fail"
        ? context.describe(result.errors, result.location)
        : { summary: null, fingerprint: null }),
    }));
  const error = report.fileErrors.find((e) => testFileId(e.testFile) === testFileId(ref));
  if (error !== undefined) {
    checks.push({
      check: fileCheck(ref),
      outcome: "fail",
      durationMs: 0,
      location: null,
      ...context.describe(error.errors, null),
    });
  }
  return checks;
}
