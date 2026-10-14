/** `1 check`, `2 checks`: the count and the word, with an `s` unless the count is one. */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** `text` cut to at most `max` characters, ending in `...` when cut. */
export function cap(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
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
