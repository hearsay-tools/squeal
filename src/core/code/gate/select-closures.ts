import { compare } from "../../fs/compare.js";
import { testFileId } from "../../keys/reverse-index.js";
import { plural } from "../../text.js";
import type { RelativePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { Evidence, TestFileEvidence } from "./types.js";

/*
 * Row 020-31 (#193; spec 020 D7, D14.4): the test files of each node:test
 * project whose static closure is incomplete, scoped to this check. The
 * adapter tells the list at open, before selection (`closures` of its
 * options); the gate tells it after selection, once per project: how many
 * of the files it selected, and every file in the report.
 */

/** One test file whose static closure is incomplete, and the graph's reasons, as an adapter tells it. */
export type IncompleteClosure = readonly [RelativePath, readonly string[]];

/** D7: one test file of a project whose static closure is incomplete. */
export interface ClosureGapFile {
  readonly path: RelativePath;
  /** The graph's reasons, such as `import() with a computed specifier at <file>:<line>:<column>`. */
  readonly reasons: readonly string[];
  /**
   * The selection chose it and the scope runs it: this check ran it or
   * read its evidence. A file the scope leaves out (D14.2) is not.
   */
  readonly selected: boolean;
}

/** D7's `incompleteClosures`: one node:test project's files, every one, selected or not. */
export interface ClosureGaps {
  readonly runner: "node-test";
  readonly project: string;
  /** By path. */
  readonly files: readonly ClosureGapFile[];
}

/** How many selected files the line names before it only counts them (as the adapter's note did). */
const NAMED = 3;

/**
 * Each project of `lists` with a file whose closure is incomplete, by
 * project name, its files by path, each `selected` when `inCheck` holds
 * it. `inCheck` is the node:test files the scope runs.
 */
export function closureGaps(
  lists: ReadonlyMap<string, readonly IncompleteClosure[]>,
  inCheck: readonly TestFileRef[],
): ClosureGaps[] {
  const chosen = new Set(inCheck.map(testFileId));
  return [...lists]
    .filter(([, files]) => files.length > 0)
    .sort(([a], [b]) => compare(a, b))
    .map(([project, files]) => ({
      runner: "node-test" as const,
      project,
      files: files
        .map(([path, reasons]) => ({
          path,
          reasons: [...reasons],
          selected: chosen.has(testFileId({ project, path })),
        }))
        .sort((a, b) => compare(a.path, b.path)),
    }));
}

/**
 * Tells `note` the line of each project of `lists` with a file whose
 * closure is incomplete, scoped to `picked`'s node:test files the scope
 * runs; the evidence's `incompleteClosures`, absent when none has one.
 */
export function tellClosures(
  lists: ReadonlyMap<string, readonly IncompleteClosure[]>,
  picked: readonly {
    readonly kind: TestFileEvidence["runner"];
    readonly run: readonly TestFileRef[];
  }[],
  note: (text: string) => void,
): Pick<Evidence, "incompleteClosures"> {
  const inCheck = picked.filter((p) => p.kind === "node-test").flatMap((p) => p.run);
  const gaps = closureGaps(lists, inCheck);
  for (const gap of gaps) note(closureLine(gap));
  return gaps.length === 0 ? {} : { incompleteClosures: gaps };
}

/**
 * D14.4: the line of one project, after selection: how many of its files
 * with an incomplete closure are in this check, the first of them, what
 * that means for the others, and where every file is listed.
 */
export function closureLine({ project, files }: ClosureGaps): string {
  const selected = files.filter((f) => f.selected).map((f) => f.path);
  const more = selected.length > NAMED ? ` and ${selected.length - NAMED} more` : "";
  const named = selected.length === 0 ? "" : `: ${selected.slice(0, NAMED).join(", ")}${more}`;
  const verb = selected.length === 1 ? "is" : "are";
  const others = files.length - selected.length;
  return [
    `node-test project ${JSON.stringify(project)}:`,
    `${selected.length} of ${plural(files.length, "test file")} with an incomplete static closure ${verb} in this check${named}.`,
    ...(others === 0
      ? []
      : [
          `The gate selects test files by their static imports, so ${others === 1 ? "the other one does" : `the other ${others} do`} not run for a changed path ${others === 1 ? "it loads" : "they load"} only through a computed import() or require().`,
        ]),
    `The --json report lists ${files.length === 1 ? "it" : `all ${files.length}`} in incompleteClosures.`,
  ].join(" ");
}
