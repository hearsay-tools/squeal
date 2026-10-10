/**
 * The version of what a check key means (spec 001 D3, task 001-199), part of
 * every environment hash in place of the Squeal release: a release that left
 * the code building keys and results unchanged keeps every stored result.
 *
 * Bump it, and add the guard's new hash to `KEY_SOURCES_HASHES` under the new
 * value, whenever `test/keys/key-format.test.ts` reports that the guarded
 * sources changed: all of `src/` and the build's inputs, with a fingerprint
 * of the dependencies the bundles embed, less the exempt list in
 * `test/keys/key-sources.ts` (task 001-203). A change that leaves every key's
 * meaning alone (a comment, a rename) still bumps: the guard cannot tell, and
 * a spurious re-key costs one full run where a missed one trusts a stale result.
 *
 * Value 1 is a number where the Squeal version string stood, so the switch
 * itself re-keys every check once and no row stored under a version-hashed key
 * is trusted.
 */
export const KEY_FORMAT_VERSION = 1;

/**
 * The guarded sources' hash at each `KEY_FORMAT_VERSION`, as the guard
 * test computes it. Append only: one entry per version, never edit an old one.
 */
export const KEY_SOURCES_HASHES: Readonly<Record<number, string>> = {
  1: "941898948331353ad05fb1e4bea652b19a3873f4b416511995ee688fc8ec59d3",
};
