/** Code-unit order: the same in every locale, so keys do not depend on one. */
export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
