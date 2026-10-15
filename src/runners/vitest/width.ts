import type { TestProject, Vitest } from "vitest/node";
import type { TestFileRef } from "../../core/types/index.js";

/**
 * The `maxWorkers` a project runs a tier with (spec 001 D11 Capacity, task
 * 001-378): `want` workers, at least 2, never above the project's own
 * `ceiling`. A project that set 1 runs at 1: with `isolate: false` one worker
 * then takes every file of the project, which a width of 2 would change. No
 * `want` is the project's own value (`undefined`: Vitest's default).
 */
export function tierWidth(
  want: number | undefined,
  ceiling: number | undefined,
): number | undefined {
  if (want === undefined || ceiling === 1) return ceiling;
  const width = Math.max(2, Math.floor(want));
  return ceiling === undefined ? width : Math.min(width, ceiling);
}

/**
 * The width of one instance's runs. Vitest reads `maxWorkers` from the
 * resolved configs at each run (`resolveMaxWorkers`: the project's, then the
 * root's, then its CPU default), so a warm instance is resized by writing it
 * there before the run (probe P1, `tasks/001-378/notes.md`). The values the
 * configs resolved to at the start are each project's own ceiling, and a run
 * that wants nothing gets them back.
 */
/** Vitest types `maxWorkers` as a number; it is `undefined` unless a config, the CLI or the env set it. */
type Sized = { maxWorkers: number | undefined };

/**
 * Where a run puts a project's files (Vitest's `groupSpecs`): by
 * `sequence.groupOrder`, each group only once the one before it ended, and
 * an isolated project of order 0 that set 1 into a last group of its own.
 */
type Group = number | "sequential";

export class Widths {
  readonly #root: number | undefined;
  readonly #projects: ReadonlyMap<TestProject, number | undefined>;
  /** By project name: its own ceiling, else the root's, and its group. */
  readonly #byName: ReadonlyMap<string, { ceiling: number | undefined; group: Group }>;

  constructor(vitest: Vitest) {
    this.#root = vitest.config.maxWorkers;
    this.#projects = new Map(vitest.projects.map((p) => [p, p.config.maxWorkers]));
    this.#byName = new Map(
      vitest.projects.map((p) => {
        const own = p.config.maxWorkers;
        const order = p.config.sequence.groupOrder;
        const group = p.config.isolate && order === 0 && own === 1 ? "sequential" : order;
        return [p.name, { ceiling: own ?? this.#root, group }];
      }),
    );
  }

  /**
   * How many of `testFiles`, in order, one slow run starts at once (spec 004
   * D2, review 001-394 B2): the first file's group's, up to its width. The
   * slow instance's width and a slow grant are each at least one worker per
   * file, so the width is `tierWidth` of the files under the ceiling. An
   * unknown project's run fails on its own: all of them.
   */
  atOnce(testFiles: readonly TestFileRef[]): number {
    const first = testFiles[0] === undefined ? undefined : this.#byName.get(testFiles[0].project);
    if (first === undefined) return testFiles.length;
    const width = tierWidth(testFiles.length, first.ceiling) ?? testFiles.length;
    let count = 0;
    for (const { project } of testFiles) {
      if (count >= width || this.#byName.get(project)?.group !== first.group) break;
      count++;
    }
    return Math.max(1, count);
  }

  /** Sizes `vitest`'s next run for `want` workers. */
  apply(vitest: Vitest, want: number | undefined): void {
    // The root project's config is the instance's; a project without a value of its own reads it.
    (vitest.config as Sized).maxWorkers = tierWidth(want, this.#root);
    for (const project of vitest.projects) {
      const own = this.#projects.get(project);
      if (project.config !== vitest.config && own !== undefined) {
        (project.config as Sized).maxWorkers = tierWidth(want, own);
      }
    }
  }
}
