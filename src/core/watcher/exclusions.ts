import { dirname } from "node:path";
import type { AbsolutePath, WatchSpec } from "../types/index.js";

/**
 * Answers "is this absolute path excluded by the spec?" in O(depth): a path is
 * excluded when it or an ancestor below the root is in `excluded`, unless it is
 * one of the `extraFiles`.
 */
export class Exclusions {
  private readonly excluded: ReadonlySet<AbsolutePath>;
  private readonly extra: ReadonlySet<AbsolutePath>;

  constructor(private readonly spec: WatchSpec) {
    this.excluded = new Set(spec.excluded);
    this.extra = new Set(spec.extraFiles);
  }

  excludes(path: AbsolutePath): boolean {
    if (this.extra.has(path)) return false;
    const { root } = this.spec;
    let current = path;
    while (current.length > root.length) {
      if (this.excluded.has(current)) return true;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return false;
  }
}
