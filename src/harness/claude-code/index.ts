import { notImplemented } from "../../core/not-implemented.js";
import type { AbsolutePath, HarnessDelivery } from "../../core/types/index.js";

/**
 * Store-backed delivery used by the Claude Code hook scripts (spec 001 D9).
 * Task 001-31.
 */
export function createClaudeCodeDelivery(_commonDir: AbsolutePath): HarnessDelivery {
  return notImplemented("createClaudeCodeDelivery");
}
