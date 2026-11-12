import { testFileId } from "../keys/reverse-index.js";
import { openDaemonKeys } from "../scheduler/daemon-keys.js";
import type { WorktreeKeys } from "../scheduler/keying.js";
import { observedGrowth } from "../scheduler/observed.js";
import { recordsForFile } from "../scheduler/records.js";
import { describeFailure } from "../state/fingerprint.js";
import { worktreeEnvironment } from "../store/environments.js";
import type { ExportHeader } from "../store/imports.js";
import type { ResultsBundle } from "../store/transfer-bundle.js";
import type {
  AbsolutePath,
  EpochMs,
  ProjectName,
  RelativePath,
  WorktreeId,
} from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { Policy } from "../types/policy.js";
import type {
  RunnerAdapter,
  RunnerClosure,
  RunnerEnvironment,
  RunReport,
} from "../types/runner.js";
import type { Store } from "../types/store.js";
import type { Provenance } from "../types/store-records.js";
import { bundleOf, type KeyedFile } from "./export-bundle.js";
import {
  type NamedPart,
  partsRefusal,
  providerRan,
  type Refusal,
  type RunView,
  reuseRefusal,
} from "./export-check.js";
import { certifier } from "./export-inputs.js";
import { keyPartsOf } from "./export-parts.js";
import { partsReport } from "./export-report.js";
import { type Part, type PartFile, type PartInspector, snapshotFields } from "./parts.js";

/*
 * Spec 018 D9 (row 018-17): `squeal ci export`'s keys and results. In a
 * fresh checkout of the parts' commit, the job keys each exported test file
 * as a daemon there keys it: the daemon's `WorktreeKeys` over an empty store
 * of the job's own, the runner adapter the daemon builds, each file's
 * closure from the runner, then what its shard observed, through the record
 * path's `observedGrowth` and `addObserved`. Its results are the rows a
 * daemon's record makes of them (`recordsForFile`) at that key, written as
 * the D2 export (`bundleOf`), with each file's `keyParts` (D11). A file
 * goes in only when its shard's read-time evidence certifies the content of
 * every input of its closure here (`certifier`), and its checks have a name
 * each (2026-11-09, reviews of 0.1.421 B1, B4).
 */

export interface CiExportInput {
  readonly root: AbsolutePath;
  readonly worktreeId: WorktreeId;
  /** An empty store of the job's own, removed after the export. */
  readonly store: Store;
  /** Opens the runner adapter the daemon builds for this checkout; called once the parts pass, closed at the end. */
  readonly runner: () => Promise<RunnerAdapter>;
  readonly policy: Policy;
  readonly squealVersion: string;
  /** Allow-listed variables are read from here, as the daemon reads its own. */
  readonly env: NodeJS.ProcessEnv;
  readonly parts: readonly NamedPart[];
  /** `commit` and `dirty` of this checkout: the parts must be of `commit`. */
  readonly header: ExportHeader;
  readonly now: () => EpochMs;
}

/** What the export held and left out. */
export interface CiExportCounts {
  readonly testFiles: number;
  readonly results: number;
  /** Files left out: a failure in their shard. */
  readonly failed: number;
  /** Files left out: this job did not list them, or could not key them. */
  readonly unkeyed: number;
  /** Files left out: an input's content here is not what their shard read, or the shard holds no evidence of it. */
  readonly uncertified: number;
  /** Files left out: two of their checks share a name, and the part has not their locations to name them as the daemon does. */
  readonly ambiguous: number;
  /**
   * Files left out: their worker ran an import of `node:inspector` beside
   * a coverage provider, so the provider could change their outcome (spec
   * 020 D13.4): the part marks them, or, when a provider ran (D19.6,
   * `providerRan`), its workers saw them load it (`PartInspector.loaded`;
   * review of 0.1.443 B1), or their closure here imports it.
   */
  readonly inspector: number;
  /**
   * Files left out: a provider ran, and its workers did not see them run
   * (`PartInspector.unknown`, as in a `vmThreads` pool, or lists that do
   * not read), so whether they loaded `node:inspector` is not known
   * (review of 0.1.443-r2 S1). Not in `inspector`.
   */
  readonly unwatched: number;
}

