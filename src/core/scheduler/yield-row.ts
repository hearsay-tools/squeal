import type { EpochMs, LastYield, TestFileRef, TierYield } from "../types/index.js";

/*
 * Row 011-51, widened by row 011-209 (`research/issue-91.md` F2 to F4): the
 * value of the one `yields` meta row a daemon publishes for status
 * (`yieldsMetaKey`, `TierYields`). `tiers` since 011-51; `ended`, `last` and
 * `lanes` are additive keys, which an older reader leaves alone. Status
 * trusts the row only from the live daemon: a predecessor's row says
 * nothing, so a restart keeps no yield.
 */

/** What the daemon started at a given time published in its `yields` row. */
export interface YieldRow {
  /** What each tier in flight does for a wait in its lane, by run id (row 011-51). */
  readonly tiers: ReadonlyMap<string, TierYield>;
  /** How many test files of each tier in flight the runner named ended, by run id (F4). */
  readonly ended: ReadonlyMap<string, number>;
  /** Its last yield, until a later tier that holds a cut file ends (F2). */
  readonly last: LastYield | null;
  /**
   * A file of the first tier of this daemon that ended in each lane, by the
   * daemon's lane name (rule C, `tasks/011-209/notes.md`).
   */
  readonly lanes: ReadonlyMap<string, TestFileRef>;
}

/** A row that says nothing: none, a predecessor's, or one that does not read. */
export const NO_YIELD_ROW: YieldRow = {
  tiers: new Map(),
  ended: new Map(),
  last: null,
  lanes: new Map(),
};

/** The row's text as of `at`; `null` when it says nothing, so the row goes. */
export function yieldRowText(at: EpochMs, row: YieldRow): string | null {
  const { tiers, ended, last, lanes } = row;
  if (tiers.size === 0 && ended.size === 0 && last === null && lanes.size === 0) return null;
  return JSON.stringify({
    at,
    tiers: Object.fromEntries(tiers),
    ...(ended.size === 0 ? {} : { ended: Object.fromEntries(ended) }),
    ...(last === null ? {} : { last }),
    ...(lanes.size === 0 ? {} : { lanes: Object.fromEntries(lanes) }),
  });
}

/**
 * The row `raw` says, as the daemon started at `daemonStartedAt` wrote it;
 * `NO_YIELD_ROW` without a row, as from a daemon older than row 011-51, with
 * a predecessor's, or with one that does not read.
 */
export function readYieldRow(raw: string | null, daemonStartedAt: EpochMs): YieldRow {
  if (raw === null) return NO_YIELD_ROW;
  try {
    const row = JSON.parse(raw) as {
      at?: unknown;
      tiers?: unknown;
      ended?: unknown;
      last?: unknown;
      lanes?: unknown;
    };
    if (typeof row.at !== "number" || row.at < daemonStartedAt) return NO_YIELD_ROW;
    if (typeof row.tiers !== "object" || row.tiers === null) return NO_YIELD_ROW;
    return {
      tiers: new Map(
        Object.entries(row.tiers).filter((e): e is [string, TierYield] => isYield(e[1])),
      ),
      ended: new Map(entriesOf(row.ended).filter((e): e is [string, number] => isCount(e[1]))),
      last: isLastYield(row.last) ? row.last : null,
      lanes: new Map(entriesOf(row.lanes).filter((e): e is [string, TestFileRef] => isRef(e[1]))),
    };
  } catch {
    return NO_YIELD_ROW;
  }
}

function entriesOf(value: unknown): [string, unknown][] {
  return typeof value === "object" && value !== null ? Object.entries(value) : [];
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
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
  return (
    kind === "yields" || kind === "cut" || kind === "turn" || kind === "runner" || kind === "named"
  );
}

function isLastYield(value: unknown): value is LastYield {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<Record<keyof LastYield, unknown>>;
  return (
    typeof v.at === "number" &&
    typeof v.runId === "string" &&
    (v.to === "edit" || v.to === "promoted" || v.to === "runner") &&
    (v.rule === "remainder" || v.rule === "overrun") &&
    typeof v.remainderMs === "number" &&
    typeof v.lane === "string" &&
    Array.isArray(v.files) &&
    v.files.every(isRef) &&
    typeof v.runStartedAt === "number" &&
    (v.runEndedAt === null || typeof v.runEndedAt === "number")
  );
}

function isRef(value: unknown): value is TestFileRef {
  if (typeof value !== "object" || value === null) return false;
  const { project, path } = value as { project?: unknown; path?: unknown };
  return typeof project === "string" && typeof path === "string";
}
