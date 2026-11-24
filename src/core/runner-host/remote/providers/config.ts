/*
 * Spec 026 D6.4 (row 026-10): checks shared by the built-in providers'
 * `validate`. Each returns the problem text or `null`, under 001 D11's
 * loader rules (a bad entry is one problem and is left out).
 */

/** The keys of `config` outside `known`, as one problem, or `null`. */
export function unknownKey(
  config: Readonly<Record<string, unknown>>,
  known: readonly string[],
): string | null {
  const unknown = Object.keys(config).find((key) => !known.includes(key));
  return unknown === undefined ? null : `has unknown key "${unknown}"`;
}

/** A string with no control character. */
export function plainString(value: unknown): value is string {
  return typeof value === "string" && !/\p{Cc}/u.test(value);
}

/** An argument list: strings with no control character; `nonEmpty` also needs a first word. */
export function argumentList(value: unknown, nonEmpty: boolean): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every(plainString) &&
    (!nonEmpty || (value.length > 0 && value[0] !== ""))
  );
}

/** The `node` and `cache` places every provider takes (021 D9): non-empty strings. */
export function placesProblem(config: Readonly<Record<string, unknown>>): string | null {
  for (const key of ["node", "cache"] as const) {
    const value = config[key];
    if (!plainString(value) || value === "") return `"${key}" must be a non-empty string`;
  }
  return null;
}