/** A file left out because its shard's evidence does not certify these inputs' content here. */
export interface UncertifiedFile {
  readonly testFile: TestFileRef;
  readonly inputs: readonly RelativePath[];
}

export type CiExport =
  | { readonly refused: Refusal }
  | {
      readonly bundle: ResultsBundle;
      readonly counts: CiExportCounts;
      readonly uncertified: readonly UncertifiedFile[];
    };

/**
 * The D2 export of `input.parts` at this checkout, or the first reason the
 * parts make none (D9). Throws `AbsolutePathError` as `exportResults` does.
 * Writes the observed entries and environments into `input.store` only.
 */
export async function ciExport(input: CiExportInput): Promise<CiExport> {
  const refused = partsRefusal(input.parts, input.header.commit);
  if (refused !== null) return { refused };
  const runner = await input.runner();
  try {
    return await exportWith(input, runner);
  } finally {
    await runner.close();
  }
}

/**
 * Whether the part names `file`'s checks as the daemon does: no two share a
 * full name, or each check has the location by which `checkNames` named the
 * repeats (D9, review of 0.1.421 B4; row 018-43).
 */
function namedAsDaemon(file: PartFile): boolean {
  const shared = (file.sharedNames ?? []).length > 0;
  return !shared || file.checks.every((check) => check.location !== null);
}

async function exportWith(input: CiExportInput, runner: RunnerAdapter): Promise<CiExport> {
  const { worktreeId, store, parts, header } = input;
  const { keys } = await openDaemonKeys(input);
  const environments = await runner.environment();
  await keys.setEnvironments(environments);
  const environment = environmentRefusal(input, environments);
  if (environment !== null) return { refused: environment };

  const files = parts.flatMap((p) => p.part.testFiles);
  const passed = files.filter((file) => file.outcome !== "fail");
  const named = passed.filter(namedAsDaemon);
  // Spec 020 D13.4 (018's coordinator, 2026-11-10): the part marks such a file beside Squeal's records.
  // D19.6 (review of 0.1.443 B1): beside any provider, the files its workers saw load it, or did not see.
  const ran = parts.filter((p) => providerRan(p.part));
  const watched = ran.map((p) => inspectorFiles(p.part));
  const loaded = new Set(watched.flatMap((w) => w.loaded));
  const unknown = new Set(watched.flatMap((w) => w.unknown));
  const proved = (file: PartFile) => file.noRecord === "inspector" || loaded.has(fileId(file));
  const unwatched = named.filter((file) => !proved(file) && unknown.has(fileId(file))).length;
  const kept = named.filter((file) => !proved(file) && !unknown.has(fileId(file)));
  // D19.6: beside any provider, the project's too, a closure that imports it is left out.
  const covered = new Set(ran.flatMap((p) => p.part.testFiles.map(fileId)));
  const inspects = (file: PartFile, closure: RunnerClosure) =>
    covered.has(fileId(file)) && (closure.packages?.builtins ?? []).includes(INSPECTOR);
  const { closures, report, inspected } = await keyFiles(input.root, runner, keys, kept, inspects);
  const parted = await keyPartsOf(input, keys, environments, closures);
  const certify = certifier(input.root, keys, parts);
  const uncertified: UncertifiedFile[] = [];
  const provenance: Provenance = {
    worktreeId,
    revision: 0,
    commit: header.commit,
    dirty: header.dirty,
    runId: "squeal-ci-export",
    recordedAt: input.now(),
  };
  const exported = report.completedFiles.flatMap((ref): KeyedFile[] => {
    const key = keys.index.key(ref);
    const closure = keys.index.closure(ref);
    const keyParts = parted(ref);
    if (key === null || closure === undefined || keyParts === null) return [];
    const { paths, complete, method } = closure;
    const inputs = certify(ref, paths);
    if (inputs.length > 0) {
      uncertified.push({ testFile: ref, inputs });
      return [];
    }
    const describe = describeFailure;
    const records = recordsForFile({ ref, key, report, previousChecks: [], provenance, describe });
    return [{ file: { ...ref, key, closure: { paths, complete, method }, keyParts }, records }];
  });
  const bundle = bundleOf(store, worktreeId, header, exported);
  const testFiles = bundle.testFiles.length;
  return {
    bundle,
    counts: {
      testFiles,
      results: bundle.results.length,
      failed: files.length - passed.length,
      unkeyed: kept.length - testFiles - uncertified.length - inspected,
      uncertified: uncertified.length,
      ambiguous: passed.length - named.length,
      inspector: named.length - kept.length - unwatched + inspected,
      unwatched,
    },
    uncertified,
  };
}

