import { existsSync } from "node:fs";
import { join } from "node:path";
import { readPolicy } from "../../core/daemon/policy.js";
import { tellUncovered } from "../../core/delivery/uncovered.js";
import type { HookContext } from "./context.js";

/** The most paths the line names before ` and N more`. */
const SHOWN = 3;

/**
 * Spec 001 D9 as amended (task 001-292): after an edit, one line naming the
 * changed code files no test Squeal runs reads, each once per consumer
 * (`tellUncovered`); `null` when there is none or policy
 * `delivery.uncoveredEdits` is off, which then records nothing. The wording
 * is what the eval measured (`status.md`, 2026-10-13); 005-15 owns any other.
 */
export function uncoveredEditLine(context: HookContext): string | null {
  if (!readPolicy(context.root).delivery.uncoveredEdits) return null;
  const paths = tellUncovered(context.store, context.consumer, (path) =>
    existsSync(join(context.root, path)),
  );
  if (paths.length === 0) return null;
  const shown = paths.slice(0, SHOWN).join(", ");
  const more = paths.length > SHOWN ? ` and ${paths.length - SHOWN} more` : "";
  const it = paths.length === 1 ? "it" : "them";
  return `No result for ${shown}${more}: no test Squeal runs reads ${it}. Run whatever tests ${it} yourself.`;
}
