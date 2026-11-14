import type { GateReport } from "../core/code/gate/report.js";
import type { LeftOutGroup } from "../core/code/gate/scope.js";
import { plural } from "../core/text.js";

/*
 * Spec 020 D14.3 (rows 020-15, 020-61, #203): what the scope left out, in
 * words: the verdict line's groups and the `--test` command for each edited
 * test file among them, and the count the pre-run line gives per group.
 */

/**
 * D14.3, D14.4: what `selected` test files of a group the scope left out
 * do, and the flag that runs them, after the words that count them; the
 * verdict line and the pre-run print both say it.
 */
export function loadsChangedText(selected: number, add: string): string {
  const one = selected === 1;
  return `${one ? "loads" : "load"} changed code; add ${add} to run ${one ? "it" : "them"}`;
}

/**
 * D14.3, row 020-61: the count words of a left-out group, for the pre-run
 * line: the files `--test` ran (`tests`) apart, then how many of the others
 * load changed code, and the flag that runs them.
 */
export function leftOutCountText({ files, selected, add, tests = 0 }: LeftOutGroup): string {
  const loads = (n: number) => (n === 0 ? "none" : `${n}`);
  const others = files - tests;
  const changed = selected === 0 ? "loads changed code" : loadsChangedText(selected, add);
  if (tests === 0) {
    return `${loads(selected)} of its ${plural(files, "test file")} ${changed}`;
  }
  const ran = `${tests === files ? "its" : `${tests} of its`} ${plural(files, "test file")} ${tests === 1 ? "runs" : "run"} by --test`;
  if (others === 0) return ran;
  return `${ran}; ${loads(selected)} of the other ${others} ${changed}`;
}

/** Row 020-61: how many `--test` commands the verdict line names. */
const NAMED_TESTS = 3;

/**
 * Row 020-61 (#203): the edited test files the scope left out, by path:
 * a changed function in a test file that lists itself as a left-out loader.
 */
function editedLeftOut(report: GateReport): string[] {
  const own = report.functions.filter((f) => f.loaders.leftOut?.includes(f.path) === true);
  return [...new Set(own.map((f) => f.path))].sort();
}

/** Row 020-61: the `--test` command for the edited test files left out; empty when none was. */
function testText(report: GateReport): string {
  const edited = editedLeftOut(report);
  if (edited.length === 0) return "";
  const named = edited.slice(0, NAMED_TESTS).map((path) => `--test ${path}`);
  const rest = edited.length - named.length;
  const it = rest === 1 ? "test file: --json lists it" : "test files: --json lists them";
  const more = rest === 0 ? "" : ` (${rest} more edited ${it} under loaders.leftOut)`;
  const which = edited.length === 1 ? "the edited test file" : "the edited test files";
  return ` To run only ${which} of them, add ${named.join(" ")}${more}; the other selected test files in scope still run, with their setup.`;
}

/**
 * D14.3: each group the scope left out that held a selected file, and the
 * flag that runs it, then (row 020-61) `--test` for each edited test file
 * among them; never "all tests".
 */
export function leftOutText(report: GateReport): string {
  const groups = (report.scope?.leftOut ?? []).filter((g) => g.selected > 0);
  if (groups.length === 0) return "";
  const lines = groups.map(({ name, at, selected, add }) => {
    const files = `${plural(selected, "test file")} ${loadsChangedText(selected, add)}`;
    return ` ${name} (${at}) did not run: ${files}.`;
  });
  return `${lines.join("")}${testText(report)}`;
}
