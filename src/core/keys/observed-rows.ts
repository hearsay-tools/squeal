import type { ProjectName } from "../types/common.js";
import { observedModulesMetaKey } from "./modules.js";
import { observedDirectMetaKey, observedMetaKey } from "./observed.js";
import { observedStartupMetaKey } from "./startup.js";

/**
 * The `meta` keys of a project's observed reads, shared by every worktree's
 * daemon (spec 016 D4): what its test files read, what puts one in
 * `direct`, its module evidence and its start-up paths. In a file of its
 * own: `modules.ts` and `startup.ts` import `observed.ts`.
 */
export const OBSERVED_META_KEYS: readonly ((project: ProjectName) => string)[] = [
  observedMetaKey,
  observedDirectMetaKey,
  observedModulesMetaKey,
  observedStartupMetaKey,
];
