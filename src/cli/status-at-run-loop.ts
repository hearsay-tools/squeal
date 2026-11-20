import { testFileId } from "../core/keys/reverse-index.js";
import { groupView } from "../core/scheduler/slow.js";
import type { RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { Policy } from "../core/types/policy.js";
import type { SideState } from "./status-at-report.js";
import { Batches, type BatchTime, stopMargin } from "./status-at-run-batches.js";
import type { RunAnswer } from "./status-at-run-child.js";
import { lotOf, type SetupFailure, setupVerdict } from "./status-at-run-setup.js";

/*
 * Row 023-19 (P3), moved here by row 023-29: `--run`'s selection in
 * batches of whole paths, one gate child each, until the side's budget
 * ends. Each batch's gate gets the time left but a margin; its group is
 * stopped at the budget's end. A batch that answered is read back and
 * kept whatever a later one does; the files no batch started read `not
 * run (budget)`. Row 023-29 (R3): a batch holds one lot (`lotOf`: a group
 * that runs only on request, or every other file), and a runner whose
 * setup failed in a batch marks its files `not run (setup)` and runs no
 * later file of that group. Both sides use it: the commit's checkout
 * (`status-at-run.ts`) and the working tree with no daemon
 * (`status-at-run-now.ts`).
 */

export interface BatchLoop<F> {
  readonly files: readonly F[];
  readonly refOf: (file: F) => TestFileRef;
  /** The tree's policy: its groups give the lots and name a failed setup. */
  readonly policy: Policy;
  /** The call's whole budget, which sizes a batch's aim (`Batches`). */
  readonly timeoutSeconds: number;
  /** Tests: each batch's paths; else sized from this machine. */
  readonly batchFiles?: number;
  /** `performance.now()` at which this side's share of the budget ends. */
  readonly endMs: number;
  readonly secondsOf: (ref: TestFileRef) => number | null;
  /**
   * Before each batch, after the side's budget allows it (the commit side's
   * whole-checkout check, which itself skips the checkout's first child).
   */
  readonly beforeEach?: () => Promise<void>;
  /**
   * One batch in a gate child: its paths and (review wave-18 B3) its own
   * files by project and path, which alone it may run; the gate's budget
   * and the hard stop, in seconds.
   */
  readonly run: (batch: Batch, gate: number, stop: number) => Promise<RunAnswer>;
  /** A batch's files read back after its answer, or the unstarted files after the last. */
  readonly readBack: (files: readonly F[], answer: RunAnswer) => Promise<void>;
  readonly stateOf: (file: F) => SideState | undefined;
  readonly setState: (file: F, state: SideState) => void;
}

/** One batch: whole paths of one lot, and the files of that lot under them. */
export interface Batch {
  readonly paths: readonly RelativePath[];
  readonly refs: readonly TestFileRef[];
}

export interface LoopEnd {
  /** The children's time in ms; `null` when none started. */
  readonly gateMs: number | null;
  readonly timedOut: boolean;
  /** A batch's gate ran out of time, or its child was stopped: a file may have been cut mid-run. */
  readonly cut: boolean;
  readonly batches: readonly BatchTime[];
}

/**
 * The loop over `loop.files`, to the side's end. Review wave-18 B3: a
 * slot is one path within one lot, so a path an ordinary project and a
 * manual one share is two slots, run in two batches, each with its own
 * projects only.
 */
export async function runBatches<F>(loop: BatchLoop<F>): Promise<LoopEnd> {
  const { refOf } = loop;
  const lot = lotOf(loop.policy);
  const bySlot = new Map<string, F[]>();
  const lots = new Map<string, string>();
  for (const file of loop.files) {
    const ref = refOf(file);
    const slot = `${lot(ref)}\0${ref.path}`;
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), file]);
    lots.set(slot, lot(ref));
  }
  const lotOfSlot = (slot: string) => lots.get(slot) ?? "";
  // R3: the lot of every other file first, then each on-request group's, by name; by path within.
  let slots = [...bySlot.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const batches = new Batches(loop.timeoutSeconds, {
    ...(loop.batchFiles === undefined ? {} : { fixed: loop.batchFiles }),
  });
  const seconds = (slot: string) => {
    const known = (bySlot.get(slot) ?? []).map((f) => loop.secondsOf(refOf(f)));
    return known.some((s) => s !== null) ? Math.max(...known.map((s) => s ?? 0)) : null;
  };
  const stops: ((file: F) => SideState | null)[] = [];
  let gateMs: number | null = null;
  let timedOut = false;
  let cut = false;
  let ended: { readonly error: string; readonly stopped?: true } | null = null;
  while (slots.length > 0 && ended === null) {
    const left = Math.floor((loop.endMs - performance.now()) / 1000);
    const gateSeconds = left - stopMargin(left);
    if (gateSeconds < 1) break;
    await loop.beforeEach?.();
    const first = lotOfSlot(slots[0] as string);
    const same = slots.filter((slot) => lotOfSlot(slot) === first);
    const take = same.slice(0, batches.next(same, seconds));
    const taken = new Set(take);
    slots = slots.filter((slot) => !taken.has(slot));
    const files = take.flatMap((slot) => bySlot.get(slot) ?? []);
    const refs = files.map(refOf);
    const batch = { paths: [...new Set(refs.map((ref) => ref.path))], refs };
    const started = performance.now();
    const answer = await loop.run(batch, gateSeconds, left);
    const took = performance.now() - started;
    gateMs = (gateMs ?? 0) + Math.round(took);
    batches.took(take.length, took / 1000);
    if ("result" in answer && answer.result.timedOut) cut = true;
    // A child that could not run or answer stops the batches: the next would end alike.
    if ("error" in answer) {
      ended = answer;
      if (answer.stopped === true) cut = true;
    }
    await loop.readBack(files, answer);
    const stop = afterSetup(loop, files, answer);
    if (stop !== null) {
      stops.push(stop);
      slots = slots.filter((slot) => !stoppedPath(bySlot.get(slot) ?? [], stops, loop));
    }
  }
  const unstarted = slots.flatMap((slot) => bySlot.get(slot) ?? []);
  if (unstarted.length > 0) {
    // Not started for want of budget, unless a child failed for a reason of its own.
    const answer: RunAnswer =
      ended !== null && ended.stopped !== true ? ended : { error: "budget", stopped: true };
    if (answer.stopped === true) timedOut = true;
    await loop.readBack(unstarted, answer);
    afterSetup(loop, unstarted, answer);
  }
  return { gateMs, timedOut: timedOut || cut, cut, batches: batches.ran() };
}

