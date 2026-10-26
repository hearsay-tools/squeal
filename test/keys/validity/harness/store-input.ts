import { testFileId } from "../../../../src/core/keys/index.js";
import type { ObservedGrowth, TierObservations } from "../../../../src/core/scheduler/observed.js";
import { barredByTouch, Withholds } from "../../../../src/core/scheduler/stability.js";
import type { CheckKey, RunReport, TestFileRef } from "../../../../src/core/types/index.js";
import type { StoreFile, StoreInput } from "../case.js";
import { REPORT } from "./shared.js";

/*
 * What a `store` case's tier ran under and reported, at either tree: the
 * keys of each file, and the report after the completion barrier with the
 * files it queues again, built as `Scheduler.#record` builds them
 * (`scheduler.ts`, tasks 001-168, 007-30, 013-02). The barrier is
 * `barredByTouch`'s (`stability.ts`, row 011-47); which of the files it
 * bars run once more is the scheduler's, mirrored here.
 */

export const refOf = (path: string): TestFileRef => ({ project: "", path });

const keyOf = (which: "ran" | "moved" | "other", path: string) => `${which}:${path}` as CheckKey;

/** The key `file` ran under, and what the ledger holds of it. */
export function keysOf(file: StoreFile) {
  const at = (which: "ran" | "moved" | "other" | null | undefined) =>
    which === null || which === undefined ? null : keyOf(which, file.path);
  return {
    ran: keyOf("ran", file.path),
    key: at(file.key ?? "ran"),
    running: file.running === undefined ? keyOf("ran", file.path) : at(file.running),
    result: at(file.result),
    /** The key `WorktreeKeys` gives the file once its growth joined its closure. */
    grown: keyOf("moved", file.path),
  };
}

/** The run's report and the files queued again (`recordTier`'s `requeue`), after the barrier. */
export function recorded(input: StoreInput): {
  readonly report: RunReport;
  readonly requeue: boolean | ReadonlySet<string>;
} {
  const ran: RunReport = {
    ...REPORT,
    end: input.end ?? "completed",
    completedFiles: input.completed.map(refOf),
    results: input.completed.map((path) => ({
      check: { kind: "test", project: "", testPath: path, fullName: "passes" },
      outcome: "pass",
      durationMs: 3,
      location: null,
      errors: [],
    })),
    ...(input.withheld === undefined ? {} : { withheld: input.withheld.map(refOf) }),
    ...(input.startup === undefined
      ? {}
      : {
          startupFailure: {
            projects: [""],
            testFiles: input.startup.map(refOf),
            setupFile: "test/global-setup.ts",
            error: {
              name: "Error",
              message: "setup failed",
              stack: null,
              location: null,
              diff: null,
            },
          },
        }),
  };
  const ranOf = (path: string) => ({
    file: { id: testFileId(refOf(path)), ref: refOf(path) },
    key: keyOf("ran", path),
  });
  const files = input.files.map((f) => ({ ...ranOf(f.path), inputs: f.inputs ?? [] }));
  const { growth } = observationsOf(input);
  const { report, barred } = barredByTouch(ran, files, input.touched ?? [], growth);
  const withholds = new Withholds();
  withholds.record((input.touchedBefore ?? []).map(ranOf));
  const withhold = barred.length === 0 ? null : withholds.record(barred);
  if (input.requeue === true) return { report, requeue: true };
  if (withhold === null && input.requeue === undefined) return { report, requeue: false };
  const again = [...(withhold?.again ?? []).map(({ file }) => file.id)];
  return {
    report,
    requeue: new Set([...again, ...(input.requeue ?? []).map((p) => testFileId(refOf(p)))]),
  };
}

/** What the run read beyond its keys, by `testFileId`, as `prepareObserved` gives it. */
export function observationsOf(input: StoreInput): TierObservations {
  const growth = new Map<string, ObservedGrowth>();
  for (const f of input.files) {
    if (f.growth === undefined) continue;
    const { growth: paths, firstSeen = [] } = f.growth;
    growth.set(testFileId(refOf(f.path)), { add: paths, growth: paths, firstSeen });
  }
  const environment =
    input.environment === undefined
      ? undefined
      : {
          files: new Map(input.environment.map((p) => [testFileId(refOf(p)), ["env.json"]])),
          changes: [],
        };
  return {
    growth,
    changed: new Set(),
    touched: new Set(),
    ...(environment ? { environment } : {}),
  };
}
