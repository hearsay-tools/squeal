/** `1 check`, `2 checks`: the count and the word, with an `s` unless the count is one. */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** `text` cut to at most `max` characters, ending in `...` when cut. */
export function cap(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
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
