import type { CodeCheckId, CodeKnownState } from "../../types/code.js";

/*
 * Row 015-55, review 0.1.330 B1: a move takes the first gone check of its
 * body (D2), and a removal is told in the order the gone checks come. So an
 * edit pass in parts and one of one transaction meet them in one order:
 * `states.list`'s, path, qualified name and occurrence, each text in
 * SQLite's `BINARY` order. That is UTF-8 byte order, the order of code
 * points. A JavaScript `<` compares UTF-16 units, and puts U+10000 and
 * above before U+E000 to U+FFFF. The added checks need no rule: both passes
 * read them in the plan's file order, each file's in its count's order.
 */

/** A UTF-16 unit's place in code-point order: surrogates after U+E000 to U+FFFF. */
function rank(unit: number): number {
  if (unit < 0xd800) return unit;
  return unit < 0xe000 ? unit + 0x2000 : unit - 0x800;
}

/** Two texts in code-point order, as SQLite's `BINARY` compares their UTF-8. */
export function byCodePoint(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) return rank(x) - rank(y);
  }
  return a.length - b.length;
}

/** Two checks in `states.list`'s order. */
export function byCheck(a: CodeCheckId, b: CodeCheckId): number {
  return (
    byCodePoint(a.path, b.path) ||
    byCodePoint(a.qualifiedName, b.qualifiedName) ||
    a.occurrence - b.occurrence
  );
}

/** Gone checks by key, in `byCheck` order: the one order both passes match and remove them in. */
export function inCheckOrder(
  gone: Iterable<readonly [string, CodeKnownState]>,
): Map<string, CodeKnownState> {
  return new Map([...gone].sort(([, a], [, b]) => byCheck(a.check, b.check)));
}
