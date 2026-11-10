import { readHead } from "../daemon-loop/head.js";
import { readObjectFormat } from "../hash/git-index.js";
import { createFsHasher } from "../hash/hasher.js";
import { testFileId } from "../keys/reverse-index.js";
import { WorktreeKeys } from "../scheduler/keying.js";
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
  type Refusal,
  type RunView,
  reuseRefusal,
} from "./export-check.js";
import { certifier } from "./export-inputs.js";
import { keyPartsOf } from "./export-parts.js";
import { partsReport } from "./export-report.js";
import { type PartFile, snapshotFields } from "./parts.js";

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
  /** Files left out: two of their checks share a name, which a part cannot name as the daemon does. */
  readonly ambiguous: number;
  /**
   * Files left out: their worker ran an import of `node:inspector` beside
   * Squeal's coverage provider, so the provider could change their outcome
   * (spec 020 D13.4).
   */
  readonly inspector: number;
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

async function exportWith(input: CiExportInput, runner: RunnerAdapter): Promise<CiExport> {
  const { worktreeId, store, parts, header } = input;
  const keys = await openKeys(input);
  const environments = await runner.environment();
  await keys.setEnvironments(environments);
  const environment = environmentRefusal(input, environments);
  if (environment !== null) return { refused: environment };

  const files = parts.flatMap((p) => p.part.testFiles);
  const passed = files.filter((file) => file.outcome !== "fail");
  const named = passed.filter((file) => (file.sharedNames ?? []).length === 0);
  // Spec 020 D13.4 (018's coordinator, 2026-11-10): the part marks such a file only beside the provider.
  const kept = named.filter((file) => file.noRecord !== "inspector");
  const { closures, report } = await keyFiles(input.root, runner, keys, kept);
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
      unkeyed: kept.length - testFiles - uncertified.length,
      uncertified: uncertified.length,
      ambiguous: passed.length - named.length,
      inspector: named.length - kept.length,
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
 * neither.
 */
async function keyFiles(
  root: AbsolutePath,
  runner: RunnerAdapter,
  keys: WorktreeKeys,
  passed: readonly PartFile[],
): Promise<{ closures: Map<string, RunnerClosure>; report: RunReport }> {
  const listed = new Set((await runner.testFiles()).map(testFileId));
  const closures = new Map<string, RunnerClosure>();
  for (const file of passed) {
    const ref = refOf(file);
    if (!listed.has(testFileId(ref))) continue;
    const closure = await runner.closure(ref).catch(() => null);
    if (closure === null) continue;
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
  return { closures, report };
}

/** The daemon's keys of this worktree, over the job's store, bootstrapped as at a daemon's start. */
async function openKeys(input: CiExportInput): Promise<WorktreeKeys> {
  const { root, worktreeId, store, policy, squealVersion, env } = input;
  const objectFormat = await readObjectFormat(root);
  const keys = new WorktreeKeys({
    root,
    worktreeId,
    store,
    hasher: createFsHasher(root, objectFormat),
    objectFormat,
    policy,
    squealVersion,
    env,
    onExtraFiles: () => {},
  });
  await keys.bootstrap(() => readHead(root));
  return keys;
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
