import { type Leaf, positiveInteger, type Shape } from "./config-file.js";
import { compiles } from "./policy-node-test.js";

/*
 * Spec 015 D1: the `complexity`, `coverage` and `crap` keys of the policy
 * loader. A wrong type is one problem and the key's default applies (001
 * D11), as in every other section. D1's "`coverage.enabled` needs
 * `complexity.enabled`" is applied where coverage turns on (wave 2), not
 * here: the loader is on the key-validity path, and a rule there needs a
 * validity case (`test/keys/key-format.test.ts`).
 */

const boolean: Leaf = (v) => (typeof v === "boolean" ? null : "true or false");
const globs: Leaf = (v) =>
  Array.isArray(v) && v.every((s) => typeof s === "string")
    ? compiles(v as string[])
    : "an array of strings";
const aboveZero: Leaf = (v) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? null : "a number > 0";

/** The three sections' keys, spread into the loader's shape. */
export const CODE_SHAPE: Shape = {
  complexity: {
    enabled: boolean,
    threshold: positiveInteger,
    include: globs,
    exclude: globs,
    maxFileBytes: positiveInteger,
    blocking: boolean,
  },
  coverage: { enabled: boolean },
  crap: { threshold: aboveZero },
};
