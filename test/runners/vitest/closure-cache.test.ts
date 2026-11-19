import { afterEach, describe, expect, it } from "vitest";
import type { RunnerAdapter, RunnerClosure } from "../../../src/core/types/runner.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Row 011-414: an adapter that has walked closures before (its path memo and
 * its `fileImports` entries filled) gives the closure a fresh adapter gives,
 * after an edit that changes a file's edges and after an add that moves a
 * target while its importer's bytes stay the same.
 */

const FILES = {
  "src/lib.ts": "export const one = 1;\n",
  "src/extra.ts": "export const two = 2;\n",
  "src/uses.ts": [
    'import { one } from "./lib.js";',
    "export const value = one;",
    'export const load = () => import("./later.js");',
    "",
  ].join("\n"),
  "test/a.test.ts": [
    'import { expect, it } from "vitest";',
    'import { value } from "../src/uses.js";',
    'it("a", () => expect(value).toBe(1));',
    "",
  ].join("\n"),
  "test/b.test.ts": [
    'import { expect, it } from "vitest";',
    'import { one } from "../src/lib.js";',
    'it("b", () => expect(one).toBe(1));',
    "",
  ].join("\n"),
};

const fresh: RunnerAdapter[] = [];
afterEach(async () => {
  await Promise.all(fresh.splice(0).map((adapter) => adapter.close()));
});

/** The closure with its `imports` in path order: a cold walk lists them in the order transforms end. */
const sorted = (closure: RunnerClosure) => ({
  ...closure,
  imports: [...(closure.imports ?? [])].sort((x, y) => x.path.localeCompare(y.path)),
});

async function same(root: string, warm: RunnerAdapter, path: string): Promise<RunnerClosure> {
  const adapter = await createVitestAdapter({ root });
  fresh.push(adapter);
  const kept = await warm.closure(ref(path));
  expect(sorted(kept)).toEqual(sorted(await adapter.closure(ref(path))));
  return kept;
}

describe("closures with the path and edge caches (011-414)", SLOW, () => {
  it("equal a fresh adapter's after an edit and after an add that moves a target", async () => {
    const fx = await openFixture("basic", FILES);
    const warm = fx.adapter;
    await warm.closure(ref("test/b.test.ts"));
    const before = await same(fx.root, warm, "test/a.test.ts");
    expect(before.imports?.find((e) => e.path === "src/uses.ts")?.dynamic).toEqual([
      "src/later.js",
    ]);

    // Same bytes in `src/uses.ts`; its dynamic target now resolves to the added file.
    fx.write("src/later.ts", "export const later = 3;\n");
    await warm.invalidate([{ path: "src/later.ts", kind: "add" }]);
    const added = await same(fx.root, warm, "test/a.test.ts");
    expect(added.imports?.find((e) => e.path === "src/uses.ts")?.dynamic).toEqual(["src/later.ts"]);

    // Edited bytes whose edges change.
    fx.write("src/uses.ts", 'import { two } from "./extra.js";\nexport const value = two - 1;\n');
    await warm.invalidate([{ path: "src/uses.ts", kind: "change" }]);
    const edited = await same(fx.root, warm, "test/a.test.ts");
    expect(edited.imports?.find((e) => e.path === "src/uses.ts")).toMatchObject({
      static: ["src/extra.ts"],
      dynamic: [],
    });
    expect(edited.paths).not.toContain("src/lib.ts");
  });
});
