import { compare } from "../../fs/compare.js";
import type { RelativePath } from "../../types/common.js";
import type { FileHash, TestFileRef } from "../../types/keys.js";
import type { RunnerEnvironment } from "../../types/runner.js";
import type { KnownEvidence, Picked } from "./prerun.js";
import type { TestFileEvidence } from "./types.js";

/*
 * Spec 020 D14.4, row 020-57 (#212): what a changed path every test file
 * of a project depends on does to the selection, told before the first
 * run. A runner's environment files (config, setup and global setup with
 * their closures, `RunnerEnvironment.files`) re-run every test file of
 * the project in the daemon, so D3.1 selects the project whole. A
 * `setupFiles` entry runs in each test file's own process before its
 * tests, so each completed file's record holds it (evaluate.ts
 * `standing()`): its functions have loaders though no test file imports
 * it. A config or global setup file runs in the runner's own process, so
 * no record holds it and its functions still read `no-loader`.
 */

/** Row 020-57: one runner's changed paths that every test file of a project depends on. */
export interface WholeProject {
  readonly runner: TestFileEvidence["runner"];
  /** The changed paths, sorted; `setupFiles` entries first. */
  readonly paths: readonly RelativePath[];
  /** Of `paths`, the `setupFiles` entries of a project in `projects`. */
  readonly setupFiles: readonly RelativePath[];
  /** The projects whose environment holds one of `paths`, sorted; `""` is a runner's root project. */
  readonly projects: readonly string[];
  /** Their selected files the scope runs, `--test` files among them. */
  readonly files: number;
  /** Of `files`, those the runner runs: the ones with no evidence known without a run. */
  readonly run: number;
}

/** One project's environment inputs, read without a run. */
interface ProjectInputs {
  readonly runner: TestFileEvidence["runner"];
  readonly project: string;
  /** Every test file of the project depends on these. */
  readonly files: ReadonlySet<RelativePath>;
  /** Its `setupFiles` entries: each test file runs them in its own process. */
  readonly setupFiles: ReadonlySet<RelativePath>;
  /** Its selected files the scope runs. */
  readonly selected: readonly TestFileRef[];
}

/**
 * Row 020-57: the `setupFiles` entries that `environment`'s resolved
 * config names, relative to the worktree root. Vitest's canonical config
 * keeps them at its top level (`src/runners/vitest/environment.ts`); this
 * is the one place the gate reads that shape. A config of another shape,
 * or an entry outside the worktree, gives none, so a changed path keeps
 * the no-loader line it had. Not read: what a setup file imports, which
 * each record holds too (a follow-up adapter member may give it).
 */
export function setupFilesOf(
  environment: Pick<RunnerEnvironment, "resolvedConfig">,
): RelativePath[] {
  let config: unknown;
  try {
    config = JSON.parse(environment.resolvedConfig);
  } catch {
    return [];
  }
  if (typeof config !== "object" || config === null || !("setupFiles" in config)) return [];
  const { setupFiles } = config;
  if (!Array.isArray(setupFiles)) return [];
  return setupFiles.filter(
    (file): file is RelativePath =>
      typeof file === "string" &&
      file !== "" &&
      !file.startsWith("/") &&
      !file.startsWith("../") &&
      !/^[A-Za-z]:/.test(file),
  );
}

/**
 * Each project's environment inputs, of every pick with a selected file
 * the scope runs; a runner whose `environment()` rejects gives none.
 */
export async function projectInputs(picked: readonly Picked[]): Promise<ProjectInputs[]> {
  const inputs: ProjectInputs[] = [];
  for (const { kind, adapter, run } of picked) {
    if (run.length === 0) continue;
    // A throw before its promise, as a rejection, gives none.
    const environments = await Promise.resolve()
      .then(() => adapter.environment())
      .catch(() => []);
    for (const environment of environments) {
      inputs.push({
        runner: kind,
        project: environment.project,
        files: new Set(environment.files),
        setupFiles: new Set(setupFilesOf(environment)),
        selected: run.filter((ref) => ref.project === environment.project),
      });
    }
  }
  return inputs;
}

/** Row 020-57 R1 (review 0.1.483 B1): what gives a `setupFiles` entry a loader before the run. */
export interface SetupLoaders {
  /**
   * A selected file the fitted plan runs: not one the early stop leaves
   * out (D17.1), nor one the stores or the parts give.
   */
  readonly planned: (ref: TestFileRef) => boolean;
  /** The evidence of selected files the stores or the parts give (D11.7, D13.2). */
  readonly known: KnownEvidence;
  /** A changed path's blob at the head; absent when no changed function is in it. */
  readonly blob: (path: RelativePath) => FileHash | undefined;
}

/**
 * The `setupFiles` entries that a selected file of their own project will
 * measure: one the fitted plan runs, as each run's record holds them, or
 * one whose evidence from the stores or the parts measured the entry at
 * its head bytes. A function of such an entry has a loader though no
 * closure holds it (row 020-57). Any other entry keeps its no-loader
 * line: review 0.1.483 B1, where the early stop left every file out.
 */
export function loadedSetupFiles(
  inputs: readonly ProjectInputs[],
  loaders: SetupLoaders,
): Set<RelativePath> {
  const loaded = new Set<RelativePath>();
  for (const { setupFiles, selected } of inputs) {
    for (const path of setupFiles) {
      const blob = loaders.blob(path);
      const measuredBy = (ref: TestFileRef) =>
        loaders.planned(ref) || measures(loaders.known.get(ref), path, blob);
      if (selected.some(measuredBy)) loaded.add(path);
    }
  }
  return loaded;
}

/**
 * Whether `evidence`, given without a run, measured `path` at its head
 * bytes `blob`, as D5 reads a record (`standing()` in `evaluate.ts`).
 */
function measures(
  evidence: TestFileEvidence | undefined,
  path: RelativePath,
  blob: FileHash | undefined,
): boolean {
  const record = evidence?.completed === true ? evidence.record : null;
  if (record === null || blob === undefined || record.unread.includes(path)) return false;
  return record.sources.some((source) => source.path === path && source.blob === blob);
}

/**
 * Per runner, the paths of `changed` that a project's environment holds,
 * with the projects and their selected files; `known` counts those that
 * do not run. Only projects with a selected file in scope count; none
 * when no changed path is such an input.
 */
export function wholeProjects(
  inputs: readonly ProjectInputs[],
  changed: readonly RelativePath[],
  known: KnownEvidence,
): WholeProject[] {
  const runners = [...new Set(inputs.map((i) => i.runner))];
  return runners.flatMap((runner): WholeProject[] => {
    const hit = inputs.filter(
      (i) => i.runner === runner && i.selected.length > 0 && changed.some((p) => i.files.has(p)),
    );
    if (hit.length === 0) return [];
    const paths = changed.filter((p) => hit.some((i) => i.files.has(p)));
    const setupFiles = paths.filter((p) => hit.some((i) => i.setupFiles.has(p)));
    const selected = [...new Set(hit.flatMap((i) => i.selected))];
    const projects = [...new Set(hit.map((i) => i.project))].sort(compare);
    return [
      {
        runner,
        paths: [...setupFiles, ...paths.filter((p) => !setupFiles.includes(p))],
        setupFiles,
        projects,
        files: selected.length,
        run: selected.filter((ref) => !known.has(ref)).length,
      },
    ];
  });
}
