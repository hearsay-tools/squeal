import { join } from "node:path";
import { hostLoad } from "../../retry/load.js";
import type { AbsolutePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { RunReport } from "../../types/runner.js";
import type { CollectOptions } from "./collect.js";
import { type EndedRun, evidenceOf } from "./evidence.js";
import { type PlannedRun, stoppedEarly } from "./plan.js";
import type { PrepareRun } from "./prepare.js";
import type { KnownEvidence, Picked } from "./prerun.js";
import type { FileProgress } from "./progress.js";
import { type MapOptions, mapPayloads } from "./records.js";
import { afterRetry, type Overloaded, overloadedOf, withoutRetried } from "./retry.js";
import type { Runner } from "./runners.js";
import { preparedBefore, tellRan } from "./steps.js";
import type { TestFileEvidence } from "./types.js";

/*
 * Spec 020 D18 as amended (row 020-44, #196): the gate's runs. First each
 * node:test entry's `prepare`, so none rewrites what a running file of
 * another runner reads; then every runner's run at once, as the daemon's
 * lanes run, under the one deadline. Vitest runs with its own workers; the
 * node:test entries take their processes from one pool of
 * `runner.tierSize` slots, so a free slot goes to the next entry's file
 * while one entry's slow file runs. No running file is stopped to make
 * room. Each run's files keep D17.2's order. Before, the runners ran one
 * after another, and a slow first runner left the others' files unrun.
 */

/**
 * D18 as amended: `size` slots, each a process, given in the order they
 * were asked for. A run takes one before each file's process starts, and
 * gives it back as the process exits.
 */
export class SlotPool {
  #free: number;
  readonly #waiting: { readonly grant: (release: (() => void) | null) => void }[] = [];

  constructor(size: number) {
    this.#free = Math.max(1, size);
  }

  /** A slot's release once one is free; `null` when `signal` aborted first. */
  readonly take = (signal: AbortSignal): Promise<(() => void) | null> => {
    if (signal.aborted) return Promise.resolve(null);
    if (this.#free > 0) {
      this.#free -= 1;
      return Promise.resolve(this.#release());
    }
    return new Promise((resolve) => {
      const waiter = {
        grant: (release: (() => void) | null) => {
          signal.removeEventListener("abort", onAbort);
          resolve(release);
        },
      };
      const onAbort = () => {
        this.#waiting.splice(this.#waiting.indexOf(waiter), 1);
        resolve(null);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.#waiting.push(waiter);
    });
  };

  /** One slot's release: the first waiter gets the slot, else it is free; a second call does nothing. */
  #release(): () => void {
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      const next = this.#waiting.shift();
      if (next === undefined) this.#free += 1;
      else next.grant(this.#release());
    };
  }
}

/** What the runs need beyond the planned runs. */
export interface LaneContext {
  readonly root: AbsolutePath;
  readonly deadline: number;
  readonly note: (text: string) => void;
  readonly options: CollectOptions;
  readonly children: boolean;
  /** Where each run writes its log folder, `runs/<index>`. */
  readonly temp: AbsolutePath;
  /** The evidence of the selected files known without a run. */
  readonly known: KnownEvidence;
  readonly mapping: MapOptions;
  /** Which files the runners told started (row 020-43). */
  readonly progress: FileProgress;
}

/** The runs' outcome, for the collector's evidence. */
export interface Lanes {
  /** Every selected file of the runs given: known, not prepared, or run. */
  readonly testFiles: readonly TestFileEvidence[];
  readonly prepares: readonly PrepareRun[];
  /** Each run as it ended, in the order of `runs`; a rerun after its first run (row 020-54). */
  readonly ended: readonly EndedRun[];
  /** The budget ended before every file ran. */
  readonly timedOut: boolean;
}

type Planned = PlannedRun<Picked & { readonly runner: Runner }>;

/**
 * D15.3, D18 as amended: each entry's `prepare` in the order of `runs`,
 * then every run with a file left at once; a run that starts after the
 * deadline runs nothing. Row 020-46: a file the gate stopped early before
 * goes to no `prepare` and no run, so it reads `overBudget`, never
 * `notStarted`. Row 020-54: once every run ended, the files that failed
 * in a run that ended while the host's load was at or over its CPU count
 * run once more, through the same runner, each run's at once; a rerun
 * that starts after the deadline runs nothing, and changes nothing.
 */
export async function runLanes(runs: readonly Planned[], context: LaneContext): Promise<Lanes> {
  const testFiles: TestFileEvidence[] = [];
  const prepares: PrepareRun[] = [];
  const toRun: { readonly planned: Planned; readonly files: readonly TestFileRef[] }[] = [];
  let timedOut = false;
  for (const planned of runs) {
    const { runner } = planned.pick;
    const { chosen, evidence: notRun } = await stoppedEarly(runner, planned, context.children);
    testFiles.push(...notRun);
    if (chosen.length === 0) continue;
    const before = await preparedBefore(runner, chosen, context);
    prepares.push(...before.prepares);
    timedOut ||= before.budgetEnded;
    testFiles.push(
      ...chosen.flatMap((ref) => before.known.get(ref) ?? context.known.get(ref) ?? []),
    );
    // D17.2: the files left to run, in loader order.
    const files = planned.files.filter((ref) => !before.known.has(ref));
    if (files.length > 0) toRun.push({ planned, files });
  }
  const first = await Promise.all(toRun.map((run) => runOne(run.planned, run.files, context)));
  // Row 020-54: what failed while the host was overloaded runs once more, after every other file.
  const reruns = await Promise.all(
    toRun.map(({ planned }, i) => {
      const files = first[i]?.overloaded?.files;
      return files === undefined ? null : runOne(planned, files, context, RERUN);
    }),
  );
  const ended: EndedRun[] = [];
  first.forEach((run, i) => {
    const rerun = reruns[i] ?? null;
    const { overloaded } = run;
    const again = rerun?.report == null ? null : rerun.ran;
    testFiles.push(
      ...(overloaded === undefined ? run.ran : afterRetry(run.files, run.ran, overloaded, again)),
    );
    ended.push(run);
    timedOut ||= run.report === null || run.report.end === "timed-out";
    if (rerun === null || rerun.report === null) return;
    ended.push(rerun);
    timedOut ||= rerun.report.end === "timed-out";
  });
  return { testFiles, prepares, ended, timedOut };
}

/** Row 020-54: a rerun's suffix to its run id and log folder; it is not told to the keeper. */
const RERUN = "-rerun";

/** One run as it ended, with the files that failed in it while the host was overloaded. */
interface LaneRun extends EndedRun {
  readonly overloaded?: Overloaded;
}

/**
 * One runner's run of `files`, given what is left of the budget, and each
 * file's evidence; a file that neither completed nor started reads not
 * started (row 020-43).
 */
async function runOne(
  { pick, index: i }: Planned,
  files: readonly TestFileRef[],
  context: LaneContext,
  rerun?: typeof RERUN,
): Promise<LaneRun> {
  const { runner } = pick;
  const { options, progress } = context;
  const left = Math.ceil(context.deadline - performance.now());
  const id = `${i}${rerun ?? ""}`;
  const logDir = join(context.temp, "runs", id);
  // Review 0.1.464 B1: the run's end, in any way, ends its files; the other runs' stay open.
  const report: RunReport | null =
    left > 0
      ? await runner.adapter
          .run(files, { runId: `gate-${id}`, logDir, timeoutMs: left })
          .finally(() => progress.runEnded(runner.kind, files))
      : null;
  if (report?.failure != null) context.note(`${runner.kind} run: ${report.failure}`);
  const records = mapPayloads(runner.covered.splice(0), context.mapping);
  // Row 020-54: a first run's failures under load run again; a rerun runs once.
  const overloaded =
    rerun === undefined
      ? overloadedOf(
          files,
          report,
          options.hostLoad ?? hostLoad,
          context.deadline - performance.now(),
        )
      : null;
  if (rerun === undefined) {
    const kept = withoutRetried(records, overloaded);
    await tellRan(options.ran, { runner: runner.kind, files, report, records: kept });
  }
  const ran: TestFileEvidence[] = [];
  for (const ref of files) {
    const evidence = await evidenceOf(runner, ref, report, records, context.children);
    const started = evidence.completed || progress.wasStarted(runner.kind, ref);
    ran.push(started ? evidence : { ...evidence, notStarted: true });
  }
  return {
    runner: runner.kind,
    files,
    logDir,
    report,
    ran,
    ...(overloaded === null ? {} : { overloaded }),
  };
}
