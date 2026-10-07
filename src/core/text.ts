/** `1 check`, `2 checks`: the count and the word, with an `s` unless the count is one. */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
