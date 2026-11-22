import { existsSync } from "node:fs";
import { readPolicy } from "../core/daemon/policy.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { ungated, workersPerFile } from "../core/scheduler/group-limits.js";
import { groupView } from "../core/scheduler/slow.js";
import type { ResolvedGroup } from "../core/types/check-groups.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { Policy } from "../core/types/policy.js";
import { oneGroup, type WorkGroup } from "./status-at-estimate.js";

/*
 * Review 0.1.599 B3 (row 023-49, V2: "the real parallel limit the daemon
 * applies"): each side's files still to run, by the group its own policy
 * places them in, with the limits its daemon runs that group at (spec 019
 * D3): a group's `maxParallel` is one slot both sides' files of the group
 * hold (the commit worktree is the same repository's, so the slot is
 * shared under either `capacity.groupSlotScope`); a gated group without it
 * runs a tier of `runner.tierSize` files; a `"low"` group runs one file at
 * a time while the side has normal work; `maxWorkers` takes that many pool
 * workers per file. The default `tests` group has no limit of its own: the
 * pool share bounds it.
 */

/** One side's files still to run, and the tree whose policy groups them (`null`: none). */
export interface SideFiles {
  readonly root: AbsolutePath | null;
  readonly files: readonly TestFileRef[];
}

interface Bucket {
  readonly group: ResolvedGroup;
  readonly policy: Policy;
  readonly refs: TestFileRef[];
}

/** Per side, its work by group; `unknown` where its tree is gone and its limits were not read. */
export function workGroups(
  sides: readonly SideFiles[],
  seconds: (ref: TestFileRef) => number | null,
): { readonly groups: WorkGroup[][]; readonly unknown: boolean[] } {
  const read = sides.map((side) =>
    side.root === null || !existsSync(side.root) ? null : bucketsOf(readPolicy(side.root), side),
  );
  const groups = sides.map((side, i) => {
    const buckets = read[i];
    if (buckets === null || buckets === undefined) return [oneGroup(side.files.map(seconds))];
    const normal = [...buckets.values()].some((b) => b.group.limits.priority !== "low");
    return [...buckets.values()].map(({ group, policy, refs }): WorkGroup => {
      const shared =
        group.limits.maxParallel === null
          ? []
          : read.flatMap((other, j) => (j === i ? [] : (other?.get(group.name)?.refs ?? [])));
      return {
        seconds: refs.map(seconds),
        cap: capOf(group, policy, normal),
        perFile: workersPerFile(group),
        shared: shared.map(seconds),
      };
    });
  });
  const unknown = read.map((buckets, i) => buckets === null && (sides[i]?.files.length ?? 0) > 0);
  return { groups, unknown };
}

/** The most of a group's files that run at once whatever the pool gives; `null`: no such limit. */
function capOf(group: ResolvedGroup, policy: Policy, normal: boolean): number | null {
  if (group.limits.priority === "low" && normal) return 1;
  if (group.limits.maxParallel !== null) return Math.max(1, group.limits.maxParallel);
  return ungated(group) ? null : Math.max(1, policy.runner.tierSize);
}

/** The side's files by group name, each file once. */
function bucketsOf(policy: Policy, side: SideFiles): Map<string, Bucket> {
  const view = groupView(policy);
  const out = new Map<string, Bucket>();
  const seen = new Set<string>();
  for (const ref of side.files) {
    const id = testFileId(ref);
    if (seen.has(id)) continue;
    seen.add(id);
    const group = view.of(ref);
    const bucket = out.get(group.name) ?? { group, policy, refs: [] };
    bucket.refs.push(ref);
    out.set(group.name, bucket);
  }
  return out;
}
