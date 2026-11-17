import { isRecord } from "../fs/json.js";
import type { RevisionNumber, WorktreeId } from "../types/common.js";
import { type Store, worktreeMetaKey } from "../types/store.js";
import type { SchedulerContext } from "./context.js";
import { estimateMs } from "./tier-width.js";
import type { Tier } from "./tiers.js";

/*
 * Rows 005-93 and 005-96, review 0.1.530 B2 and B3: the facts the late bound reads, recorded
 * where they are known, at each edit tier's start (`TierKind` "edit"). The scheduler's tier size
 * and each project's width at it and runner part (`RunnerTraits.tierWidth`, `tierPart`), so a
 * hook that reads no policy and loads no runner estimates tiers as the scheduler does; the first
 * start of each edit revision, kept apart from later tiers at that revision, so a backlog's late
 * tiers never read as an edit's start delay; and each edit tier's run with the scheduler's own
 * wall estimate, for its overhead once the run ended. One JSON row per worktree, the newest
 * `TIMINGS_KEPT` of each list.
 */

/** The newest first starts and edit tiers kept. */
export const TIMINGS_KEPT = 20;

/** `meta` key of a worktree's edit timings. */
export function editTimingsMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("editTimings", worktreeId);
}

/** A worktree's edit timings, as the scheduler recorded them. */
export interface EditTimings {
  /** `runner.tierSize` at the last edit tier's start. */
  readonly tierSize: number;
  /** Per project: the width its files run with at `tierSize`, and their runner part. */
  readonly widths: Readonly<Record<string, { readonly width: number; readonly part: string }>>;
  /** Newest first: each edit revision's first tier start after the revision was recorded. */
  readonly firsts: readonly { readonly revision: RevisionNumber; readonly delayMs: number }[];
  /** Newest first: each edit tier's run and its wall estimate at its grant. */
  readonly tiers: readonly { readonly runId: string; readonly estimateMs: number }[];
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The worktree's edit timings; `null` when none is recorded or the row does not read. */
export function readEditTimings(store: Store, worktreeId: WorktreeId): EditTimings | null {
  const raw = store.meta.get(editTimingsMetaKey(worktreeId));
  let value: unknown = null;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || !isNumber(value.tierSize) || !isRecord(value.widths)) return null;
  const widths: Record<string, { width: number; part: string }> = {};
  for (const [project, w] of Object.entries(value.widths)) {
    if (isRecord(w) && isNumber(w.width) && typeof w.part === "string") {
      widths[project] = { width: w.width, part: w.part };
    }
  }
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isRecord) : []);
  return {
    tierSize: value.tierSize,
    widths,
    firsts: list(value.firsts).flatMap((f) =>
      isNumber(f.revision) && isNumber(f.delayMs)
        ? [{ revision: f.revision, delayMs: f.delayMs }]
        : [],
    ),
    tiers: list(value.tiers).flatMap((t) =>
      typeof t.runId === "string" && isNumber(t.estimateMs)
        ? [{ runId: t.runId, estimateMs: t.estimateMs }]
        : [],
    ),
  };
}

/**
 * Records an edit `tier` that started at `grant` workers: the tier size, its files' projects'
 * widths and parts, its revision's first start when none is recorded for it, and its run's
 * estimate. Any other kind records nothing. Row 005-96: `startTier` calls it last in the
 * transaction that starts the tier, so the record commits with the start and no second lock
 * turn stands between that commit and the flight (review 0.1.530-r2 R2-B1). Its own write is a
 * savepoint there; it never throws: a write that fails rolls back to the savepoint and loses
 * this tier's sample, and the start commits. The first start is the tier's own start stamp
 * (`newTier`'s `startedAt`, row 011-372); it reads no clock.
 */
export function recordEditTier(context: SchedulerContext, tier: Tier, grant: number): void {
  if (tier.kind !== "edit" || tier.startedAt === undefined) return;
  const startedAt = tier.startedAt;
  try {
    context.store.transaction(() => write(context, tier, startedAt, grant));
  } catch {
    // The sample is lost; the tier's start is not (contract need 2).
  }
}

/** `recordEditTier`'s read and write of the row. */
function write(context: SchedulerContext, tier: Tier, startedAt: number, grant: number): void {
  const { store, worktreeId } = context;
  const traits = context.runner.traits;
  const tierSize = context.policy.runner.tierSize;
  const was = readEditTimings(store, worktreeId);
  const widths = { ...was?.widths };
  for (const { file } of tier.files) {
    widths[file.ref.project] = {
      width: traits.tierWidth(file.ref, tierSize),
      part: traits.tierPart(file.ref),
    };
  }
  const revision = tier.revision.number;
  const createdAt = store.revisions.get(worktreeId, revision)?.createdAt;
  const firsts = was?.firsts ?? [];
  const first =
    createdAt === undefined || firsts.some((f) => f.revision === revision)
      ? []
      : [{ revision, delayMs: Math.max(0, startedAt - createdAt) }];
  const next: EditTimings = {
    tierSize,
    widths,
    firsts: [...first, ...firsts].slice(0, TIMINGS_KEPT),
    tiers: [
      { runId: tier.runId, estimateMs: estimateMs(traits, tier.files, grant) },
      ...(was?.tiers ?? []),
    ].slice(0, TIMINGS_KEPT),
  };
  store.meta.set(editTimingsMetaKey(worktreeId), JSON.stringify(next));
}
