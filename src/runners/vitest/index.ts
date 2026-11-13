import { realpathSync } from "node:fs";
import { WorktreePaths } from "../../core/fs/worktree-paths.js";
import type { AbsolutePath, RelativePath } from "../../core/types/common.js";
import type { TestFileRef } from "../../core/types/keys.js";
import type { RunnerAdapter } from "../../core/types/runner.js";
import type { RunnerTraits } from "../../core/types/runner-traits.js";
import { VitestAdapter } from "./adapter.js";
import type { VitestCoverage } from "./coverage.js";
import { loadVitest, type VitestNode } from "./load.js";
import { vitestTraits } from "./traits.js";
import { VitestWidths, type WidthTable } from "./width.js";

export type { VitestCoverage } from "./coverage.js";

export interface VitestAdapterOptions {
  /** Worktree root. Spec 001 D4: one Vitest instance per worktree. */
  readonly root: AbsolutePath;
  /**
   * Records a fact the adapter worked around as a status note (D7): the
   * fallback to full invalidation, a broken instance it recreates. Dropped
   * when absent.
   */
  readonly note?: (text: string) => void;
  /**
   * Policy `observe.runtimeInputs`, read before each call: the workers carry
   * the runtime-input recorder (D4, task 001-132). Absent: nothing observed.
   */
  readonly observe?: () => boolean;
  /**
   * Added to every worker's env and left out of the environment hash: the
   * daemon's marker for the processes tests leave behind (D12, task 001-142).
   */
  readonly childEnv?: Readonly<Record<string, string>>;
  /**
   * The width of a run without a grant (`RunOptions.workers`): the slow
   * tier's instance takes policy `slow.maxWorkers` (spec 004 D2). Like a
   * grant, at least 2 and never above the project's own `maxWorkers` (001
   * D11 Capacity, task 001-378). Absent: the config's own.
   */
  readonly maxWorkers?: number;
  /**
   * Told at each start the projects whose config turns Vite's dependency
   * optimizer on, none included, so the registration header names only what
   * the newest config does (D4, task 001-181). Dropped when absent.
   */
  readonly optimizer?: (projects: readonly string[]) => void;
  /**
   * Policy `vitest.excludeProjects`, read at each start: Vitest projects the
   * instance never creates, a name no project has noted once (D11, task
   * 001-349). A revision that moves it recreates the instance. Absent: none.
   */
  readonly excludeProjects?: () => readonly string[];
  /**
   * Policy `vitest.exclude`, read at each listing: test-file globs from the
   * worktree root that Squeal never lists, runs, keys or counts (spec 004
   * D7, task 004-81). Absent: none.
   */
  readonly exclude?: () => readonly string[];
  /**
   * Spec 015 D8 (row 015-11): coverage in each run while `enabled` holds,
   * read at each start; a change recreates the instance. Absent: never.
   */
  readonly coverage?: VitestCoverage;
  /**
   * Spec 020 D3.5 (row 020-03): `false`, Vitest writes no results cache
   * (`node_modules/.vite/vitest/<hash>/results.json`), so a one-shot run
   * writes nothing into the project. Absent: Vitest's own, as the daemon runs.
   */
  readonly cache?: false;
  /**
   * Spec 020 row 020-43: told each file of a run as Vitest queues it, when a
   * worker starts to collect it (`onTestModuleQueued`); what it returns is
   * called once the file's module ended, in any state. Absent, as in the
   * daemon: none is told.
   */
  readonly fileStarted?: (testFile: TestFileRef) => () => void;
  /**
   * Spec 020 row 020-50 (#207): told the files of each worker Vitest timed
   * out terminating (`teardownTimeout`), as Vitest logs it, during a run or
   * the instance's close. Absent, as in the daemon: none is told.
   */
  readonly teardown?: (files: readonly RelativePath[]) => void;
}

/**
 * Vitest runner adapter over the project's `vitest/node` (spec 001 D4, D11).
 * Starts the Vitest instance before resolving, so a missing Vitest or a
 * broken config rejects here.
 */
export async function createVitestAdapter(
  options: VitestAdapterOptions,
): Promise<RunnerAdapter & WidthValues> {
  const root = realpathSync(options.root);
  const adapter = new SizedVitestAdapter(
    new VitestWidths(options.maxWorkers),
    new WorktreePaths(root),
    await loadVitest(root),
    options.note,
    options.observe,
    options.childEnv,
    options.optimizer,
    options.excludeProjects,
    options.exclude,
    options.coverage,
    options.cache,
    options.fileStarted,
    options.teardown,
  );
  await adapter.open();
  return adapter;
}

/** What a runner host sends for the widths Vitest's traits answer from (spec 021 D6, row 021-11). */
export interface WidthValues {
  /** The widths of the instance started last; `null` before the first start. */
  widthValues(): WidthTable | null;
}

/**
 * The adapter, each run sized by its hints, whose widths its traits answer
 * from (task 011-37 section 5, rows 011-40 and 011-329): width changes
 * nothing a check stores, so `adapter.ts` holds none of it.
 */
class SizedVitestAdapter extends VitestAdapter implements RunnerAdapter, WidthValues {
  /** Spec 011 C14 (row 011-329): Vitest's, from its widths and its last listing. */
  readonly traits: RunnerTraits;
  readonly #widths: VitestWidths;

  constructor(
    widths: VitestWidths,
    paths: WorktreePaths,
    vitest: VitestNode,
    note?: (text: string) => void,
    observe?: () => boolean,
    childEnv?: Readonly<Record<string, string>>,
    optimizer?: (projects: readonly string[]) => void,
    exclude?: () => readonly string[],
    excludeFiles?: () => readonly string[],
    coverage?: VitestCoverage,
    cache?: false,
    started?: (testFile: TestFileRef) => () => void,
    teardown?: (files: readonly RelativePath[]) => void,
  ) {
    super(
      paths,
      vitest,
      note,
      observe,
      childEnv,
      widths,
      optimizer,
      exclude,
      excludeFiles,
      coverage,
      cache,
      started,
      teardown,
    );
    this.#widths = widths;
    this.traits = vitestTraits({
      widths: () => widths.table(),
      omitted: () => this.omittedTestFiles(),
    });
  }

  widthValues(): WidthTable | null {
    return this.#widths.table();
  }
}
