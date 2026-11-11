import type { Leaf, Shape } from "./config-file.js";

/*
 * Spec 021 D9 (row 021-13; the coordinator, request 41854ecd): the `remote`
 * key of the policy loader. A user names a remote lane in their own
 * `remote.json` (`src/core/runner-host/remote/settings.ts`); a repository
 * may forbid it with `remote.allowed: false`, and its runs then stay on the
 * user's machine. A wrong value is one problem and the default applies
 * (001 D11).
 */

const boolean: Leaf = (v) => (typeof v === "boolean" ? null : "true or false");

/** The section's keys, spread into the loader's shape. */
export const REMOTE_SHAPE: Shape = { remote: { allowed: boolean } };
