import type { TestProject, Vitest } from "vitest/node";
import type { TestFileRef } from "../../core/types/keys.js";
import type { VitestHints } from "./adapter.js";

/**
 * The `maxWorkers` a project runs a tier with (spec 001 D11 Capacity, task
 * 001-378): `want` workers, at least `floor`, never above the project's own
 * `ceiling`. The floor is 2 for a project with `isolate: false`, where one
 * worker would take every file of the project, and 1 for any other (011 C10
 * as amended 2026-10-21, row 011-97). A project that set 1 runs at 1. No
 * `want` is the project's own value (`undefined`: Vitest's default).
 */
export function tierWidth(
  want: number | undefined,
  ceiling: number | undefined,
  floor = 1,
): number | undefined {
  if (want === undefined || ceiling === 1) return ceiling;
  const width = Math.max(floor, Math.floor(want));
  return ceiling === undefined ? width : Math.min(width, ceiling);
}

/**
 * At a width of 1 Vitest hands one worker every file of a project that
 * does not isolate them (`groupSpecs`: "Non-isolated single worker can
 * receive all files at once"); a vm pool's `isolate: false` comes from its
 * own resolution, and its files still run one per request.
 */
function batches(project: TestProject): boolean {
  const { isolate, pool } = project.config;
  return isolate === false && pool !== "vmThreads" && pool !== "vmForks";
}

/** Vitest types `maxWorkers` as a number; it is `undefined` unless a config, the CLI or the env set it. */
type Sized = { maxWorkers: number | undefined };

/**
 * Where a run puts a project's files (Vitest's `groupSpecs`): by
 * `sequence.groupOrder`, each group only once the one before it ended, and
 * an isolated project of order 0 that set 1 into a last group of its own.
 * A width of 1 written into a config moves such a project there too; a run
 * that wide starts one file at a time wherever it goes (row 011-97).
 */
type Group = number | "sequential";

/** One project's line of a `WidthTable`. */
export interface WidthEntry {
  readonly project: string;
  /** Its own `maxWorkers`, else the root's; `null` when neither set one. */
  readonly ceiling: number | null;
  readonly floor: number;
  readonly group: Group;
}

/**
 * The widths of one started instance as plain data (spec 021 D6, row
 * 021-11): what `slowWidth` and `tierWidth` answer from, so a runner host
 * can send it to the daemon, whose proxy answers them at once.
 */
export interface WidthTable {
  readonly projects: readonly WidthEntry[];
}

/** The table of `vitest`'s projects, as their configs resolved at its start. */
export function widthTable(vitest: Vitest): WidthTable {
  const root = vitest.config.maxWorkers;
  return {
    projects: vitest.projects.map((p) => {
      const own = p.config.maxWorkers;
      const order = p.config.sequence.groupOrder;
      const group = p.config.isolate && order === 0 && own === 1 ? "sequential" : order;
      return { project: p.name, ceiling: own ?? root ?? null, floor: batches(p) ? 2 : 1, group };
    }),
  };
}

/** A `WidthTable`'s answers to the scheduler's width questions. */
export class WidthAnswers {
  /** By project name: its own ceiling, else the root's, its floor and its group. */
  readonly #byName: ReadonlyMap<string, WidthEntry>;

  constructor(table: WidthTable) {
    this.#byName = new Map(table.projects.map((entry) => [entry.project, entry]));
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
    const width =
      tierWidth(testFiles.length, first.ceiling ?? undefined, first.floor) ?? testFiles.length;
    let count = 0;
    for (const { project } of testFiles) {
      if (count >= width || this.#byName.get(project)?.group !== first.group) break;
      count++;
    }
    return Math.max(1, count);
  }

  /**
   * The workers a run of `project`'s files takes at a grant of `grant` (spec
   * 011 C4 step 5, task 001-366): `tierWidth` under its own ceiling and
   * floor. An unknown project's run fails on its own: `grant`, at least 1.
   */
  of(project: string, grant: number): number {
    const known = this.#byName.get(project);
    return tierWidth(grant, known?.ceiling ?? undefined, known?.floor) ?? Math.max(1, grant);
  }
}

/**
 * The width of one instance's runs. Vitest reads `maxWorkers` from the
 * resolved configs at each run (`resolveMaxWorkers`: the project's, then the
 * root's, then its CPU default), so a warm instance is resized by writing it
 * there before the run (probe P1, `tasks/001-378/notes.md`). The values the
 * configs resolved to at the start are each project's own ceiling, and a run
 * that wants nothing gets them back.
 */
export class Widths extends WidthAnswers {
  readonly #root: number | undefined;
  /** Each project's own `maxWorkers`, written in place of the config's for a run. */
  readonly #projects: ReadonlyMap<TestProject, number | undefined>;
  readonly table: WidthTable;

  constructor(vitest: Vitest) {
    const table = widthTable(vitest);
    super(table);
    this.table = table;
    this.#root = vitest.config.maxWorkers;
    this.#projects = new Map(vitest.projects.map((p) => [p, p.config.maxWorkers]));
  }

  /**
   * Sizes `vitest`'s next run of `testFiles` for `want` workers. Vitest
   * throws when two projects of one group resolve to different widths, so
   * every project runs at the run's floor: the widest of its files' at a
   * grant of 1, as the scheduler's tier asks for (row 011-97). A sibling
   * with no file in the run raises none (review 0.1.255 B3).
   */
  apply(vitest: Vitest, want: number | undefined, testFiles: readonly TestFileRef[]): void {
    const floor = Math.max(1, ...testFiles.map((f) => this.of(f.project, 1)));
    // The root project's config is the instance's; a project without a value of its own reads it.
    (vitest.config as Sized).maxWorkers = tierWidth(want, this.#root, floor);
    for (const [project, own] of this.#projects) {
      if (project.config !== vitest.config && own !== undefined) {
        (project.config as Sized).maxWorkers = tierWidth(want, own, floor);
      }
    }
  }
}

/**
 * The adapter's hints (task 011-37 section 5, row 011-40): the widths of the
 * instance it started last, each run sized under them, and the table the
 * traits' widths answer from. `maxWorkers` is the width of a run
 * without a grant (spec 004 D2: the slow tier's instance), under the
 * project's own as a grant is (D11, task 001-378).
 */
export class VitestWidths implements VitestHints {
  #widths: Widths | null = null;

  constructor(readonly maxWorkers?: number) {}

  started(vitest: Vitest): void {
    this.#widths = new Widths(vitest);
  }

  size(vitest: Vitest, workers: number | undefined, testFiles: readonly TestFileRef[]): void {
    this.#widths?.apply(vitest, workers ?? this.maxWorkers, testFiles);
  }

  /**
   * The table Vitest's traits answer from (`vitestTraits`, row 011-329), in
   * this process and sent by a runner host (spec 021 D6): the slow width
   * (spec 004 D2, review 001-394 B2) and a backlog tier's (011 C4 step 5,
   * task 001-366), under each project's own `maxWorkers`. `null` before a
   * start: the traits' defaults.
   */
  table(): WidthTable | null {
    return this.#widths?.table ?? null;
  }
}
