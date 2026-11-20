/*
 * Reviews 0.1.582 B1 and 0.1.582-r2 B2 (row 018-59): the one builder and
 * reader of the maps keyed by a path or a name in `squeal ci record`, its
 * parts and `ci export`. A plain object filled by assignment drops a key
 * named `__proto__` (the assignment sets the prototype), and a read of a
 * key it does not hold finds `Object.prototype`'s `toString` or
 * `constructor`. A repository may hold a file of any of these names, and a
 * lost entry let the endpoint rule (spec 018 D33) certify an input that
 * differed: a wrong pass. Entries go in as own properties; a read sees only
 * own ones. `src/runners/ci-runtime/own-map.cjs` is the hooks' copy;
 * `test/ci/own-map.test.ts` keeps the two equal and the code on them.
 */

/** The map of `entries`, each an own entry; a later entry of one key wins. */
export function ownMap<K extends string, V>(entries: Iterable<readonly [K, V]>): Record<K, V> {
  return Object.fromEntries(entries) as Record<K, V>;
}

/** `map`'s own entry for `key`; `undefined` when it holds none. */
export function ownValue<K extends string, V>(map: Readonly<Record<K, V>>, key: K): V | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}
