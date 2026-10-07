/** `1 check`, `2 checks`: the count and the word, with an `s` unless the count is one. */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** `text` cut to at most `max` characters, ending in `...` when cut. */
export function cap(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}
