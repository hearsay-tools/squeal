import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { resolveTestFiles } from "../../../src/harness/shared/test-command-files.js";
import { openFixture, SLOW, TYPECHECKED } from "./helpers.js";

/*
 * Spec 005 D8 step 2: the files a Vitest command resolves to from Squeal's
 * own listing are the files Vitest itself lists for the same arguments.
 */

const VITEST = resolve(import.meta.dirname, "../../../node_modules/vitest/vitest.mjs");
const TRIVIAL = 'import { it } from "vitest";\nit("runs", () => {});\n';

/** Vitest's own file listing for `filters`, run from `root`; empty when nothing matches. */
async function vitestList(root: string, filters: readonly string[]): Promise<string[]> {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [VITEST, "list", "--filesOnly", "--passWithNoTests", ...filters],
    { cwd: root, env: { ...process.env, CI: "1", NO_COLOR: "1" } },
  ).catch((error: { stdout?: string }) => ({ stdout: error.stdout ?? "" }));
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".ts"))
    .sort();
}

describe("resolveTestFiles against Vitest's own listing (spec 005 D8 step 2)", () => {
  it("selects the files `vitest list` selects for each filter", SLOW, async () => {
    const fx = await openFixture("basic", {
      "test/sub/deep-math.test.ts": TRIVIAL,
      "test/Upper.test.ts": TRIVIAL,
      "test/subject.test.ts": TRIVIAL,
    });
    const listing = await fx.adapter.testFiles();
    expect(listing).toHaveLength(7);
    expect(await vitestList(fx.root, [])).toHaveLength(7);
    const cases: (readonly string[])[] = [
      [],
      ["math"],
      ["MATH"],
      ["upper"],
      ["test/math.test.ts"],
      ["./test/math.test.ts"],
      ["test/sub/"],
      ["test/sub"],
      ["sub"],
      ["greeting", "strings"],
      ["each", "each.test"],
      [".test.ts"],
      ["."],
      [join(fx.root, "test/sub")],
      [join(fx.root, "test/math.test.ts")],
    ];
    for (const filters of cases) {
      const resolved = resolveTestFiles(
        { runner: "vitest", filters },
        listing,
        fx.root,
        new Set(),
        0,
      );
      const own = await vitestList(fx.root, filters);
      expect(resolved?.map((ref) => ref.path).sort(), filters.join(" ")).toEqual(own);
    }
    for (const filters of [["nomatch"], ["math", "nomatch"]]) {
      expect(
        resolveTestFiles({ runner: "vitest", filters }, listing, fx.root, new Set(), 0),
        filters.join(" "),
      ).toBeNull();
    }
    expect(await vitestList(fx.root, ["nomatch"])).toEqual([]);
  });
});

describe("a listing that leaves files out (spec 005 D8 step 3, review wave-2 B1)", () => {
  it(
    "counts the typecheck files it leaves out, and a command then resolves to nothing",
    SLOW,
    async () => {
      const fx = await openFixture("basic", TYPECHECKED);
      const listing = await fx.adapter.testFiles();
      expect(listing.map((ref) => ref.path)).not.toContain("test/outside.test-d.ts");
      expect(await vitestList(fx.root, [])).toContain("test/outside.test-d.ts");
      expect(fx.adapter.omittedTestFiles?.()).toBe(1);
      const all = { runner: "vitest", filters: [] } as const;
      expect(resolveTestFiles(all, listing, fx.root, new Set(), 1)).toBeNull();
      expect(resolveTestFiles(all, listing, fx.root, new Set(), null)).toBeNull();
      // The left-out files have no paths to match a filter against, so a filter falls through too.
      const math = { runner: "vitest", filters: ["math"] } as const;
      expect(resolveTestFiles(math, listing, fx.root, new Set(), 1)).toBeNull();
    },
  );

  it("counts none for a configuration it lists completely", SLOW, async () => {
    const fx = await openFixture("basic");
    const listing = await fx.adapter.testFiles();
    expect(fx.adapter.omittedTestFiles?.()).toBe(0);
    const all = { runner: "vitest", filters: [] } as const;
    expect(resolveTestFiles(all, listing, fx.root, new Set(), 0)).toEqual(listing);
  });
});
