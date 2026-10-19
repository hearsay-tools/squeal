import { describe, expect, it } from "vitest";
import { type RankSource, SlowRanker } from "../../src/core/slow/rank.js";
import type { RelativePath } from "../../src/core/types/index.js";

/*
 * Review wave-13 S1 (004 D2, task 004-82): tokens come from each changed
 * file and its local imports, so a changed file that another changed file
 * imports still offers its own imports' tokens, in either order, and each
 * path is read once.
 */

const files: Record<string, string> = {
  "src/a.ts": 'import "./b";\n',
  "src/b.ts": 'import "./c";\n',
  "src/c.ts": "const markup = 'data-slot=\"panel-body\"';\n",
  "test/slow.test.ts": "const selector = '[data-slot=\"panel-body\"]';\n",
};

function source(reads: string[]): RankSource {
  return {
    read(path) {
      reads.push(path);
      return files[path] ?? null;
    },
    exists: (path) => path in files,
    hashOf: () => undefined,
  };
}

describe("changed files' imports offer evidence whatever their order (004 D2, review wave-13 S1)", () => {
  for (const changed of [
    ["src/a.ts", "src/b.ts"],
    ["src/b.ts", "src/a.ts"],
  ]) {
    it(`changed ${changed.join(", ")}: the slow file matches c's token, each source read once`, () => {
      const reads: string[] = [];
      const ranker = new SlowRanker(source(reads));
      const evidence = ranker.evidence(changed as RelativePath[], [
        "test/slow.test.ts" as RelativePath,
      ]);
      expect([...evidence]).toEqual([["test/slow.test.ts", ["panel-body"]]]);
      const changedSide = reads.filter((path) => path.startsWith("src/"));
      expect(changedSide.sort()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    });
  }
});
