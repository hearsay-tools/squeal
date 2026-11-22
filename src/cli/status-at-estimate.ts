import { readMarks } from "../core/capacity/marks.js";
import { type Demand, fairShares } from "../core/capacity/share.js";
import { estimateRun, loadFactor } from "../core/code/gate/estimate.js";
import { loadUserConfig } from "../core/daemon/user-config.js";
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
 */

/** A side's rate counts once this call saw this many results arrive there. */
export const MEASURED_LEAST = 10;

/** What one side still has to run, and what this call measured there. */
export interface SideWork {
  /** Each file's stored seconds, `null` without one: this call's files still running, and the rest ahead. */
  readonly seconds: readonly (number | null)[];
  /** Results that arrived on this side during the call, over `ms`; `null`: not measured (a join). */
  readonly measured: { readonly done: number; readonly ms: number } | null;
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
}

/** The pool now: `capacity.hostSlots` and the fresh marks of daemons with work, but `own`. */
export function readPoolView(env: NodeJS.ProcessEnv, own: readonly string[]): PoolView {
  const slots = loadUserConfig({ env }).config.capacity.hostSlots;
  const marks = readMarks(slowSlotDir(env) as AbsolutePath, "" as WorktreeId, Date.now());
  const others = marks.filter((m) => m.want > 0 && !own.includes(m.id));
  return { slots, others };
}

/** Each side's share of the pool, `ids` its daemon (or `null`: none), `wants` its files to run. */
export function widthsOf(
  pool: PoolView,
  sides: readonly { readonly id: string | null; readonly want: number }[],
): number[] {
  const ours = sides.flatMap((side, i) =>
    side.id === null || side.want === 0
      ? []
      : [{ id: `${i}:${side.id}`, want: side.want, since: null }],
  );
  const shares = fairShares(pool.slots, [...pool.others, ...ours]);
  return sides.map((side, i) => Math.max(1, shares.get(`${i}:${side.id}`) ?? 1));
}

/** One side's estimate; `null` when it has nothing still to run. */
export function estimateSide(
  work: SideWork,
  width: number,
  factor: number | null,
): SideEstimate | null {
  const files = work.seconds.length;
  if (files === 0) return null;
  const known = work.seconds.filter((s) => s !== null).length;
  const { measured } = work;
  if (measured !== null && measured.done >= MEASURED_LEAST && measured.ms > 0) {
    const seconds = Math.ceil((files * measured.ms) / 1000 / measured.done);
    const rate = { done: measured.done, seconds: Math.round(measured.ms / 1000) };
    return { files, width, seconds, basis: "measured", known, rate };
  }
  const run = estimateRun("vitest", [{ width, seconds: work.seconds }]);
  if (run.seconds === null) return { files, width, seconds: null, basis: "unknown", known };
  const basis = known * 2 < files ? "guess" : "durations";
  if (factor === null) return { files, width, seconds: run.seconds, basis, known };
  return { files, width, seconds: Math.ceil(run.seconds * factor), basis, known, load: factor };
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
  const width = `up to ${e.width} at once`;
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
