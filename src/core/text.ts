import type { TestFileRef } from "./types/index.js";

/** `1 check`, `2 checks`: the count and the word, with an `s` unless the count is one. */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** A test file as status names it: the project, when there is one, leads the path. */
export function testFileText({ project, path }: TestFileRef): string {
  return project === "" ? path : `${project}: ${path}`;
}

/** `text` cut to at most `max` characters, ending in `...` when cut. */
export function cap(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

/** Local `HH:MM:SS`, as a human reads a clock. */
export function timeText(at: number): string {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * `12 s`, `1 min 12 s`, `10 min`, from whole seconds as `round` gives them:
 * `Math.round` by default; a wait against a bound passes `Math.floor`, so it
 * does not read as the bound before it is reached.
 */
export function durationText(ms: number, round: (seconds: number) => number = Math.round): string {
  const seconds = Math.max(0, round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const rest = seconds % 60;
  return `${Math.floor(seconds / 60)} min${rest === 0 ? "" : ` ${rest} s`}`;
}

/** A word the shell may read as it is: no space, quote, `$`, glob or other special character. */
const SAFE_WORD = /^[\w@%+=:,./-]+$/;

/**
 * Row 011-130: `word` as one word the shell reads back whole, bare when it is
 * safe, else single-quoted. Every printed command quotes each of its paths,
 * names and error texts through it, the one quoting rule (spec 014 D7).
 */
export function shellWord(word: string): string {
  return SAFE_WORD.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/** The most paths a note or a reason names before "N more" (tasks 007-30, 011-02). */
export const PATHS_NAMED = 5;

/** Paths for a note, at most `max` of them. Styleguide: "Errors carry context (check id, revision, path)." */
export function listPaths(paths: readonly string[], max = PATHS_NAMED): string {
  const shown = paths.slice(0, max).join(", ");
  return paths.length > max ? `${shown} and ${paths.length - max} more` : shown;
}

/**
 * Task 011-02: a reason naming `paths`, explanation first: `lead`, then the
 * paths as the subject of `verb` (singular when `one`), then `task`. Past
 * `PATHS_NAMED` the subject is their count, and a sample with "N more"
 * follows, then every path: delivery and status cut the reason at their
 * caps, while `why` and `status --json` keep it whole.
 */
export function pathsReason(
  lead: string,
  paths: readonly string[],
  verb: (one: boolean) => string,
  task: string,
): string {
  if (paths.length <= PATHS_NAMED) {
    return `${lead}${paths.join(", ")} ${verb(paths.length === 1)} (${task})`;
  }
  const all = paths.join(", ");
  return `${lead}${plural(paths.length, "file")} ${verb(false)} (${task}): ${listPaths(paths)}; every path: ${all}`;
}

/**
 * Policy `vitest.excludeProjects` as status and the primer name it (task
 * 001-370, review wave-13bl S2): a plain name as the project it is, a
 * pattern (a `*`) as a selector, since no project has that name. `plural`
 * says which verb follows.
 */
export function excludedProjectsText(entries: readonly string[]): {
  text: string;
  plural: boolean;
} {
  const quoted = (list: readonly string[], join: string) => {
    const all = list.map((entry) => JSON.stringify(entry));
    const last = all.pop() as string;
    return all.length === 0 ? last : `${all.join(", ")} ${join} ${last}`;
  };
  const names = entries.filter((entry) => !entry.includes("*"));
  const patterns = entries.filter((entry) => entry.includes("*"));
  const parts = [
    ...(names.length === 0
      ? []
      : [`${names.length === 1 ? "project" : "projects"} ${quoted(names, "and")}`]),
    ...(patterns.length === 0 ? [] : [`projects matching ${quoted(patterns, "or")}`]),
  ];
  return { text: parts.join(" and "), plural: patterns.length > 0 || names.length > 1 };
}

/** The most `vitest.exclude` globs a line names before "and N more". */
const EXCLUDED_GLOBS_NAMED = 3;

/**
 * Policy `vitest.exclude` as status, the primer and `setup --check` name it
 * (spec 004 D7, D8 as amended 2026-10-18, task 004-81): `Vitest test files
 * matching "a" or "b"`, the globs past three as "and N more".
 */
export function excludedFilesText(globs: readonly string[]): string {
  const quoted = globs.slice(0, EXCLUDED_GLOBS_NAMED).map((glob) => JSON.stringify(glob));
  const rest = globs.length - quoted.length;
  if (rest > 0)
    return `Vitest test files matching ${quoted.join(", ")} and ${plural(rest, "more glob")}`;
  const last = quoted.pop() as string;
  return `Vitest test files matching ${quoted.length === 0 ? last : `${quoted.join(", ")} or ${last}`}`;
}
