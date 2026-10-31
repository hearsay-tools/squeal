/**
 * The version of what a check key means (spec 001 D3, task 001-199), part of
 * every environment hash in place of the Squeal release: a release that left
 * the code building keys and results unchanged keeps every stored result.
 *
 * It moves only when a key this release computes can find something an
 * earlier release stored that this release would have stored or decided
 * differently (spec 011 C3 as amended 2026-10-20, task 011-37). The alarm in
 * `test/keys/key-format.test.ts` decides that against the last release: it
 * bundles the validity path's entries (`test/keys/validity/entries/`) at both
 * trees and, when the emitted code differs, runs the corpus under
 * `test/keys/validity/cases/` at both. Raise it only when that test names a
 * case whose outputs differ, or when the human approved a raise with none
 * (`test/keys/validity/approved.ts`, row 011-105); a raise needs one of the
 * two (D6), and empties `KEY_FORMATS_READ_AS_ONE`. A change of a key's inputs
 * re-keys its checks by itself, and stored wording re-keys nothing.
 *
 * Value 1 is a number where the Squeal version string stood, so the switch
 * itself re-keys every check once and no row stored under a version-hashed key
 * is trusted.
 */
export const KEY_FORMAT_VERSION = 21;

/**
 * The formats read as the current one, each with the row whose change raised
 * it (spec 011 C3 as amended 2026-10-20, task 011-37): from 21, the format
 * whose raise last emptied it (row 011-105, which ended 13 to 20), to the one
 * below `KEY_FORMAT_VERSION`. A lookup that misses at its key reads the key at
 * each and copies the newest set stored under one (C4 step 3, C7). A raise
 * for a change of stored meaning empties the list.
 */
export const KEY_FORMATS_READ_AS_ONE: Readonly<Record<number, string>> = {};
