import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toRelative } from "../../src/core/fs/paths.js";
import { PATH_MEMO_LIMIT, WorktreePaths } from "../../src/core/fs/worktree-paths.js";

/* Row 011-414: `WorktreePaths` keeps its answers; a kept answer is the one computed fresh. */

const ROOT = "/work/project";
const PATHS = [
  join(ROOT, "src", "a.ts"),
  join(ROOT, "node_modules", "pkg", "index.js"),
  join(ROOT, "packages", "x", "node_modules", "y.js"),
  ROOT,
  "/work/other/b.ts",
  "/work/project-sibling/c.ts",
  join(ROOT, "..foo"),
];
const fresh = (path: string) => ({
  relative: toRelative(ROOT, path),
  project: toRelative(ROOT, path) !== null && !path.split("/").includes("node_modules"),
});

describe("WorktreePaths memo (011-414)", () => {
  it("answers each path as computed fresh, on the first ask and on every later one", () => {
    const paths = new WorktreePaths(ROOT);
    for (let round = 0; round < 3; round++) {
      for (const path of PATHS) {
        expect({ relative: paths.toRelative(path), project: paths.isProjectFile(path) }).toEqual(
          fresh(path),
        );
      }
    }
  });

  it("answers the same past its limit, when it starts again", () => {
    const paths = new WorktreePaths(ROOT);
    for (let i = 0; i <= PATH_MEMO_LIMIT; i++) paths.isProjectFile(join(ROOT, "gen", `${i}.ts`));
    for (const path of PATHS) expect(paths.isProjectFile(path)).toBe(fresh(path).project);
    expect(paths.toRelative(join(ROOT, "gen", "0.ts"))).toBe("gen/0.ts");
  });
});
