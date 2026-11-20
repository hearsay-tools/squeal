import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { costOf, costText } from "../core/ci/cost.js";
import type { HooksTime, InputEvidence } from "../core/ci/inputs.js";
import {
  PART_FORMAT,
  type Part,
  type PartHeader,
  type PartRecords,
  type RecordingCost,
  writePart,
} from "../core/ci/parts.js";
import { squealVersion } from "../core/daemon/version.js";
import { readHead } from "../core/daemon-loop/head.js";
import { KEY_FORMAT_VERSION } from "../core/keys/key-format.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { NodeTestRecordedRun } from "../runners/node-test/ci-runs.js";
import type { RecordedRun } from "../runners/vitest/ci-record.js";
import { sourceOf } from "./export.js";
import type { CliIo } from "./main.js";

/*
 * Spec 018 D8 and D25: the parts `squeal ci record` writes, one per Vitest
 * process (`vitestBody`) and one per `node --test` process (`nodeTestBody`,
 * row 018-47), each with the command's header fields, evidence and cost.
 */

/** One part's header fields of its own recording, and its body. */
export interface Body {
  readonly header: Pick<PartHeader, "runner" | "runnerVersion" | "shard" | "end" | "observing"> &
    Pick<PartHeader, "coverage" | "nodeTest">;
  readonly projects: Part["projects"];
  readonly testFiles: Part["testFiles"];
  readonly coverage?: PartRecords;
}

export function vitestBody(run: RecordedRun): Body {
  const { projects, testFiles, end, runnerVersion, shard, observing, coverage, records } = run;
  return {
    header: {
      runner: "vitest",
      runnerVersion,
      shard,
      end,
      observing,
      ...(coverage === undefined ? {} : { coverage }),
    },
    projects,
    testFiles,
    ...(records === undefined ? {} : { coverage: records }),
  };
}

export function nodeTestBody(run: NodeTestRecordedRun): Body {
  const { testFiles, end, runnerVersion, shard, observing, nodeTest } = run;
  return {
    header: { runner: "node-test", runnerVersion, shard, end, observing, nodeTest },
    projects: [],
    testFiles,
  };
}

/** Row 018-29: the hooks' time, and when the command ended (`performance.now`). */
export interface Spent {
  readonly hooks: HooksTime;
  readonly commandEnd: number;
}

export async function writeParts(
  bodies: readonly Body[],
  out: AbsolutePath,
  root: AbsolutePath,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  evidence: InputEvidence,
  spent: Spent,
): Promise<string> {
  const head = await readHead(root);
  const cost: RecordingCost = {
    command: randomUUID(),
    hooksMs: Math.round(spent.hooks.ms),
    threads: spent.hooks.threads,
    afterMs: Math.round(performance.now() - spent.commandEnd),
  };
  const base = {
    squealVersion: squealVersion(),
    keyFormat: KEY_FORMAT_VERSION,
    commit: head.head,
    dirty: head.dirty,
    createdAt: (io.now ?? Date.now)(),
    source: sourceOf(env),
  };
  let files = 0;
  for (const body of bodies) {
    const header: PartHeader = { ...base, ...body.header, cost };
    const { projects, testFiles } = body;
    const part: Part = { format: PART_FORMAT, header, projects, testFiles, evidence };
    writePart(out, body.coverage === undefined ? part : { ...part, coverage: body.coverage });
    files += testFiles.length;
  }
  const ended = bodies.filter((b) => b.header.end !== "completed").map((b) => b.header.end);
  const untrusted = ended.length === 0 ? "" : ` (no test file from a run that ${ended.join(", ")})`;
  const parts = `${bodies.length} part${bodies.length === 1 ? "" : "s"}`;
  const wrote = `wrote ${parts} with ${files} test file${files === 1 ? "" : "s"} to ${out}${untrusted}`;
  const summary = costOf(bodies.map((body) => ({ header: { cost }, testFiles: body.testFiles })));
  const lines = [wrote, ...bodies.flatMap(coverageLine)];
  if (summary !== null) lines.push(costText(summary));
  return lines.join("\nsqueal ci record: ");
}

/**
 * Spec 020 D13: one line per run on its coverage records: how many files
 * have one, or why the provider was not in the run, and an error that cost
 * records.
 */
function coverageLine({ header, testFiles }: Body): string[] {
  const { coverage } = header;
  if (coverage === undefined) return [];
  if ("off" in coverage) {
    const what = coverage.off === "failed" ? "failed" : "was not added";
    return [`no coverage records: Squeal's provider ${what}: ${coverage.note}`];
  }
  const recorded = testFiles.filter((file) => file.record !== undefined).length;
  const lost = coverage.note === undefined ? "" : `; ${coverage.note}`;
  return [`coverage records for ${recorded} of ${testFiles.length} test files${lost}`];
}
