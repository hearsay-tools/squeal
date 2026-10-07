import { realpathSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Vitest } from "vitest/node";
import { VitestAdapter } from "../../../src/runners/vitest/adapter.js";
import { depToPath } from "../../../src/runners/vitest/graph.js";
import { loadVitest, type VitestNode } from "../../../src/runners/vitest/load.js";
import { WorktreePaths } from "../../../src/runners/vitest/paths.js";
import { FALLBACK_NOTE } from "../../../src/runners/vitest/stale.js";
import { openFixture, paths, ref, SLOW } from "./helpers.js";

/** An adapter whose Vitest instance the test can reach. */
async function exposed(
  root: string,
  onStart: (vitest: Vitest) => void,
  note: (text: string) => void = () => {},
) {
  const real = await loadVitest(realpathSync(root));
  const node = {
    ...real,
    createVitest: async (...args: Parameters<VitestNode["createVitest"]>) => {
      const vitest = await real.createVitest(...args);
      onStart(vitest);
      return vitest;
    },
  } as VitestNode;
  const adapter = new VitestAdapter(new WorktreePaths(realpathSync(root)), node, note);
  await adapter.open();
  return adapter;
}

describe("depToPath", () => {
  it("strips the query in every branch (reviews/wave-7.md N1)", () => {
    const importer = "/r/src/a.ts";
    expect(depToPath("/src/later.ts?raw", importer, "/r")).toBe("/r/src/later.ts");
    expect(depToPath("/@fs/x/later.ts?url", importer, "/r")).toBe("/x/later.ts");
    expect(depToPath("./later?raw", importer, "/r")).toBe("/r/src/later");
    expect(depToPath("../later.ts?import", importer, "/r")).toBe("/r/later.ts");
    expect(depToPath("@/later?raw", importer, "/r")).toBeNull();
  });
});

/*
 * Reviews/wave-7.md S2: `invalidationState` is internal to Vite. Soft
 * invalidation must keep counting, and a Vite without the field must fall
 * back to dropping every transform, said once.
 */
describe("vitest adapter: soft invalidation and its fallback", SLOW, () => {
  it("an importer soft-invalidated in the same batch is re-resolved by the add", async () => {
    const fx = await openFixture("basic", {
      "src/util/index.ts": 'export const which = "index";\n',
      "src/uses-util.ts": 'export { which } from "./util";\n',
      "test/util.test.ts": [
        'import { expect, it } from "vitest";',
        'import { which } from "../src/uses-util.ts";',
        'it("reads file", () => expect(which).toBe("file"));',
        "",
      ].join("\n"),
    });
    const test = [ref("test/util.test.ts")];
    expect((await fx.adapter.run(test, fx.runOptions())).results[0]?.outcome).toBe("fail");

    // The edit soft-invalidates `uses-util.ts`; the add then shadows its target.
    fx.write("src/util/index.ts", 'export const which = "index, edited";\n');
    fx.write("src/util.ts", 'export const which = "file";\n');
    await fx.adapter.invalidate([
      { path: "src/util/index.ts", kind: "change" },
      { path: "src/util.ts", kind: "add" },
    ]);

    expect(paths(await fx.adapter.affected(["src/util.ts"]))).toEqual(["test/util.test.ts"]);
    expect((await fx.adapter.run(test, fx.runOptions())).results[0]?.outcome).toBe("pass");
  });

  it("without invalidationState an add drops every transform and notes it once", async () => {
    let vitest: Vitest | null = null;
    const notes: string[] = [];
    const fx = await openFixture("basic", {}, (root) =>
      exposed(
        root,
        (v) => {
          vitest = v;
        },
        (text) => notes.push(text),
      ),
    );
    expect(paths(await fx.adapter.affected(["src/strings.ts"]))).toEqual(["test/strings.test.ts"]);
    for (const project of (vitest as Vitest | null)?.projects ?? []) {
      for (const environment of Object.values(project.vite.environments)) {
        for (const modules of environment.moduleGraph.fileToModulesMap.values()) {
          for (const module of modules)
            delete (module as { invalidationState?: unknown }).invalidationState;
        }
      }
    }

    // Edited on disk but not invalidated: only a dropped cache sees the new import.
    fx.write("src/math.ts", fx.read("src/math.ts").replace("\n", '\nimport "./strings.ts";\n'));
    fx.write("src/unrelated.ts", "export const unrelated = 1;\n");
    await fx.adapter.invalidate([{ path: "src/unrelated.ts", kind: "add" }]);
    expect(notes).toEqual([FALLBACK_NOTE]);
    expect(paths(await fx.adapter.affected(["src/strings.ts"]))).toEqual([
      "test/each.test.ts",
      "test/math.test.ts",
      "test/strings.test.ts",
    ]);

    fx.remove("src/unrelated.ts");
    await fx.adapter.invalidate([{ path: "src/unrelated.ts", kind: "delete" }]);
    expect(notes).toEqual([FALLBACK_NOTE]);
  });
});
