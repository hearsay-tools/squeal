import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMissing } from "../../core/fs/index.js";
import { DEFAULT_POLICY, type Policy } from "../../core/types/index.js";

/*
 * Reads the policy keys the hooks act on. Task 001-30 owns policy loading
 * (src/core/daemon); this stand-in goes when that loader lands. Not exported
 * from the harness.
 */

/** `squeal.config.json` at the worktree root over `DEFAULT_POLICY` (D11). A file that does not parse counts as absent. */
export function readHookPolicy(root: string): Policy {
  let text: string;
  try {
    text = readFileSync(join(root, "squeal.config.json"), "utf8");
  } catch (error) {
    if (isMissing(error)) return DEFAULT_POLICY;
    throw error;
  }
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return DEFAULT_POLICY;
  }
  return merge(DEFAULT_POLICY, file) as Policy;
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Values from `file` replace defaults of the same type; unknown keys and wrong types are ignored. */
function merge(defaults: unknown, file: unknown): unknown {
  if (!isPlain(defaults) || !isPlain(file)) return defaults;
  const out: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(defaults)) {
    const given = file[key];
    if (given === undefined) continue;
    if (isPlain(value)) out[key] = merge(value, given);
    else if (value === null || typeof given === typeof value) out[key] = given;
  }
  return out;
}
