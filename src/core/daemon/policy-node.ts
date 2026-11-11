import type { Policy } from "../types/policy.js";
import type { Leaf, Shape } from "./config-file.js";

/*
 * Spec 018 D18: the `node` key of the policy loader. `"project"`, the
 * default, starts the daemon on the project's pinned Node when it is
 * installed (`src/core/node-pin.ts`); `"session"` keeps the Node of the hook
 * or CLI that starts it. A wrong value is one problem and the default
 * applies (001 D11).
 */

/** Which Node the daemon runs on. */
export type NodeSetting = Policy["node"];

const node: Leaf = (v) => (v === "project" || v === "session" ? null : '"project" or "session"');

/** The key, spread into the loader's shape and read alone by the daemon's spawn. */
export const NODE_SHAPE: Shape = { node };
