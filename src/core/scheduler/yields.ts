import {
  type CancelCause,
  type CheckKey,
  type EpochMs,
  type Revision,
  type Store,
  type TierYield,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";
import { cancelsBacklog } from "./backlog.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";
import { SHARE_FLOOR_MS } from "./sharing.js";
import { laneOf, type Tier, type TierFile } from "./tiers.js";

/**
 * A running tier yields only when its estimated remainder exceeds this (spec
 * 011 C4 step 5 as amended 2026-10-21; the human chose rule B at 30 s, row
 * 001-381, `research/running-tier-yields.md`: on cezar's 6.5 days, 82% of
 * the time edits waited for a tier and 52% of named waits' went, for 4,454
 * file-seconds run again), or once it has run this long past its estimate
 * (row 011-107, gh-73: a stale, short estimate never yielded; `overruns`).
 */
export const YIELD_REMAINDER_MS = 30_000;

/**
 * What C4 step 5 does with a tier in flight now: cancel it for one of the
 * causes it names (row 011-56), a yield among them, or what it says.
 */
type Decision = Extract<CancelCause, "supersession" | "backlog" | "yield"> | TierYield | null;

/**
 * Spec 011 C4 step 5 as amended 2026-10-21 (row 011-51): which fast tiers in
 * flight a revision, a runner part or a promotion cancels, the files a yield
 * cut, and what each tier in flight does for a promoted file's wait,
 * published for status in one `yields` meta row of the worktree (C15).
 */
export class TierYields {
  /**
   * The key a yield cut each file at and its `resultsApplied` then, by
   * `testFileId`, until a result lands at that key after the cut or its key
   * moves. A forced file already has a result at its key when it is cut, so
   * `resultKey` alone would end the mark at once (review `reviews/0.1.237.md`).
   */
  readonly #cut = new Map<string, { key: CheckKey; applied: number }>();
  /** What each tier in flight does for a wait in its lane, by run id, as last published. */
  readonly #standing = new Map<string, TierYield>();
  /**
   * When each tier in flight that a wait waits for yields at the latest,
   * `YIELD_REMAINDER_MS` past its estimate (row 011-107), by run id.
   */
  readonly #bounds = new Map<string, EpochMs>();
  /** The one timer that checks the tiers again at the earliest of `#bounds`. */
  #timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * `recheck` checks the tiers in flight again under the scheduler's lock,
   * as an event does: a tier reaches its bound with no event (row 011-107).
   */
  constructor(private readonly recheck: () => void = () => {}) {}

  /**
   * Cancels each of `tiers` that C4 step 5 cancels after `revision`, the
   * revision just stored (`null`: a runner part applied, a promotion came or
   * a file ended):
   * - any, when the revisions during its run changed an input of every file
   *   of it that has not ended, whose results the stability check would
   *   discard;
   * - a backlog tier, as `cancelsBacklog` says;
   * - any but the backlog's turn yields, once per file and key, while an
   *   edit's work that came during its run or a promoted file is queued in
   *   its lane, or `revision` makes the lane's runner part wait for the run,
   *   when its estimated remainder exceeds `YIELD_REMAINDER_MS` or, as
   *   `overruns` allows, it has run that long past its estimate (row
   *   011-107); one that does not yet is checked again at that bound.
   * A file has ended when the runner named it (`Tier.ended`, row 011-54,
   * review `reviews/0.1.237.md` B2); a runner that names none leaves every
   * file unfinished, so its tier is cancelled by the first rule only when
   * every file of it was re-keyed. A backlog tier cancelled by either of the
   * first two rules starts its lane's wait for quiet (`BacklogQuiet`, row
   * 011-82); a backlog slot, whose runner cannot cancel, starts none.
   */
  check(
    context: SchedulerContext,
    ledger: Ledger,
    tiers: readonly Tier[],
    revision: Revision | null,
  ): void {
    this.#forget(ledger);
    let changed = false;
    for (const tier of tiers) {
      const decision = this.#decide(context, ledger, tier, revision);
      if (typeof decision === "string") {
        if (decision === "yield")
          for (const { file, key } of unfinished(tier))
            this.#cut.set(file.id, { key, applied: file.resultsApplied });
        else if (tier.kind === "backlog" && tier.slot !== true)
          context.quiet?.cancelled(tier.lane, context.now());
        tier.cancel?.abort(decision);
      }
      const standing = typeof decision === "string" ? { kind: "yields" as const } : decision;
      changed = this.#set(tier.runId, standing) || changed;
      const bound = typeof decision === "string" ? null : boundOf(context, tier, decision);
      if (bound === null) this.#bounds.delete(tier.runId);
      else this.#bounds.set(tier.runId, bound);
    }
    if (changed) this.#publish(context);
    this.#arm(context);
  }

  /** `tier` is no longer in flight: its standing and its bound go. */
  ended(context: SchedulerContext, tier: Tier): void {
    if (this.#standing.delete(tier.runId)) this.#publish(context);
    if (this.#bounds.delete(tier.runId)) this.#arm(context);
  }

  /** The scheduler closed: no check comes again. */
  close(): void {
    this.#bounds.clear();
    this.#disarm();
  }

  #decide(
    context: SchedulerContext,
    ledger: Ledger,
    tier: Tier,
    revision: Revision | null,
  ): Decision {
    const { cancel } = tier;
    if (tier.kind === "slow") return null;
    if (cancel?.signal.aborted === true) return { kind: "yields" };
    if (cancel !== null && superseded(tier)) return "supersession";
    if (tier.kind === "backlog" && cancel !== null) {
      if (cancelsBacklog(context, ledger, revision, tier)) return "backlog";
    }
    if (!waitedFor(context, ledger, tier, revision)) return null;
    if (cancel === null || tier.slot === true) return { kind: "runner" };
    if (tier.kind === "turn") return { kind: "turn" };
    if (unfinished(tier).some(({ file, key }) => this.#cut.get(file.id)?.key === key))
      return { kind: "cut" };
    const remainderMs = remainder(context, tier);
    if (remainderMs > YIELD_REMAINDER_MS) return "yield";
    if (remainderMs >= 0 || !overruns(tier)) return { kind: "remainder", remainderMs };
    if (-remainderMs >= YIELD_REMAINDER_MS) return "yield";
    return { kind: "overrun", yieldsAt: context.now() + remainderMs + YIELD_REMAINDER_MS };
  }

  /** Sets the one timer at the earliest bound, none without a bound; unref'd, it never holds the process. */
  #arm(context: SchedulerContext): void {
    this.#disarm();
    if (this.#bounds.size === 0) return;
    const ms = Math.max(0, Math.min(...this.#bounds.values()) - context.now());
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.recheck();
    }, ms);
    this.#timer.unref();
  }

  #disarm(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** Drops the marks of files whose result landed at the key cut after the cut, or whose key moved. */
  #forget(ledger: Ledger): void {
    for (const [id, cut] of this.#cut) {
      const file = ledger.files.get(id);
      const landed = file?.resultKey === cut.key && file.resultsApplied > cut.applied;
      if (file === undefined || file.key !== cut.key || landed) this.#cut.delete(id);
    }
  }

  /** Records `standing` for `runId`; whether it changed. */
  #set(runId: string, standing: TierYield | null): boolean {
    const was = this.#standing.get(runId);
    if (standing === null) return this.#standing.delete(runId);
    if (was !== undefined && JSON.stringify(was) === JSON.stringify(standing)) return false;
    this.#standing.set(runId, standing);
    return true;
  }

  #publish(context: SchedulerContext): void {
    const { store, worktreeId } = context;
    const key = yieldsMetaKey(worktreeId);
    if (this.#standing.size === 0) store.meta.delete(key);
    else {
      const tiers = Object.fromEntries(this.#standing);
      store.meta.set(key, JSON.stringify({ at: context.now(), tiers }));
    }
  }
}

/** The files of `tier` whose module has not ended, as far as the runner said (`Tier.ended`). */
function unfinished(tier: Tier): TierFile[] {
  const { ended } = tier;
  if (ended === undefined || ended.size === 0) return [...tier.files];
  return tier.files.filter(({ file }) => !ended.has(file.id));
}

/**
 * The revisions during its run changed an input of every file of `tier`
 * that has not ended (`Tier.changes`); a tier whose files have all ended
 * is never superseded, its run is over.
 */
function superseded(tier: Tier): boolean {
  if (tier.changes.size === 0) return false;
  const left = unfinished(tier);
  return left.length > 0 && left.every((f) => f.inputs.some((path) => tier.changes.has(path)));
}

/**
 * Something waits for `tier` in its lane: an edit's work queued by a
 * revision after the one it was selected at, a promoted file (C15), or
 * `revision` changed an environment input of a project of the lane, whose
 * runner part then waits for the run to recreate the runner (Vitest's
 * `Gate`; #69: "revision 5 not listed yet").
 */
function waitedFor(
  context: SchedulerContext,
  ledger: Ledger,
  tier: Tier,
  revision: Revision | null,
): boolean {
  const inLane = (ref: Parameters<typeof laneOf>[1]) => laneOf(context, ref) === tier.lane;
  const { queue } = ledger;
  if (queue.hasRecentAfter(tier.revision.number, inLane) || queue.hasPromoted(inLane)) return true;
  return revision !== null && recreates(context, ledger, revision, tier.lane);
}

/** `revision` changed an environment input of a project with a test file in `lane`. */
function recreates(
  context: SchedulerContext,
  ledger: Ledger,
  revision: Revision,
  lane: string,
): boolean {
  const { keys } = context;
  const inputs = revision.changes
    .map((c) => c.path)
    .filter((path) => keys.isEnvironmentInput(path));
  if (inputs.length === 0) return false;
  const seen = new Set<string>();
  for (const { ref } of ledger.files.values()) {
    if (seen.has(ref.project) || laneOf(context, ref) !== lane) continue;
    seen.add(ref.project);
    const paths = new Set(keys.stabilityPaths(ref));
    if (inputs.some((path) => paths.has(path))) return true;
  }
  return false;
}

/**
 * The tier's estimated remainder: the largest last-known duration among
 * its files that have not ended, a file with none counting 0, less the time
 * it has run. Negative past its estimate.
 */
function remainder(context: SchedulerContext, tier: Tier): number {
  const longest = Math.max(0, ...unfinished(tier).map(({ file }) => file.durationMs ?? 0));
  return longest - (context.now() - (tier.startedAt ?? context.now()));
}

/**
 * Whether `tier` may yield past its estimate (row 011-107): it has a file
 * left to cut, as `superseded` needs, and every file it would cut has a
 * last-known duration of at least `SHARE_FLOOR_MS`, a file with none
 * counting 0. A cut file runs again from its start, and one under the floor
 * shares the promoted file's next tier (`joinSpan`), whose result then waits
 * for it; row 011-112 keeps cut files apart and ends this hold.
 */
function overruns(tier: Tier): boolean {
  const left = unfinished(tier);
  return left.length > 0 && left.every(({ file }) => (file.durationMs ?? 0) >= SHARE_FLOOR_MS);
}

/**
 * When a tier that does not yield for `decision` yields at the latest,
 * `YIELD_REMAINDER_MS` past its estimate (row 011-107); `null` when nothing
 * but an event changes it: a cut, the backlog's turn, a runner that does
 * not cancel, nothing waiting, or a tier `overruns` holds.
 */
function boundOf(
  context: SchedulerContext,
  tier: Tier,
  decision: TierYield | null,
): EpochMs | null {
  if (decision?.kind === "overrun") return decision.yieldsAt;
  if (decision?.kind !== "remainder" || !overruns(tier)) return null;
  return context.now() + decision.remainderMs + YIELD_REMAINDER_MS;
}

/** `meta` key of `worktreeId`'s tiers in flight and whether each yields: `{ at, tiers }`. */
export function yieldsMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("yields", worktreeId);
}

/**
 * What the daemon started at `daemonStartedAt` published of its tiers in
 * flight, by run id; none without a row, as from a daemon older than row
 * 011-51, or with a predecessor's.
 */
export function publishedYields(
  store: Store,
  worktreeId: WorktreeId,
  daemonStartedAt: EpochMs,
): ReadonlyMap<string, TierYield> {
  const raw = store.meta.get(yieldsMetaKey(worktreeId));
  if (raw === null) return new Map();
  try {
    const { at, tiers } = JSON.parse(raw) as { at?: unknown; tiers?: unknown };
    if (typeof at !== "number" || at < daemonStartedAt) return new Map();
    if (typeof tiers !== "object" || tiers === null) return new Map();
    return new Map(
      Object.entries(tiers).filter((entry): entry is [string, TierYield] => isYield(entry[1])),
    );
  } catch {
    return new Map();
  }
}

function isYield(value: unknown): value is TierYield {
  if (typeof value !== "object" || value === null) return false;
  const { kind, remainderMs, yieldsAt } = value as {
    kind?: unknown;
    remainderMs?: unknown;
    yieldsAt?: unknown;
  };
  if (kind === "remainder") return typeof remainderMs === "number";
  if (kind === "overrun") return typeof yieldsAt === "number";
  return kind === "yields" || kind === "cut" || kind === "turn" || kind === "runner";
}