/**
 * Keys `passed` as a daemon's start and record do: each file the runner
 * lists by its closure, then with what its shard observed beyond it
 * (`observedGrowth`, `addObserved`), stored in the job's store
 * (`writeSeen`). Returns the runner's closures and the report of the files
 * keyed; a file the runner does not list, or whose closure fails, is in
 * neither, and a file `leftOut` names by its closure is only counted.
 */
async function keyFiles(
  root: AbsolutePath,
  runner: RunnerAdapter,
  keys: WorktreeKeys,
  passed: readonly PartFile[],
  leftOut: (file: PartFile, closure: RunnerClosure) => boolean,
): Promise<{ closures: Map<string, RunnerClosure>; report: RunReport; inspected: number }> {
  const listed = new Set((await runner.testFiles()).map(testFileId));
  const closures = new Map<string, RunnerClosure>();
  let inspected = 0;
  for (const file of passed) {
    const ref = refOf(file);
    if (!listed.has(testFileId(ref))) continue;
    const closure = await runner.closure(ref).catch(() => null);
    if (closure === null) continue;
    if (leftOut(file, closure)) {
      inspected++;
      continue;
    }
    closures.set(testFileId(ref), closure);
    keys.setClosure(closure);
  }
  await keys.trackUntracked();
  const report = partsReport(passed.filter((file) => closures.has(testFileId(refOf(file)))));
  const run = keys.beginRun();
  try {
    const growth = await observedGrowth({ root, keys }, report, run);
    for (const { testFile } of report.observed ?? []) {
      const grown = growth.get(testFileId(testFile));
      if (grown !== undefined) keys.addObserved(testFile, grown.add);
    }
  } finally {
    keys.endRun();
  }
  await keys.trackUntracked();
  keys.writeSeen();
  return { closures, report, inspected };
}

/**
 * The first part whose runs are no evidence in this job (`reuseRefusal`): a
 * project the job has no environment of, or ran in another environment.
 */
function environmentRefusal(
  input: CiExportInput,
  environments: readonly RunnerEnvironment[],
): Refusal | null {
  const { store, worktreeId, parts } = input;
  const runs = new Map<ProjectName, RunView>();
  for (const { project, resolvedConfig } of environments) {
    const descriptor = worktreeEnvironment(store, worktreeId, project)?.descriptor ?? null;
    if (descriptor === null) continue;
    runs.set(project, { descriptor, snapshotOptions: snapshotFields(resolvedConfig) });
  }
  const here = { name: "this job's", runner: "this checkout's Vitest", runs };
  for (const named of parts) {
    const refused = reuseRefusal(named, here);
    if (refused !== null) return refused;
  }
  return null;
}

function refOf(file: PartFile): TestFileRef {
  return { project: file.project, path: file.path };
}

const fileId = (file: PartFile): string => testFileId(refOf(file));

/**
 * D19.6: the files `part` names as loading `node:inspector`, and those its
 * workers did not see run, by `testFileId`; with lists that do not read,
 * every file of the part is not seen.
 */
function inspectorFiles(part: Part): { loaded: string[]; unknown: string[] } {
  const inspector: unknown = part.header.coverage?.inspector;
  if (inspector === undefined) return { loaded: [], unknown: [] };
  const { loaded, unknown } = (inspector ?? {}) as Partial<PartInspector>;
  if (!Array.isArray(loaded) || !Array.isArray(unknown)) {
    return { loaded: [], unknown: part.testFiles.map(fileId) };
  }
  return { loaded: loaded.map(testFileId), unknown: unknown.map(testFileId) };
}

/** The builtin a closure's `packages.builtins` names `node:inspector` by. */
const INSPECTOR = "inspector";
