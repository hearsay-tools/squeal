import { readMarks } from "../core/capacity/marks.js";
import { type Demand, fairShares } from "../core/capacity/share.js";
import { loadFactor, median } from "../core/code/gate/estimate.js";
import { loadUserConfig, resolveCapacity } from "../core/daemon/user-config.js";
import { hostLoad } from "../core/retry/load.js";
import { slowSlotDir } from "../core/slow/slot.js";
import type { AbsolutePath, WorktreeId } from "../core/types/common.js";

/*
 * Row 023-49 (dogfood round 6, V2; spec 023 D7.3): the time what still
 * runs takes, per side. Round 6 told "about 3 to 11 min, up to 11 at once"
 * for 1,338 files; the parent side took about an hour (90 to 157 results
 * in 320 to 400 s), because its commit daemon and the worktree's daemon,
 * and other sessions' daemons, share one pool of 11 permits, and a loaded
 * host runs each file slower than its stored duration. So each side is
 * estimated alone:
 *
 * - from this call's own rate when it saw at least `MEASURED_LEAST`
 *   results arrive on that side: it holds the pool's share and the load;
 * - else from the files' stored durations (a file without one counts at
 *   their median), run up to the side's fair share of the pool at once
 *   (`fairShares` over the daemons with work now, as the pool divides it),
 *   times the host's load per CPU above 1 (row 020-57's factor);
 * - and it says when it is a guess: fewer than half the files have a
 *   stored duration, or (unknown) none has and nothing was measured.
 *
 * Review 0.1.599 B3: the pool share is not the width the daemon runs at.
 * Each group's files run at most its own width (`WorkGroup.cap`: its
 * `maxParallel`, which both sides' files of the group share, or a gated
 * group's tier size), and a project the user caps (`capacity.projects`)
 * shares its slots among its daemons. A side's time is the longer of its
 * whole work over its pool share and each group's work over the group's
 * width. Review 0.1.599 N1: a measured rate is never below the longest
 * file still to run.
 */

/** A side's rate counts once this call saw this many results arrive there. */
export const MEASURED_LEAST = 10;

/** One group's files still to run on a side, with the limits the daemon runs them at. */
export interface WorkGroup {
  /** Each file's stored seconds, `null` without one. */
  readonly seconds: readonly (number | null)[];
  /** The most of the group's files that run at once whatever the pool gives; `null`: no such limit. */
  readonly cap: number | null;
  /** Pool workers each file takes (the group's `maxWorkers`, else 1). */
  readonly perFile: number;
  /** The other side's files that hold the same `maxParallel` slot, by stored seconds. */
  readonly shared: readonly (number | null)[];
}

/** What one side still has to run, and what this call measured there. */
export interface SideWork {
  /** This call's files still running, and the rest ahead, per group. */
  readonly groups: readonly WorkGroup[];
  /** Results that arrived on this side during the call, over `ms`; `null`: not measured (a join). */
  readonly measured: { readonly done: number; readonly ms: number } | null;
  /** The side's groups and their limits could not be read (its tree is gone): the width is a guess. */
  readonly limitsUnknown?: boolean;
}

/** One group of `seconds` with no limit of its own: what a side without groups runs. */
export function oneGroup(seconds: readonly (number | null)[]): WorkGroup {
  return { seconds, cap: null, perFile: 1, shared: [] };
}

/** One side's estimate: `run.estimate.commit` and `run.estimate.now` in JSON. */
export interface SideEstimate {
  /** The files still to run there. */
  readonly files: number;
  /** The most of them that run at once: the side's share of the pool. */
  readonly width: number;
  /** Whole seconds, rounded up; `null` when unknown. */
  readonly seconds: number | null;
  /**
   * `measured`: this call's rate there; `durations`: stored durations, most
   * files have one; `guess`: fewer than half have one, the others count at
   * their median; `unknown`: none has, and nothing was measured.
   */
  readonly basis: "measured" | "durations" | "guess" | "unknown";
  /** Of the files, those with a stored duration. */
  readonly known: number;
  /** With `measured`: the results that arrived and the seconds they took. */
  readonly rate?: { readonly done: number; readonly seconds: number };
  /** With `durations` or `guess`: the host's load per CPU the time was multiplied by (over 1). */
  readonly load?: number;
  /** Review 0.1.599 B3: the side's group limits were not read; its width assumes none. */
  readonly limits?: "unknown";
}

