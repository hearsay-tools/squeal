import { compare } from "../../fs/compare.js";
import { testFileId } from "../../keys/reverse-index.js";
import { namesakesOf } from "../../scheduler/namesakes.js";
import type { RelativePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { RunnerAdapter } from "../../types/runner.js";
import { type GateScope, type LeftOutRef, placeFile } from "./scope.js";
import type { TestFileEvidence } from "./types.js";

/*
 * Spec 026 D5.2 (row 026-08): `squeal code --base <ref> --narrow` runs
 * only 019 D6's narrow set among the files the scope runs: each changed
 * test file and `--test` file; for each changed source, its namesakes the
 * runner reaches, or with none its direct importers; then the
 * `runner.tierSize` shortest of the other direct importers, unknown
 * durations last. Every other selected file is left out, so its closure
 * is read and a function it loads stays `incomplete` (vision principle 2).
 * The daemon's `editWork` needs its ledger; this is the gate's own,
 * with the runner's `affected` asked once per source.
 */

/** What the narrow set needs of one runner. */
export interface NarrowInput {
  readonly adapter: Pick<RunnerAdapter, "affected">;
  /** Every test file the runner lists. */
  readonly listed: readonly TestFileRef[];
  /** The selected files the scope runs, `--test` files among them. */
  readonly run: readonly TestFileRef[];
  /** The changed paths. */
  readonly paths: readonly RelativePath[];
  /** The `--test` files. */
  readonly tests: readonly RelativePath[];
  /** `runner.tierSize`: how many other direct importers it keeps. */
  readonly tierSize: number;
  /** A file's stored seconds; `null` when unknown. Absent, every duration is unknown. */
  readonly durations?: ((ref: TestFileRef) => number | null) | undefined;
}

/** The files of `input.run` the narrow set keeps, and the others, each in `run`'s order. */
export async function narrowRun(
  input: NarrowInput,
): Promise<{ readonly kept: TestFileRef[]; readonly dropped: TestFileRef[] }> {
  const { adapter, listed, run, paths, tests, tierSize } = input;
  const runIds = new Set(run.map(testFileId));
  const within = (ref: TestFileRef) => runIds.has(testFileId(ref));
  const kept = new Set<string>();
  const named = new Set([...paths, ...tests]);
  for (const ref of run) if (named.has(ref.path)) kept.add(testFileId(ref));
  const testPaths = new Set(listed.map((ref) => ref.path));
  const importers = new Map<string, TestFileRef>();
  for (const source of new Set(paths)) {
    if (testPaths.has(source)) continue;
    const affected = await adapter.affected([source]);
    const direct = affected.direct.filter(within);
    for (const ref of direct) importers.set(testFileId(ref), ref);
    const names = new Set(namesakesOf(source, testPaths));
    const reached = [...affected.direct, ...affected.transitive].filter(within);
    const own = reached.filter((ref) => names.has(ref.path));
    for (const ref of own.length > 0 ? own : direct) kept.add(testFileId(ref));
  }
  const seconds = (ref: TestFileRef) => input.durations?.(ref) ?? Number.POSITIVE_INFINITY;
  const others = [...importers.values()]
    .filter((ref) => !kept.has(testFileId(ref)))
    .sort((a, b) => seconds(a) - seconds(b) || compare(testFileId(a), testFileId(b)));
  for (const ref of others.slice(0, tierSize)) kept.add(testFileId(ref));
  return {
    kept: run.filter((ref) => kept.has(testFileId(ref))),
    dropped: run.filter((ref) => !kept.has(testFileId(ref))),
  };
}

/** What `narrowing` reads besides each runner's pick. */
export interface NarrowOptions {
  readonly paths: readonly RelativePath[];
  readonly tests: readonly RelativePath[];
  readonly tierSize: number;
  readonly durations?: ((ref: TestFileRef) => number | null) | undefined;
}

/**
 * D5.2: the narrow set of one runner's pick under `scope`: the files it
 * keeps to run, and the others the scope ran, each now left out by its group.
 */
export function narrowing(scope: GateScope, options: NarrowOptions) {
  return async (
    kind: TestFileEvidence["runner"],
    adapter: Pick<RunnerAdapter, "affected">,
    listed: readonly TestFileRef[],
    run: readonly TestFileRef[],
  ): Promise<{ readonly run: TestFileRef[]; readonly leftOut: LeftOutRef[] }> => {
    const { kept, dropped } = await narrowRun({ ...options, adapter, listed, run });
    const leftOut = dropped.map((ref) => ({ ref, group: placeFile(scope, kind, ref).group }));
    return { run: kept, leftOut };
  };
}

/** A runner's narrowing, as `narrowing` gives it. */
export type Narrowing = ReturnType<typeof narrowing>;
