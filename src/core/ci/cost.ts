import type { PartFile, RecordingCost } from "./parts.js";

/*
 * Row 018-29 (spec 018 D8): the line `squeal ci record` and `squeal ci
 * export` print on what recording cost, from the parts' `RecordingCost`, so
 * each CI run states its own cost. "The test time" is the test files'
 * durations summed (Vitest's environment, prepare, collect, setup and test
 * phases per file, over every worker), the nearest figure to the shard time
 * a part holds. Informational only.
 */

export interface CostSummary {
  /** Distinct `ci record` commands among the parts with a cost. */
  readonly commands: number;
  readonly hooksMs: number;
  readonly threads: number;
  readonly afterMs: number;
  /** The test files' durations in the parts with a cost, summed. */
  readonly testMs: number;
  /** Parts without a cost: an older Squeal made them. */
  readonly without: number;
  readonly parts: number;
}

/** What a part holds of the cost: its header's, and its test files' durations. */
export interface CostOfPart {
  readonly header: { readonly cost?: RecordingCost };
  readonly testFiles: readonly Pick<PartFile, "durationMs">[];
}

/** What recording cost the commands that made `parts`, each command once; `null` when no part holds it. */
export function costOf(parts: readonly CostOfPart[]): CostSummary | null {
  const commands = new Map<string, RecordingCost>();
  let testMs = 0;
  let without = 0;
  for (const { header, testFiles } of parts) {
    // A part without a cost adds no test time either: its hooks' time is unknown.
    if (header.cost === undefined) {
      without += 1;
      continue;
    }
    commands.set(header.cost.command, header.cost);
    for (const file of testFiles) testMs += file.durationMs ?? 0;
  }
  if (commands.size === 0) return null;
  const sum = (field: "hooksMs" | "threads" | "afterMs") =>
    [...commands.values()].reduce((total, cost) => total + cost[field], 0);
  return {
    commands: commands.size,
    hooksMs: sum("hooksMs"),
    threads: sum("threads"),
    afterMs: sum("afterMs"),
    testMs,
    without,
    parts: parts.length,
  };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;

/**
 * One line: "Squeal's recording took 1.24 s in 9 processes and threads,
 * 3.5% of the test time (35.1 s); 0.42 s more after the command", with the
 * commands counted when more than one, and the parts that hold no cost.
 */
export function costText(cost: CostSummary): string {
  const threads =
    cost.threads === 1 ? "1 process or thread" : `${cost.threads} processes and threads`;
  const of = cost.commands === 1 ? "" : ` of ${cost.commands} commands`;
  const share =
    cost.testMs > 0
      ? `${((100 * cost.hooksMs) / cost.testMs).toFixed(1)}% of the test time (${seconds(cost.testMs)})`
      : "no test time recorded";
  const after = `${seconds(cost.afterMs)} more after the command${cost.commands === 1 ? "" : "s"}`;
  const older =
    cost.without === 0
      ? ""
      : `; ${cost.without} of ${cost.parts} parts hold no cost (an older Squeal made them)`;
  return `Squeal's recording took ${seconds(cost.hooksMs)} in ${threads}${of}, ${share}; ${after}${older}`;
}
