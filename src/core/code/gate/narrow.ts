import { testFileId } from "../../keys/reverse-index.js";
import { namesakeCut, type SelectableFile, selectEditWork } from "../../scheduler/edit-select.js";
import type { RelativePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { RunnerAdapter } from "../../types/runner.js";
import { type GateScope, type LeftOutRef, placeFile } from "./scope.js";
import type { TestFileEvidence } from "./types.js";

/*
 * Spec 026 D5.2 (rows 026-08, 026-21): `squeal code --base <ref> --narrow`
 * runs only the narrow set `squeal run <group> --base <ref>` runs (D4, 019
 * D6), by the same rule (`selectEditWork`), among the files the scope runs:
 * each changed test file and `--test` file; per changed source and group,
 * its namesakes it reaches, or with none its direct importers, then the
 * `runner.tierSize` shortest of its other direct importers (stored direct
 * marks among them), then of the files that import it through other
 * modules or whose runs read it, unknown durations last. The runner's
 * `affected` is asked once per source, as the daemon's narrow run asks it.
 * Every other selected file is left out, so its closure is read and a
 * function it loads stays `incomplete` (vision principle 2).
 */

/** What the stores observed of a test file's runs (016 D4, 001 D3). */
export interface StoredObserved {
  /** The paths a process the file started imported (`ObservedSets.directOf`). */
  directOf(ref: TestFileRef): readonly RelativePath[];
  /** The paths its runs read beyond its static closure (`ObservedSets.of`). */
  readsOf(ref: TestFileRef): readonly RelativePath[];
}

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
  /** `runner.tierSize`: how many other importers and readers it keeps per source and group. */
  readonly tierSize: number;
  /** A file's stored seconds; `null` when unknown. Absent, every duration is unknown. */
  readonly durations?: ((ref: TestFileRef) => number | null) | undefined;
  /** The stores' observed paths; absent, only the runner's `affected` says who reads a source. */
  readonly observed?: StoredObserved | undefined;
  /** The group a file of `run` is in; absent, all are in one. */
  readonly groupOf?: ((ref: TestFileRef) => string) | undefined;
}

/** The files of `input.run` the narrow set keeps, and the others, each in `run`'s order. */
export async function narrowRun(
  input: NarrowInput,
): Promise<{ readonly kept: TestFileRef[]; readonly dropped: TestFileRef[] }> {
  const { adapter, listed, run, paths, tests, tierSize, observed } = input;
  const files = new Map<string, SelectableFile>();
  for (const ref of listed) {
    const seconds = input.durations?.(ref) ?? null;
    files.set(testFileId(ref), {
      id: testFileId(ref),
      ref,
      durationMs: seconds === null ? null : seconds * 1000,
    });
  }
  const groups = new Map(run.map((ref) => [testFileId(ref), input.groupOf?.(ref) ?? ""]));
  const kept = new Set<string>();
  const named = new Set([...paths, ...tests]);
  for (const ref of run) if (named.has(ref.path)) kept.add(testFileId(ref));
  const testPaths = new Set(listed.map((ref) => ref.path));
  const idsOf = (refs: readonly TestFileRef[]) => new Set(refs.map(testFileId));
  for (const source of new Set(paths)) {
    if (testPaths.has(source)) continue;
    const affected = await adapter.affected([source]);
    const direct = idsOf(affected.direct);
    const transitive = idsOf(affected.transitive);
    const stored = (of: keyof StoredObserved) =>
      idsOf(listed.filter((ref) => observed?.[of](ref).includes(source) === true));
    const observedDirect = new Set([...stored("directOf")].filter((id) => !direct.has(id)));
    const read = stored("readsOf");
    const reached = new Set([...direct, ...observedDirect, ...transitive, ...read]);
    const { namesakes, bare } = namesakeCut(listed, [source], reached, () => reached.size > 0);
    const cut = { namesakes, bare, fallback: bare.size > 0 ? direct : new Set<string>() };
    const reads = (id: string) => transitive.has(id) || read.has(id);
    for (const group of new Set(groups.values())) {
      const within = (id: string) => groups.get(id) === group;
      const selection = { files, named: new Set([source]), reached, cut, direct, observedDirect };
      for (const id of selectEditWork({ ...selection, reads, tierSize, within })) kept.add(id);
    }
  }
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
  readonly observed?: StoredObserved | undefined;
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
    const groupOf = (ref: TestFileRef) => placeFile(scope, kind, ref).group;
    const { kept, dropped } = await narrowRun({ ...options, adapter, listed, run, groupOf });
    const leftOut = dropped.map((ref) => ({ ref, group: placeFile(scope, kind, ref).group }));
    return { run: kept, leftOut };
  };
}

/** A runner's narrowing, as `narrowing` gives it. */
export type Narrowing = ReturnType<typeof narrowing>;
