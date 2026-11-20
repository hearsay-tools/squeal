// Reviews 0.1.582 B1 and 0.1.582-r2 B2 (row 018-59): the hooks' copy of
// `src/core/ci/own-map.ts`, the one builder and reader of maps keyed by a
// path or a name. Assignment into a plain object drops a key named
// `__proto__`; a read of a key it does not hold finds `Object.prototype`'s.
// `test/ci/own-map.test.ts` keeps the two equal.
"use strict";

/** The map of `entries`, each an own entry; a later entry of one key wins. */
function ownMap(entries) {
  return Object.fromEntries(entries);
}

/** `map`'s own entry for `key`; `undefined` when it holds none. */
function ownValue(map, key) {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

module.exports = { ownMap, ownValue };
