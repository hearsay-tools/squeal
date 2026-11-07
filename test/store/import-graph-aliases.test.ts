import { describe, expect, it } from "vitest";
import { readImportGraph } from "../../src/core/store/import-graph.js";
import { openFixture, ref, SLOW } from "../runners/vitest/helpers.js";
import { fakeCommonDir, open } from "./helpers.js";
import { persistGraph } from "./persist-graph.js";

/*
 * Review 0.1.415 B2: identical importer bytes, an alias to another file.
 * Two real Vitest adapters' closures and environments, persisted into one
 * store as their daemons do, each read back its own targets; so do two
 * projects of one worktree.
 */

const GATEWAY = 'export { value } from "@leaf";\n';
const SOURCES = {
  "src/a.ts": "export const value = 1;\n",
  "src/b.ts": "export const value = 2;\n",
  "src/gateway.ts": GATEWAY,
  "test/gate-a.test.ts": [
    'import { expect, it } from "vitest";',
    'import { value } from "../src/gateway.js";',
    'it("a", () => expect(value).toBeGreaterThan(0));',
    "",
  ].join("\n"),
  "test/gate-b.test.ts": [
    'import { expect, it } from "vitest";',
    'import { value } from "../src/gateway.js";',
    'it("b", () => expect(value).toBeGreaterThan(0));',
    "",
  ].join("\n"),
};

const leaf = (file: string) => `{ "@leaf": new URL("./src/${file}", import.meta.url).pathname }`;

/** A config whose one project resolves `@leaf` to `file`. */
const oneProject = (file: string) =>
  [
    'import { defineConfig } from "vitest/config";',
    `export default defineConfig({ test: { include: ["test/gate-*.test.ts"], alias: ${leaf(file)} } });`,
    "",
  ].join("\n");

/** Two projects: `pa` resolves `@leaf` to `a.ts`, `pb` to `b.ts`. */
const TWO_PROJECTS = [
  'import { defineConfig } from "vitest/config";',
  "export default defineConfig({ test: { projects: [",
  `  { test: { name: "pa", include: ["test/gate-a.test.ts"], alias: ${leaf("a.ts")} } },`,
  `  { test: { name: "pb", include: ["test/gate-b.test.ts"], alias: ${leaf("b.ts")} } },`,
  "] } });",
  "",
].join("\n");

const GATE = "src/gateway.ts";

describe("edges by resolution context, from real adapters (R1 B2)", SLOW, () => {
  it("keeps two worktrees' targets apart when their aliases differ", async () => {
    const store = open(fakeCommonDir());
    const roots: string[] = [];
    const hashes: string[] = [];
    for (const [id, file] of [
      ["one", "a.ts"],
      ["two", "b.ts"],
    ] as const) {
      const fx = await openFixture("basic", { ...SOURCES, "vitest.config.ts": oneProject(file) });
      const closure = await fx.adapter.closure(ref("test/gate-a.test.ts"));
      expect(closure.imports?.find((f) => f.path === GATE)?.static).toEqual([`src/${file}`]);
      const environments = await fx.adapter.environment();
      hashes.push(
        persistGraph(store, id, fx.root, { closures: [closure], environments }).get("") ?? "",
      );
      roots.push(fx.root);
    }

    // The alias is in the environment hash, so the two rows never meet.
    expect(hashes[0]).not.toBe(hashes[1]);
    const [rootOne = "", rootTwo = ""] = roots;
    expect(readImportGraph(store, rootOne, "one").targets(GATE, "")).toEqual({
      static: ["src/a.ts"],
      dynamic: [],
    });
    expect(readImportGraph(store, rootTwo, "two").targets(GATE, "")).toEqual({
      static: ["src/b.ts"],
      dynamic: [],
    });
  });

  it("keeps two projects' targets apart in one worktree", async () => {
    const store = open(fakeCommonDir());
    const fx = await openFixture("basic", { ...SOURCES, "vitest.config.ts": TWO_PROJECTS });
    const closures = [
      await fx.adapter.closure(ref("test/gate-a.test.ts", "pa")),
      await fx.adapter.closure(ref("test/gate-b.test.ts", "pb")),
    ];
    const environments = await fx.adapter.environment();
    persistGraph(store, "one", fx.root, { closures, environments });

    const graph = readImportGraph(store, fx.root, "one");
    expect(graph.targets(GATE, "pa")).toEqual({ static: ["src/a.ts"], dynamic: [] });
    expect(graph.targets(GATE, "pb")).toEqual({ static: ["src/b.ts"], dynamic: [] });
  });
});
