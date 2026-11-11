/*
 * Spec 021 D1 (row 021-07): the busy line of a one-shot write past its bound,
 * as a pattern. How long it waited varies with the host's load, and the
 * holder's command is what `lockHolders` reads, the tests' stand-in until row
 * 021-10 reads `/proc`.
 */

/** The busy clause of a write past its bound, holder `pid`: `busyText`'s words. */
export const busyClause = (pid: number | undefined) =>
  `the store is busy after <s> s, held by pid ${pid} (<command>)`;

/** One whole line: `pattern` taken literally but for `<s>`, seconds, and `<command>`, any text. */
export function line(pattern: string): RegExp {
  const source = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("<s>", "\\d+\\.\\d")
    .replaceAll("<command>", ".+");
  return new RegExp(`^${source}$`, "m");
}
