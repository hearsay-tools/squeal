import { declareTraits, type RunnerTraits } from "../../core/types/runner-traits.js";
import { WidthAnswers, type WidthEntry, type WidthTable } from "./width.js";

/*
 * Spec 011 C14 (row 011-329): Vitest's traits. Its widths come from the
 * `WidthTable` of the instance it started last, its omitted count from its
 * last listing; its fast instance honours `RunOptions.checks` (013 V4, row
 * 011-135). The in-process adapter and the runner host's proxy answer from
 * the same values through this one statement (spec 021 D6, D7). Light: no
 * adapter and no Vitest load with it.
 */

/** What Vitest's traits answer from, read at each answer; `undefined`, not known. */
export interface VitestTraitValues {
  /** The `WidthTable` of the instance started last, as a host sends it; one that does not decode is none. */
  readonly widths: () => unknown;
  /** The files the last listing left out (spec 005 D8 step 3). */
  readonly omitted: () => number | undefined;
}

/** No values: before an adapter exists, and while its host is gone (spec 021 D20.1). */
const NO_VALUES: VitestTraitValues = { widths: () => undefined, omitted: () => undefined };

/** Vitest's traits over `values`. */
export function vitestTraits(values: VitestTraitValues = NO_VALUES): RunnerTraits {
  // Decoded once per table: a table is replaced whole at an instance's start.
  let table: unknown;
  let decoded: WidthAnswers | null = null;
  const widths = (): WidthAnswers | null => {
    const now = values.widths();
    if (now !== table) {
      table = now;
      decoded = decodeWidths(now);
    }
    return decoded;
  };
  return declareTraits({
    omittedTestFiles: () => values.omitted(),
    slowWidth: (testFiles) => widths()?.atOnce(testFiles),
    tierWidth: (testFile, grant) => widths()?.of(testFile.project, grant),
    focuses: () => true,
  });
}

/** The answers of a `WidthTable` sent as `unknown`; `null` when it is none or does not decode. */
export function decodeWidths(table: unknown): WidthAnswers | null {
  if (typeof table !== "object" || table === null) return null;
  const { projects } = table as Partial<WidthTable>;
  if (!Array.isArray(projects) || !projects.every(isWidthEntry)) return null;
  return new WidthAnswers({ projects });
}

function isWidthEntry(entry: unknown): entry is WidthEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const { project, ceiling, floor, group } = entry as Record<string, unknown>;
  return (
    typeof project === "string" &&
    (ceiling === null || typeof ceiling === "number") &&
    typeof floor === "number" &&
    (typeof group === "number" || group === "sequential")
  );
}
