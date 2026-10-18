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
export const KEY_FORMAT_VERSION = 11;

/**
 * The guarded sources' hash at each `KEY_FORMAT_VERSION`, as the guard
 * test computes it. Append only: one entry per version, never edit an old one.
 */
export const KEY_SOURCES_HASHES: Readonly<Record<number, string>> = {
  1: "9faeccfc3507c724afa22c9a320b54ef9fc235c2ac0b1ca9491e2ae5496cc88b",
  2: "5adc2c3b593ac71d1a51e33a882dde90d984a1643c518b4e0495fe00eec42ae9",
  3: "af0a578ac8bd610a40ec5787f84c1119b55470b0ad97ec0b4b9467933070b7d2",
  4: "6e03cdb8686afcdfbee6c4d0c18485479b95617e12d83a58ad33b07cac67cc42",
  5: "ca40658569bb0d2e5e61ae0341cbcd1cf1bedb8e16a6a34b03fbd636f4349b23",
  6: "67162cf1ae967b848207a6eab92ca15e943e98ed227358db77f1c1016b6a61cf",
  7: "2ff428609a01a3772497e0121b1ca1368314406097aade32b924d7cc2a8ed2d3",
  8: "02b4ecca9f07a68c066a87f08277b91b928d22b4a5d96f4f399fb1e91ce13a10",
  9: "e6f3693e86995adcb0adf814d6a4907a4bb265f0ac866ca8073724345c6627b3",
  10: "70268d0b605497e47ad728ca74117d9572766398f5f30ea402a3fff23fb5036b",
  11: "e7aacbea29f54502f4ef7613d07f805d0b7d4bd72abc285ed86a10df44e29707",
};
