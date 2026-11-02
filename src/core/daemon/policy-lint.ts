import type { LintTool } from "../types/lint.js";
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

/** D11: the tools Squeal runs; another name is a wrong value and the default applies. */
const TOOL_NAMES: readonly LintTool[] = ["eslint", "oxlint"];
const tools: Leaf = (v) =>
  Array.isArray(v) && v.every((s) => (TOOL_NAMES as readonly unknown[]).includes(s))
    ? null
    : `an array of ${TOOL_NAMES.join(" and ")}`;

/** The section's keys, spread into the loader's shape. */
export const LINT_SHAPE: Shape = {
  lint: { enabled: boolean, include: globs, exclude: globs, blocking: boolean, tools },
};
