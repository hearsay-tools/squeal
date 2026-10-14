import type { TestProject, Vitest } from "vitest/node";

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

export class Widths {
  readonly #root: number | undefined;
  readonly #projects: ReadonlyMap<TestProject, number | undefined>;

  constructor(vitest: Vitest) {
    this.#root = vitest.config.maxWorkers;
    this.#projects = new Map(vitest.projects.map((p) => [p, p.config.maxWorkers]));
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
