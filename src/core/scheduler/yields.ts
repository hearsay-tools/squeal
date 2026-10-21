import {
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
import { laneOf, type Tier } from "./tiers.js";

/**
 * A running tier yields only when its estimated remainder exceeds this (spec
 * 011 C4 step 5 as amended 2026-10-21; the human chose rule B at 30 s, row
 * 001-381, `research/running-tier-yields.md`: on cezar's 6.5 days, 82% of
 * the time edits waited for a tier and 52% of named waits' went, for 4,454
 * file-seconds run again).
 */
export const YIELD_REMAINDER_MS = 30_000;

/** What C4 step 5 does with a tier in flight now: cancel it, cut it as a yield, or what it says. */
type Decision = "cancel" | "yield" | TierYield | null;

/**
 * Spec 011 C4 step 5 as amended 2026-10-21 (row 011-51): which fast tiers in
 * flight a revision, a runner part or a promotion cancels, the files a yield
 * cut, and what each tier in flight does for a promoted file's wait,
 * published for status in one `yields` meta row of the worktree (C15).
 */
export class TierYields {
  /** The key a yield cut each file at, by `testFileId`, until its result lands or its key moves. */
  readonly #cut = new Map<string, CheckKey>();
  /** What each tier in flight does for a wait in its lane, by run id, as last published. */
  readonly #standing = new Map<string, TierYield>();

  /**
   * Cancels each of `tiers` that C4 step 5 cancels after `revision`, the
   * revision just stored (`null`: a runner part applied or a promotion came):
   * - any, when the revisions during its run changed an input of every file
   *   of it, whose results the stability check would discard;
   * - a backlog tier, as `cancelsBacklog` says;
   * - any but the backlog's turn yields, once per file and key, while an
   *   edit's work that came during its run or a promoted file is queued in
   *   its lane, or `revision` makes the lane's runner part wait for the run,
   *   when its estimated remainder exceeds `YIELD_REMAINDER_MS`.
   * The scheduler cannot see which modules of a run have ended, so every
   * file of a tier counts as unfinished.
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
      if (decision === "cancel" || decision === "yield") {
        if (decision === "yield")
          for (const { file, key } of tier.files) this.#cut.set(file.id, key);
        tier.cancel?.abort();
      }
      const standing = typeof decision === "string" ? { kind: "yields" as const } : decision;
      changed = this.#set(tier.runId, standing) || changed;
    }
    if (changed) this.#publish(context);
  }

  /** `tier` is no longer in flight: its standing goes. */
  ended(context: SchedulerContext, tier: Tier): void {
    if (this.#standing.delete(tier.runId)) this.#publish(context);
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
    if (cancel !== null && superseded(tier)) return "cancel";
    if (tier.kind === "backlog" && cancel !== null) {
      if (cancelsBacklog(context, ledger, revision, tier)) return "cancel";
    }
    if (!waitedFor(context, ledger, tier, revision)) return null;
    if (cancel === null || tier.slot === true) return { kind: "runner" };
    if (tier.kind === "turn") return { kind: "turn" };
    if (tier.files.some(({ file, key }) => this.#cut.get(file.id) === key)) return { kind: "cut" };
    const remainderMs = remainder(context, tier);
    return remainderMs > YIELD_REMAINDER_MS ? "yield" : { kind: "remainder", remainderMs };
  }

  /** Drops the marks of files whose result landed at the key cut, or whose key moved. */
  #forget(ledger: Ledger): void {
    for (const [id, key] of this.#cut) {
      const file = ledger.files.get(id);
      if (file === undefined || file.key !== key || file.resultKey === key) this.#cut.delete(id);
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

/** The revisions during its run changed an input of every file of `tier` (`Tier.changes`). */
function superseded(tier: Tier): boolean {
  return tier.files.every((f) => f.inputs.some((path) => tier.changes.has(path)));
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
 * The tier's estimated remainder: the largest last-known duration among its
 * files, a file with none counting 0, less the time it has run.
 */
function remainder(context: SchedulerContext, tier: Tier): number {
  const longest = Math.max(0, ...tier.files.map(({ file }) => file.durationMs ?? 0));
  return longest - (context.now() - (tier.startedAt ?? context.now()));
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
  const { kind, remainderMs } = value as { kind?: unknown; remainderMs?: unknown };
  if (kind === "remainder") return typeof remainderMs === "number";
  return kind === "yields" || kind === "cut" || kind === "turn" || kind === "runner";
}
