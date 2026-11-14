import { compare } from "../../fs/compare.js";
import { testFileId } from "../../keys/reverse-index.js";
import type { RelativePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { GlobalSetupEntry, RunnerAdapter } from "../../types/runner.js";
import {
  type GateScope,
  type LeftOutGroup,
  type LeftOutRef,
  placeFile,
  type ScopeTally,
} from "./scope.js";
import {
  loadedSetupFiles,
  projectInputs,
  type WholeProject,
  wholeProjects,
} from "./setup-selection.js";
import type { ChangedSet, TestFileEvidence } from "./types.js";

/*
 * Spec 020 D14.4 (row 020-15b, which carries 020-16a): what one run of the
 * gate will do, told after selection and before the first run, so before
 * any global setup, `setupFiles` or `prepare` runs. It reads only what the
 * selection already gave, the evidence known without a run, and the
 * runners' static graphs: no test runs. Review 0.1.432 B2: a file known
 * from the stores or the parts does not run, so it starts no setup.
 * Row 020-57 (#212): a `setupFiles` entry is loaded by its project's
 * selected files, and a changed path every test file of a project depends
 * on is named with the projects it selects whole (`setup-selection.ts`).
 */

/** One runner's selected files, by check group, and how many of them run. */
export interface RunnerSelection {
  readonly runner: TestFileEvidence["runner"];
  /** The selected files the scope runs, `--test` files among them. */
  readonly files: number;
  /**
   * Of `files`, those the runner runs: the ones with no evidence known
   * without a run. A node:test entry's run still waits for its `prepare`.
   */
  readonly run: number;
  /** Of `files`, those whose evidence is read from the stores (D11.7) or the parts (D13.2). */
  readonly known: { readonly store: number; readonly parts: number };
  /** The selected files by group, in the groups' ownership order; empty when the run has no scope. */
  readonly groups: readonly { readonly name: string; readonly files: number }[];
  /**
   * D3.1 (row 020-35): of `files`, those only their declared `inputs` at
   * the base chose, by path; absent when none.
   */
  readonly byInputs?: readonly RelativePath[];
}

/** D14.4: the selection, told before the first run. */
export interface SelectionSummary {
  /** One per runner opened, in the order they run (D18.4); every node:test entry in one. */
  readonly runners: readonly RunnerSelection[];
  /** D14.3: the test groups out of scope; empty when the run has no scope. */
  readonly leftOut: readonly LeftOutGroup[];
  /**
   * The global setups that run: those of projects with a file the runner
   * runs, and the root project's when the runner runs any file.
   */
  readonly setups: readonly GlobalSetupEntry[];
  /**
   * Each path of a changed function that no runner lists as a test file
   * and no selected test file loads, so its functions will read
   * `no-loader`; sorted. A path `excluded` matches is not looked for. Row
   * 020-57: a `setupFiles` entry is loaded when a selected file of its
   * project runs in the fitted plan, as each run's record holds it, or
   * its evidence from the stores or the parts measured it (R1, review
   * 0.1.483 B1: not when the early stop leaves every such file out).
   * With `coverage.children` (row 020-34), only when no selected file runs
   * or is read; else such a path is in `childMayLoad`.
   */
  readonly unloaded: readonly RelativePath[];
  /**
   * D12, D14.4 (row 020-34): with `coverage.children`, the paths
   * `unloaded` would hold while some selected file runs or is read: a
   * process it starts may still load one, and its record then measures
   * it. Sorted; absent when none.
   */
  readonly childMayLoad?: readonly RelativePath[];
  /**
   * Row 020-57 (#212): per runner, the changed paths every test file of a
   * project depends on (config, setup and global setup inputs), so D3.1
   * selected those projects whole; absent when none.
   */
  readonly wholeProjects?: readonly WholeProject[];
}

/** One opened runner and what the selection gave it (D3.1, D14.2). */
export interface Picked {
  readonly kind: TestFileEvidence["runner"];
  readonly adapter: RunnerAdapter;
  /** Every test file it lists. */
  readonly listed: readonly TestFileRef[];
  /** The selected files the scope runs. */
  readonly run: readonly TestFileRef[];
  /** The selected files the scope leaves out. */
  readonly leftOut: readonly LeftOutRef[];
  /** D3.1 (row 020-35): the selected files only their declared `inputs` chose; absent when none. */
  readonly byInputs?: readonly TestFileRef[];
}

/** The evidence of selected files known without a run (D11.7, D13.2), by the selection's refs. */
export type KnownEvidence = ReadonlyMap<TestFileRef, TestFileEvidence>;

/**
 * D14.4: tells `tell` the summary of `picked`, the runners' selection,
 * with the left-out groups of `tally` and the files `known` keeps from
 * running; nothing when `tell` is absent. `planned` says which selected
 * files the fitted plan runs (R1, review 0.1.483 B1).
 */
export async function tellSelection(
  tell: ((summary: SelectionSummary) => void) | undefined,
  picked: readonly Picked[],
  changed: ChangedSet,
  context: {
    readonly scope?: GateScope | undefined;
    readonly tally: ScopeTally | null;
    readonly known: KnownEvidence;
    readonly planned: (ref: TestFileRef) => boolean;
    readonly excluded?: ((path: RelativePath) => boolean) | undefined;
    readonly children?: boolean | undefined;
  },
): Promise<void> {
  if (tell === undefined) return;
  const { scope, tally, known, planned, excluded = () => false } = context;
  const leftOut = tally?.evidence([]).leftOut ?? [];
  const summary = await summarize(picked, changed, { scope, leftOut, known, planned, excluded });
  tell(context.children === true ? withChildren(summary) : summary);
}

/**
 * D12, D14.4 (row 020-34): with `coverage.children`, a process a selected
 * file starts may load a path no closure holds, and its record then
 * measures it; so while some selected file runs or is read, `summary`'s
 * unloaded paths are told as `childMayLoad`. With none, they stay
 * `unloaded`: nothing can measure them.
 */
function withChildren(summary: SelectionSummary): SelectionSummary {
  const { unloaded, ...rest } = summary;
  if (unloaded.length === 0 || summary.runners.every((r) => r.files === 0)) return summary;
  return { ...rest, unloaded: [], childMayLoad: unloaded };
}

/**
 * The summary of `picked`: the counts, the left-out groups `leftOut`, the
 * setups of the files that run, those `known` holds left out, and the
 * paths of `changed`'s functions that no selected file loads. A path
 * `excluded` matches needs no loader (D6). Row 020-57: a `setupFiles`
 * entry has a loader only through a file `planned` runs or `known`'s
 * evidence that measured it.
 */
export async function summarize(
  picked: readonly Picked[],
  changed: ChangedSet,
  context: {
    readonly scope: GateScope | undefined;
    readonly leftOut: readonly LeftOutGroup[];
    readonly known: KnownEvidence;
    /** A selected file the fitted plan runs (D17.1: not one the early stop leaves out). */
    readonly planned: (ref: TestFileRef) => boolean;
    readonly excluded: (path: RelativePath) => boolean;
  },
): Promise<SelectionSummary> {
  const { known } = context;
  const kinds = [...new Set(picked.map((p) => p.kind))];
  const runners = kinds.map((runner): RunnerSelection => {
    const of = picked.filter((p) => p.kind === runner);
    const selected = of.flatMap((p) => p.run);
    const from = (where: TestFileEvidence["from"]) =>
      selected.filter((ref) => known.get(ref)?.from === where).length;
    const declared = new Set(of.flatMap((p) => p.byInputs ?? []).map(testFileId));
    const byInputs = selected.filter((ref) => declared.has(testFileId(ref))).map((r) => r.path);
    return {
      runner,
      files: selected.length,
      run: selected.filter((ref) => !known.has(ref)).length,
      known: { store: from("store"), parts: from("parts") },
      groups: byGroup(context.scope, runner, selected),
      ...(byInputs.length === 0 ? {} : { byInputs: [...new Set(byInputs)].sort(compare) }),
    };
  });
  const runs = picked.map((p) => ({ ...p, run: p.run.filter((ref) => !known.has(ref)) }));
  const setups = (await Promise.all(runs.map(setupsOf))).flat();
  const candidates = [...new Set(changed.functions.map((f) => f.path))].filter(
    (path) => !context.excluded(path),
  );
  const inputs = await projectInputs(picked);
  const blobs = new Map(changed.functions.map((f) => [f.path, f.blob]));
  const loaders = {
    planned: context.planned,
    known,
    blob: (path: RelativePath) => blobs.get(path),
  };
  const setupFiles = loadedSetupFiles(inputs, loaders);
  const unloaded = (await unloadedPaths(picked, candidates)).filter((p) => !setupFiles.has(p));
  const whole = wholeProjects(inputs, changed.paths, known);
  const { leftOut } = context;
  return {
    runners,
    leftOut,
    setups,
    unloaded,
    ...(whole.length === 0 ? {} : { wholeProjects: whole }),
  };
}

/** The files `run` holds per group of `scope`, in its ownership order; none with no scope. */
function byGroup(
  scope: GateScope | undefined,
  runner: TestFileEvidence["runner"],
  run: readonly TestFileRef[],
): RunnerSelection["groups"] {
  if (scope === undefined) return [];
  const counts = new Map<string, number>();
  for (const ref of run) {
    const { group } = placeFile(scope, runner, ref);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  const order = scope.groups.map((g) => g.name);
  return [...counts]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([name, files]) => ({ name, files }));
}

/**
 * The global setups a runner's run of `picked.run` starts (Vitest runs the
 * root project's with any file): none when no file of it runs, or when the
 * runner has no global setup.
 */
async function setupsOf(picked: Picked): Promise<readonly GlobalSetupEntry[]> {
  if (picked.run.length === 0 || picked.adapter.globalSetups === undefined) return [];
  const projects = new Set(picked.run.map((ref) => ref.project));
  const entries = await picked.adapter.globalSetups();
  return entries.filter((e) => e.root || projects.has(e.project));
}

/**
 * The `candidates` that no runner lists and no selected file's closure
 * loads. Every file that loads a changed path is selected (D3.1), so the
 * selected files' closures are enough. It stops once each candidate is
 * found. A closure the runner cannot give may load any path: then no
 * candidate is told.
 */
async function unloadedPaths(
  picked: readonly Picked[],
  candidates: readonly RelativePath[],
): Promise<RelativePath[]> {
  const listed = new Set(picked.flatMap((p) => p.listed.map((ref) => ref.path)));
  const left = new Set(candidates.filter((path) => !listed.has(path)));
  for (const { adapter, run, leftOut } of picked) {
    for (const ref of [...run, ...leftOut.map((l) => l.ref)]) {
      if (left.size === 0) return [];
      const closure = await adapter.closure(ref).catch(() => null);
      if (closure === null) return [];
      for (const path of closure.paths) left.delete(path);
    }
  }
  return [...left].sort(compare);
}
