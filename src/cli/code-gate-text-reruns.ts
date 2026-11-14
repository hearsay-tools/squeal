import type { GateRunReport } from "../core/code/gate/report.js";
import { RUNNER_NAMES } from "../core/code/gate/types.js";
import { compare } from "../core/fs/compare.js";
import { listPaths, plural } from "../core/text.js";

/*
 * Spec 020 D1 (row 020-63): the text report's lines for the files a run
 * ran once more, one line per runner and kind. Row 020-54's reruns under
 * load (`runs[].retried`) and row 020-60's reruns of stored failures
 * (`runs[].storedRerun`) each say how many ran again and each outcome's
 * count with at most `RERUN_NAMED` paths, in the words of their stderr
 * lines. A run with neither gets no line, so its text is as before.
 */

/** How many paths each outcome names; `--json` lists them all. */
const RERUN_NAMED = 3;

type Outcome = "passed" | "failed" | "not-finished";

/** How each load rerun's outcome reads, in its order, as in its stderr line. */
const LOAD_OUTCOMES: readonly (readonly [Outcome, string])[] = [
  ["passed", "passed"],
  ["failed", "failed again"],
  ["not-finished", "did not finish, so the first failure stands"],
];

/** How each stored rerun's outcome reads, in its order, as in its stderr line. */
const STORED_OUTCOMES: readonly (readonly [Outcome, string])[] = [
  ["passed", "passed"],
  ["failed", "failed again"],
  ["not-finished", "did not finish, so the stored failure stands"],
];

/** Each outcome with files: its count and at most `RERUN_NAMED` sorted paths. */
function outcomesText(
  reran: readonly (readonly [string, { readonly outcome: Outcome }])[],
  words: readonly (readonly [Outcome, string])[],
): string {
  return words
    .flatMap(([outcome, said]) => {
      const paths = reran.filter(([, r]) => r.outcome === outcome).map(([path]) => path);
      return paths.length === 0
        ? []
        : [`${paths.length} ${said} (${listPaths(paths.sort(compare), RERUN_NAMED)})`];
    })
    .join(", ");
}

/** Row 020-54: the run's files that failed under load and ran once more; none when none did. */
function loadRerunLine(run: GateRunReport): string[] {
  const reran = Object.entries(run.retried ?? {});
  if (reran.length === 0) return [];
  const highest = reran
    .map(([, r]) => r)
    .reduce((top, r) => (r.load / r.cpus > top.load / top.cpus ? r : top));
  const files = plural(reran.length, `${RUNNER_NAMES[run.runner]} test file`);
  const load = `${highest.load} on ${highest.cpus} CPUs`;
  return [
    `  ${files} failed while the host load was at or over its CPU count (${load}) and ran once more: ${outcomesText(reran, LOAD_OUTCOMES)}`,
  ];
}

/** Row 020-60: the run's stored failures that `--rerun-stored-failures` ran once more; none when none did. */
function storedRerunLine(run: GateRunReport): string[] {
  const reran = Object.entries(run.storedRerun ?? {});
  if (reran.length === 0) return [];
  const files = plural(reran.length, `failed ${RUNNER_NAMES[run.runner]} test file`);
  return [
    `  ${files} read from the stores ran once more (--rerun-stored-failures): ${outcomesText(reran, STORED_OUTCOMES)}`,
  ];
}

/** The run's rerun lines: the load reruns, then the stored reruns. */
export function rerunLines(run: GateRunReport): string[] {
  return [...loadRerunLine(run), ...storedRerunLine(run)];
}
