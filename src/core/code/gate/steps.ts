import type { AbsolutePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { RunReport } from "../../types/runner.js";
import type { CollectOptions, GateRun } from "./collect.js";
import type { RunEstimate } from "./estimate.js";
import { evidenceOf } from "./evidence.js";
import type { BudgetTold } from "./plan.js";
import { declaresPrepare, type PrepareRun, prepareEntry } from "./prepare.js";
import type { KnownEvidence, Picked } from "./prerun.js";
import type { Runner } from "./runners.js";
import type { Evidence, TestFileEvidence } from "./types.js";

/*
 * Spec 020 D11.7, D13.2, D15, D17 (rows 020-07c, 020-08b, 020-16b,
 * 020-17ab): the collector's steps around each runner's run. The stored
 * lookup before the selection is told, the estimate told before the first
 * run or `prepare`, a node:test entry's `prepare` before its run, and each
 * run told once it ended.
 */

/**
 * D11.7, D13.2: the evidence `options.stored` knows of each runner's
 * selected files, asked once per runner with one, before the selection is
 * told and before any setup, `prepare` or run. A node:test entry with a
 * `prepare` (D15) takes none: its files run when the command passes.
 */
export async function storedOf(
  picked: readonly (Picked & { readonly runner: Runner })[],
  options: CollectOptions,
): Promise<KnownEvidence> {
  const known = new Map<TestFileRef, TestFileEvidence>();
  if (options.stored === undefined) return known;
  for (const { runner, run: chosen } of picked) {
    if (chosen.length === 0) continue;
    if (runner.project !== undefined && declaresPrepare(runner.project, options.prepares)) continue;
    const closure = (ref: TestFileRef) => runner.adapter.closure(ref).catch(() => null);
    const environment = () => runner.adapter.environment();
    for (const [ref, evidence] of await options.stored(runner.kind, chosen, closure, environment)) {
      known.set(ref, evidence);
    }
  }
  return known;
}

/** What `preparedBefore` gives one runner's selected files. */
interface Before {
  /** The files' evidence known without a run; those do not run. */
  readonly known: ReadonlyMap<TestFileRef, TestFileEvidence>;
  /** D15.3: its entry's `prepare`, when it had one. */
  readonly prepares: readonly PrepareRun[];
  /** The budget ended in the `prepare`. */
  readonly budgetEnded: boolean;
}

/**
 * D15: a node:test entry's `prepare`, after the selection is told and
 * before its run. When the base's command passed, every file runs; when
 * it did not, or only the head declares it, none does, and each reads not
 * prepared, its closure read with no run. Nothing for another runner.
 */
export async function preparedBefore(
  runner: Runner,
  chosen: readonly TestFileRef[],
  at: {
    readonly root: AbsolutePath;
    readonly deadline: number;
    readonly note: (text: string) => void;
    readonly options: CollectOptions;
    readonly children: boolean;
  },
): Promise<Before> {
  const { options } = at;
  const prepared =
    runner.project === undefined
      ? null
      : await prepareEntry(
          runner.project,
          chosen.map((ref) => ref.path),
          { ...at, base: options.prepares, output: options.output ?? (() => {}) },
        );
  if (prepared === null) return { known: new Map(), prepares: [], budgetEnded: false };
  const known = new Map<TestFileRef, TestFileEvidence>();
  if (prepared.run.outcome !== "passed") {
    for (const ref of chosen) {
      const evidence = await evidenceOf(runner, ref, null, new Map(), at.children);
      known.set(ref, { ...evidence, notPrepared: true });
    }
  }
  return { known, prepares: [prepared.run], budgetEnded: prepared.budgetEnded };
}

/**
 * D17.1: `estimates`, in the order the runners run, told to `estimated`
 * with the whole seconds left of the budget before the first run or
 * `prepare`, and (rows 020-45, 020-46) what `told` says of the whole run;
 * Evidence's fields, absent when no file is to run or no rerun is named.
 */
export function tellEstimates(
  estimated: CollectOptions["estimated"],
  estimates: readonly RunEstimate[],
  told: BudgetTold,
): Pick<Evidence, "estimates" | "rerun"> {
  if (estimates.length === 0) return {};
  estimated?.(estimates, told.fit.leftSeconds, told);
  return { estimates, ...(told.rerun === undefined ? {} : { rerun: told.rerun }) };
}

/** D17.3: a run that ended, to `ran`; none when the budget ended before it started. */
export async function tellRan(
  ran: CollectOptions["ran"],
  run: Omit<GateRun, "report"> & { readonly report: RunReport | null },
): Promise<void> {
  const { report } = run;
  if (ran !== undefined && report !== null) await ran({ ...run, report });
}