/** The call's estimate per side; a side with nothing still to run is `null`. */
export interface CallEstimate {
  readonly commit: SideEstimate | null;
  readonly now: SideEstimate | null;
}

/** The user's pool as the daemons divide it: its permits and the other daemons' demands. */
export interface PoolView {
  readonly slots: number;
  readonly others: readonly Demand[];
  /** Review 0.1.599 B3: the repository's cap, which both of this call's daemons share. */
  readonly project?: { readonly id: string; readonly slots: number };
}

/**
 * The pool now: `capacity.hostSlots`, the repository's `capacity.projects`
 * cap as its daemons read it (`repository`, `repositoryRootOf`), and the
 * fresh marks of daemons with work, but `own`.
 */
export function readPoolView(
  env: NodeJS.ProcessEnv,
  own: readonly string[],
  repository?: AbsolutePath,
): PoolView {
  const { config } = loadUserConfig({ env });
  const slots = config.capacity.hostSlots;
  const marks = readMarks(slowSlotDir(env) as AbsolutePath, "" as WorktreeId, Date.now());
  const others = marks.filter((m) => m.want > 0 && !own.includes(m.id));
  const projectSlots =
    repository === undefined ? undefined : resolveCapacity(config, repository).projectSlots;
  if (projectSlots === undefined || repository === undefined) return { slots, others };
  return { slots, others, project: { id: repository, slots: projectSlots } };
}

/** Each side's share of the pool, `ids` its daemon (or `null`: none), `wants` its files to run. */
export function widthsOf(
  pool: PoolView,
  sides: readonly { readonly id: string | null; readonly want: number }[],
): number[] {
  const project = pool.project === undefined ? {} : { project: pool.project };
  const ours = sides.flatMap((side, i) =>
    side.id === null || side.want === 0
      ? []
      : [{ id: `${i}:${side.id}`, want: side.want, since: null, ...project }],
  );
  const shares = fairShares(pool.slots, [...pool.others, ...ours]);
  return sides.map((side, i) => Math.max(1, shares.get(`${i}:${side.id}`) ?? 1));
}

/** One side's estimate at its pool share `width`; `null` when it has nothing still to run. */
export function estimateSide(
  work: SideWork,
  width: number,
  factor: number | null,
): SideEstimate | null {
  const all = work.groups.flatMap((g) => g.seconds);
  const files = all.length;
  if (files === 0) return null;
  const known = all.filter((s) => s !== null).length;
  const limits = work.limitsUnknown === true ? { limits: "unknown" as const } : {};
  const runs = work.groups.filter((g) => g.seconds.length > 0);
  const atOnce = (g: WorkGroup) => Math.min(g.seconds.length, groupWidth(g, width));
  const wide = Math.max(
    1,
    Math.min(
      width,
      runs.reduce((sum, g) => sum + atOnce(g), 0),
    ),
  );
  const longest = Math.max(0, ...all.map((s) => s ?? 0));
  const { measured } = work;
  if (measured !== null && measured.done >= MEASURED_LEAST && measured.ms > 0) {
    const rated = Math.ceil((files * measured.ms) / 1000 / measured.done);
    // N1: short files first leave a long one; it takes its own time whatever the rate.
    const seconds = Math.max(rated, Math.ceil(longest * (factor ?? 1)));
    const rate = { done: measured.done, seconds: Math.round(measured.ms / 1000) };
    return { files, width: wide, seconds, basis: "measured", known, rate, ...limits };
  }
  const run = groupedSeconds(runs, width);
  if (run === null)
    return { files, width: wide, seconds: null, basis: "unknown", known, ...limits };
  const basis = known * 2 < files ? "guess" : "durations";
  const at = { files, width: wide, basis, known, ...limits } as const;
  if (factor === null) return { ...at, seconds: run };
  return { ...at, seconds: Math.ceil(run * factor), load: factor };
}

