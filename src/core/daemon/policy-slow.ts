import { compiles } from "./policy-node-test.js";

/**
 * The `slow.include` rule of the policy loader (spec 004 D1, D7). A value
 * that is not a list of strings is what was expected, so the default `[]`
 * applies; a glob that does not compile is one problem and is left out, the
 * others are kept (001 D11), so one typo does not unmark the other suites.
 */
export function slowInclude(
  value: unknown,
): string | { readonly kept: readonly string[]; readonly problems: readonly string[] } {
  if (!Array.isArray(value) || !value.every((glob) => typeof glob === "string")) {
    return "an array of strings";
  }
  const kept: string[] = [];
  const problems: string[] = [];
  value.forEach((glob: string, index) => {
    const bad = compiles([glob]);
    if (bad === null) kept.push(glob);
    else problems.push(`"slow.include[${index}]" ${bad.problem}; it is left out`);
  });
  return { kept, problems };
}
