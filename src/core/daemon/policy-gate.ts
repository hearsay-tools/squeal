import type { Leaf, Shape } from "./config-file.js";

/*
 * Spec 020 D14.1: the `gate` key of the policy loader. `gate.groups` is a
 * list of check-group names, or `null`; a wrong type is one problem and the
 * default, `null`, applies (001 D11). Whether each name is a test group at
 * the merge base is the gate's to say (`code/gate/scope.ts`): the daemon has
 * no scope (D14.6).
 */

const groups: Leaf = (v) =>
  v === null || (Array.isArray(v) && v.every((s) => typeof s === "string"))
    ? null
    : "an array of check-group names, or null";

/** The section's keys, spread into the loader's shape. */
export const GATE_SHAPE: Shape = { gate: { groups } };
