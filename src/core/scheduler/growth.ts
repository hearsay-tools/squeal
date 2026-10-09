import { nodeTestObservedPreloadsMetaKey, type ProjectName } from "../types/index.js";
import type { SchedulerContext } from "./context.js";

/**
 * Review wave 13i, B2 (task 001-187), a stopgap until row 003-43 keys every
 * observed preload before a result is stored: whether `project`'s
 * environment, as this worktree last read it, lacks a path the project's
 * preloads were observed to load in any worktree
 * (`nodeTestObservedPreloadsMetaKey`). A key of the project then misses an
 * input two worktrees may differ in, so an equal key does not prove equal
 * inputs: a result stored under it heals no other worktree and records no
 * flaky note (`storeResults`).
 */
export function unresolvedPreloads(
  context: Pick<SchedulerContext, "store" | "keys">,
  project: ProjectName,
): boolean {
  const raw = context.store.meta.get(nodeTestObservedPreloadsMetaKey(project));
  if (raw === null) return false;
  let observed: unknown;
  try {
    observed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!Array.isArray(observed)) return false;
  const keyed = new Set(context.keys.environmentFiles(project));
  return observed.some((path) => typeof path === "string" && !keyed.has(path));
}