/** R3: a batch's failed setups: its files' states set; what stops later files; `null` when none. */
function afterSetup<F>(
  loop: BatchLoop<F>,
  files: readonly F[],
  answer: RunAnswer,
): ((file: F) => SideState | null) | null {
  if (answer.setup === undefined || answer.setup.length === 0) return null;
  if ("error" in answer) {
    // Review wave-18 B2: the gate rejected before it ran a file; a stop is never one.
    if (answer.stopped === true) return null;
    rejected(loop, files, answer.setup);
    return null;
  }
  const verdict = setupVerdict(loop.policy, answer.setup, files, loop.refOf, loop.stateOf);
  for (const file of files) {
    const state = verdict.states.get(testFileId(loop.refOf(file)));
    if (state !== undefined) loop.setState(file, state);
  }
  return verdict.stops;
}

/** R3: whether every file of a path is under a failed setup; then each takes that state. */
function stoppedPath<F>(
  files: readonly F[],
  stops: readonly ((file: F) => SideState | null)[],
  loop: BatchLoop<F>,
): boolean {
  const states = files.map((file) => stops.map((stop) => stop(file)).find((s) => s !== null));
  if (files.length === 0 || states.some((s) => s === undefined || s === null)) return false;
  files.forEach((file, i) => {
    loop.setState(file, states[i] as SideState);
  });
  return true;
}

/** B2: every file of a batch whose gate rejected at its setup: `not run (setup)`, with its group. */
function rejected<F>(loop: BatchLoop<F>, files: readonly F[], told: readonly SetupFailure[]): void {
  const view = groupView(loop.policy);
  const text = told.map((f) => f.text).join("; ");
  for (const file of files) {
    const setup = `${view.of(loop.refOf(file)).name}: ${text}`;
    loop.setState(file, { state: "not run", reason: "setup", setup });
  }
}