/** The files of `group` that run at once at a pool share of `width`. */
function groupWidth(group: WorkGroup, width: number): number {
  const byPool = Math.max(1, Math.floor(width / group.perFile));
  return Math.max(1, Math.min(group.cap ?? byPool, byPool));
}

/**
 * The seconds `groups` take at a pool share of `width`, a file without a
 * stored duration at the median of the stored ones; `null` when none has.
 * The groups run beside each other, so the side takes the longer of all
 * their work over the share and each group's own time: its longest file,
 * its work over its width, and, for a shared `maxParallel` slot, both
 * sides' work of it over the slot.
 */
function groupedSeconds(groups: readonly WorkGroup[], width: number): number | null {
  const middle = median(
    groups.flatMap((g) => [...g.seconds, ...g.shared]).filter((s): s is number => s !== null),
  );
  if (middle === null) return null;
  const sum = (list: readonly (number | null)[]) =>
    list.reduce<number>((a, s) => a + (s ?? middle), 0);
  let pool = 0;
  let slowest = 0;
  for (const group of groups) {
    const own = sum(group.seconds);
    pool += own * group.perFile;
    const longest = Math.max(0, ...group.seconds.map((s) => s ?? middle));
    const slot =
      group.cap === null || group.shared.length === 0 ? 0 : (own + sum(group.shared)) / group.cap;
    slowest = Math.max(slowest, longest, own / groupWidth(group, width), slot);
  }
  return Math.ceil(Math.max(pool / Math.max(1, width), slowest));
}

/** The host's load factor now (row 020-57): its one-minute load per CPU, when over 1. */
export const loadNow = (): number | null => loadFactor(hostLoad());

/** `about 58 min`, `about 40 s`, `about 2.5 h`. */
export function timeText(seconds: number): string {
  if (seconds < 120) return `about ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `about ${minutes} min`;
  return `about ${Math.round(minutes / 6) / 10} h`;
}

/** One side's part of the line: `about 58 min for 1248 files, at this call's rate (90 results in 98 s)`. */
export function sideText(e: SideEstimate): string {
  const files = `${e.files} test file${e.files === 1 ? "" : "s"}`;
  if (e.seconds === null)
    return `${files}, time unknown: none has a stored duration and this call measured no rate`;
  const time = `${timeText(e.seconds)} for ${files}`;
  if (e.basis === "measured" && e.rate !== undefined)
    return `${time}, at this call's rate there (${e.rate.done} results in ${e.rate.seconds} s)`;
  const load = e.load === undefined ? "" : `, times ${e.load} for the host's load per CPU`;
  const unknown = e.limits === "unknown" ? " (its group limits not read)" : "";
  const width = `up to ${e.width} at once${unknown}`;
  if (e.basis === "guess")
    return `${time}, ${width}${load}; a guess: ${e.known} of them have a stored duration, the others count at their median`;
  return `${time}, ${width}, from their stored durations${load}`;
}

/** V2's line, `null` when nothing still runs: each side named, and how to narrow a wide call. */
export function estimateLine(
  estimate: CallEstimate | undefined,
  at: string,
  narrow: string | null,
): string | null {
  if (estimate === undefined) return null;
  const parts: string[] = [];
  if (estimate.commit !== null) parts.push(`at ${at}: ${sideText(estimate.commit)}`);
  if (estimate.now !== null) parts.push(`in the working tree: ${sideText(estimate.now)}`);
  if (parts.length === 0) return null;
  const tail = narrow === null ? "" : `; name test files or folders to narrow it: ${narrow}`;
  return `Still to run, ${parts.join("; ")}${tail}`;
}
