import { describe, expect, it } from "vitest";
import { GLOB_FILES, GLOB_TEST } from "../../keys/validity/cases/adapter/vitest-globs.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Row 023-13 (fix A): what the adapter reports beside a closure on real
 * Vite, for the validity case's modules: each module's glob folders,
 * resolved as Vite resolves the pattern. A comment that holds glob text
 * reports none; a module strip mode refuses (an enum) reports its own
 * folder, recursively.
 */

describe("vitest adapter: a closure's glob folders (row 023-13)", SLOW, () => {
  it("reports each module's folders, resolved as Vite does", async () => {
    const fx = await openFixture("basic", GLOB_FILES);
    const closure = await fx.adapter.closure(ref(GLOB_TEST));
    expect(closure.paths).toContain("src/plugins/kept.ts");
    // In walk order; the core merges them into sets.
    const globs = [...(closure.globs ?? [])].sort((a, b) => a.path.localeCompare(b.path));
    expect(globs).toEqual([
      { path: "src/aliased.ts", directories: ["src/plugins"], recursive: [] },
      { path: "src/based.ts", directories: ["src/plugins"], recursive: [] },
      { path: "src/enumed.ts", directories: ["src"], recursive: ["src"] },
      { path: "src/locale.ts", directories: ["src/plugins"], recursive: [] },
      { path: "src/registry.ts", directories: ["src/plugins"], recursive: [] },
      { path: "src/rooted.ts", directories: ["src/plugins"], recursive: [] },
      { path: "src/sub/up.ts", directories: ["src/plugins"], recursive: [] },
    ]);
  });
});
