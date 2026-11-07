import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { FileImports, RunnerClosure } from "../../../src/core/types/runner.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Spec 015 D11 (row 015-108): a closure walk reports each walked file's
 * direct import targets, static apart from dynamic, by the bytes Vite read.
 */

const FILES = {
  "src/types.ts": "export interface Shape { readonly n: number }\n",
  "src/lib.ts": "export const one = 1;\n",
  "src/lazy.ts": "export const later = 2;\n",
  "src/barrel.ts": 'export * from "./lib.js";\nexport { later } from "./lazy.js";\n',
  "src/uses.ts": [
    'import type { Shape } from "./types.js";',
    'import { one } from "./barrel.js";',
    "export const shape: Shape = { n: one };",
    'export const load = () => import("./lazy.js");',
    "",
  ].join("\n"),
  "test/edges-a.test.ts": [
    'import { expect, it } from "vitest";',
    'import { shape } from "../src/uses.js";',
    'it("a", () => expect(shape.n).toBe(1));',
    "",
  ].join("\n"),
  "test/edges-b.test.ts": [
    'import { expect, it } from "vitest";',
    'import { one } from "../src/barrel.js";',
    'it("b", () => expect(one).toBe(1));',
    "",
  ].join("\n"),
};

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");
const of = (closure: RunnerClosure, path: string) =>
  closure.imports?.find((entry) => entry.path === path);

describe("closure imports (015-108)", SLOW, () => {
  it("lists each walked file's static and dynamic targets apart, without type-only ones", async () => {
    const fx = await openFixture("basic", FILES);
    const closure = await fx.adapter.closure(ref("test/edges-a.test.ts"));

    expect(of(closure, "src/uses.ts")).toEqual({
      path: "src/uses.ts",
      sha1: sha1(FILES["src/uses.ts"]),
      static: ["src/barrel.ts"],
      dynamic: ["src/lazy.ts"],
    } satisfies FileImports);
    expect(of(closure, "src/barrel.ts")).toMatchObject({
      static: ["src/lazy.ts", "src/lib.ts"],
      dynamic: [],
    });
    expect(of(closure, "test/edges-a.test.ts")?.static).toEqual(["src/uses.ts"]);
    expect(of(closure, "src/lib.ts")).toMatchObject({ static: [], dynamic: [] });
    // `import type` leaves the transform, so the file is neither a target nor walked.
    expect(closure.paths).not.toContain("src/types.ts");
    expect(of(closure, "src/types.ts")).toBeUndefined();
    // Installed packages are no project files.
    expect(closure.imports?.every((entry) => !entry.path.includes("node_modules"))).toBe(true);
  });

  it("gives closures that walk a file at the same bytes one entry, and a new one after an edit", async () => {
    const fx = await openFixture("basic", FILES);
    const a = await fx.adapter.closure(ref("test/edges-a.test.ts"));
    const b = await fx.adapter.closure(ref("test/edges-b.test.ts"));
    expect(of(b, "src/barrel.ts")).toBe(of(a, "src/barrel.ts"));

    const edited = 'export * from "./lib.js";\n';
    fx.write("src/barrel.ts", edited);
    await fx.adapter.invalidate([{ path: "src/barrel.ts", kind: "change" }]);
    const again = await fx.adapter.closure(ref("test/edges-b.test.ts"));

    expect(of(again, "src/barrel.ts")).toEqual({
      path: "src/barrel.ts",
      sha1: sha1(edited),
      static: ["src/lib.ts"],
      dynamic: [],
    });
    expect(of(again, "src/lib.ts")).toBe(of(a, "src/lib.ts"));
  });
});
