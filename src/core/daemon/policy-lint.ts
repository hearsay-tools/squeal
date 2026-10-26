import type { Leaf, Shape } from "./config-file.js";
import { compiles } from "./policy-node-test.js";

/*
 * Spec 017 D1: the `lint` keys of the policy loader. A wrong type is one
 * problem and the key's default applies (001 D11), as in every other
 * section. `lint.enabled` stands alone: it needs no `complexity.enabled`
 * (`lint-seams.md` Q5).
 */

const boolean: Leaf = (v) => (typeof v === "boolean" ? null : "true or false");
const globs: Leaf = (v) =>
  Array.isArray(v) && v.every((s) => typeof s === "string")
    ? compiles(v as string[])
    : "an array of strings";

/** The section's keys, spread into the loader's shape. */
export const LINT_SHAPE: Shape = {
  lint: { enabled: boolean, include: globs, exclude: globs, blocking: boolean },
};
