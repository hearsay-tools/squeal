import { groupOf } from "../../daemon/check-groups.js";
import { groupView } from "../../scheduler/slow.js";
import type { CheckMoment, Policy, ResolvedGroup } from "../../types/index.js";
import type { LintTool } from "../../types/lint.js";
import type { LintMetaRepo } from "../store/types.js";
import { heldKey } from "./records.js";

/*
 * Spec 019 D1 as amended 2026-11-05 (row 019-45): the moment of the lint
 * group that owns a tool's checks. At `edit` an edited file lints at once
 * (017 D5). At any other moment the pass keys each edit as before and lints
 * a path only once something released it at its blob: a commit (`commit`,
 * D5 step 1, row 019-22), `squeal run <group>` (D6), or, at `pause` and
 * `stop`, the agent's pause (`commit-entry.ts`). At `manual` only `squeal
 * run <group>` releases it (row 019-47).
 */

/** A lint group's moment that holds its checks: every moment but `edit`. */
export type HeldMoment = Exclude<CheckMoment, "edit">;

/** The lint group that holds a tool's checks, and its moment. */
export interface HeldBy {
  readonly group: string;
  readonly at: HeldMoment;
}

/** The lint group that owns `tool`'s checks: the first that selects it (D1); `null` with none. */
export function lintGroupOf(policy: Policy, tool: LintTool): ResolvedGroup | null {
  return groupOf(groupView(policy).groups, { kind: "lint", tool, path: "" });
}

/** The lint group that holds `tool`'s checks for its moment; `null` at `edit` or with none. */
export function heldBy(policy: Policy, tool: LintTool): HeldBy | null {
  const group = lintGroupOf(policy, tool);
  return group === null || group.at === "edit" ? null : { group: group.name, at: group.at };
}

const MOMENTS: readonly string[] = ["pause", "stop", "commit", "manual"] satisfies HeldMoment[];

/** Row 019-45: the agent's pause releases what a group at `pause` or `stop` holds; nothing else does. */
export function pauseReleases(at: HeldMoment): boolean {
  return at === "pause" || at === "stop";
}

/**
 * The hold the scope's pass recorded (`markHeld`), so status reads it
 * without the policy; `null` with none. A bare group name, as 0.1.402 and
 * 0.1.403 wrote it, is a group at `commit`, the only moment they held.
 */
export function readHeld(meta: LintMetaRepo, scope: string): HeldBy | null {
  const raw = meta.get(heldKey(scope));
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<HeldBy> | null;
    if (typeof value?.group === "string" && MOMENTS.includes(value.at as string)) {
      return { group: value.group, at: value.at as HeldMoment };
    }
  } catch {
    // A bare group name does not parse as JSON.
  }
  return { group: raw, at: "commit" };
}

/** Records the hold of the scope's tool, or that none holds it; writes only a change. */
export function markHeld(meta: LintMetaRepo, scope: string, held: HeldBy | null): void {
  const key = heldKey(scope);
  const value = held === null ? null : JSON.stringify({ group: held.group, at: held.at });
  if (meta.get(key) === value) return;
  if (value === null) meta.delete(key);
  else meta.set(key, value);
}
