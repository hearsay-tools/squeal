import { checkTextPattern } from "../focus.js";

/**
 * A focused file's `testNamePattern` for `texts` on Vitest `version` (013 V4,
 * row 011-173): Vitest 5 and later match the full name joined by ` > `, so a
 * text's ` > ` matches that alone; Vitest 4 joins it with a space, so there
 * it matches ` > ` or a space, as on a version that does not read as a number.
 */
export function namePattern(texts: readonly string[], version: string): RegExp {
  const major = Number.parseInt(version, 10);
  return new RegExp(checkTextPattern(texts, major >= 5 ? "separator" : "separator-or-space"));
}
