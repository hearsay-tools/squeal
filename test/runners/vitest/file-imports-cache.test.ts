import { describe, expect, it } from "vitest";
import { WorktreePaths } from "../../../src/core/fs/worktree-paths.js";
import type { FileImports } from "../../../src/core/types/runner.js";
import {
  fileImports,
  type ImportClosure,
  type ImportEdges,
} from "../../../src/runners/vitest/graph.js";

/*
 * Row 011-414: `fileImports` reuses an entry when the file, its sha1 and its
 * absolute targets are those the entry was made from. Each call here is
 * compared with one on an empty `shared`, which converts every edge afresh.
 */

const ROOT = "/work/project";
const at = (path: string) => `${ROOT}/${path}`;

function closure(edges: Record<string, Partial<ImportEdges>>): ImportClosure {
  const map = new Map(
    Object.entries(edges).map(([file, e]) => [
      at(file),
      { static: e.static ?? [], dynamic: e.dynamic ?? [] },
    ]),
  );
  return {
    files: new Set(map.keys()),
    missing: new Set(),
    bare: new Map(),
    builtins: new Set(),
    rooted: new Set(),
    root: ROOT,
    edges: map,
  };
}

describe("fileImports cache (011-414)", () => {
  it("gives what an empty cache gives, across closures, edited bytes and moved targets", () => {
    const paths = new WorktreePaths(ROOT);
    const shared = new Map<string, FileImports>();
    const hashes: Record<string, string> = {
      "src/a.ts": "a1",
      "src/b.ts": "b1",
      "test/t.test.ts": "t1",
    };
    const read = (file: string) => hashes[file.slice(ROOT.length + 1)];
    const both = (c: ImportClosure) => {
      const cached = fileImports(c, paths, read, shared);
      const uncached = fileImports(c, new WorktreePaths(ROOT), read, new Map());
      expect(cached).toEqual(uncached);
      return cached;
    };

    const walk = closure({
      "test/t.test.ts": { static: [at("src/a.ts"), at("node_modules/p/i.js")] },
      "src/a.ts": { static: [at("src/b.ts"), at("src/b.ts")], dynamic: [at("src/z.ts")] },
      "src/b.ts": {},
      "node_modules/p/i.js": { static: [at("src/a.ts")] },
    });
    const first = both(walk);
    expect(first.find((e) => e.path === "src/a.ts")).toEqual({
      path: "src/a.ts",
      sha1: "a1",
      static: ["src/b.ts"],
      dynamic: ["src/z.ts"],
    });
    // The same walk again: the same entries, by identity.
    const again = both(walk);
    for (const [i, entry] of again.entries()) expect(entry).toBe(first[i]);

    // Same bytes, a target moved (a missing `.js` target now resolves to its `.ts`).
    const moved = both(
      closure({
        "test/t.test.ts": { static: [at("src/a.ts")] },
        "src/a.ts": { static: [at("src/b.ts")], dynamic: [at("src/z.js")] },
      }),
    );
    expect(moved.find((e) => e.path === "src/a.ts")?.dynamic).toEqual(["src/z.js"]);

    // Edited bytes, targets as before.
    hashes["src/a.ts"] = "a2";
    const edited = both(
      closure({ "src/a.ts": { static: [at("src/b.ts")], dynamic: [at("src/z.js")] } }),
    );
    expect(edited[0]).toMatchObject({ sha1: "a2", static: ["src/b.ts"] });

    // A target outside the project changed, the project targets did not: the kept entry.
    const kept = shared.get(at("src/a.ts"));
    const outside = both(
      closure({
        "src/a.ts": {
          static: [at("src/b.ts"), at("node_modules/q/i.js")],
          dynamic: [at("src/z.js")],
        },
      }),
    );
    expect(outside[0]).toBe(kept);
  });

  it("leaves out a file without a stamp or outside the project, cached or not", () => {
    const paths = new WorktreePaths(ROOT);
    const shared = new Map<string, FileImports>();
    const walk = closure({ "src/a.ts": {}, "node_modules/p/i.js": {} });
    expect(fileImports(walk, paths, () => undefined, shared)).toEqual([]);
    expect(fileImports(walk, paths, () => "h", shared).map((e) => e.path)).toEqual(["src/a.ts"]);
    expect(fileImports(walk, paths, () => undefined, shared)).toEqual([]);
  });
});
