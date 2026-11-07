import { describe, expect, it } from "vitest";
import { readImportGraph } from "../../src/core/store/import-graph.js";
import { openFixture, ref, SLOW } from "../runners/vitest/helpers.js";
import { fakeCommonDir, open } from "./helpers.js";
import { persistGraph } from "./persist-graph.js";

/*
 * Reviews 0.1.415 B2 and 0.1.415-r2 B2, under R2's rule: identical
 * importer bytes, resolved to different files. Real Vitest adapters'
 * closures and environments, keyed by the real key code and persisted
 * into one store as their daemons do; each worktree and project reads the
 * walk written with its own current key, and a worktree at the same key
 * shares it.
 */

const SOURCES = {
  "src/a.ts": "export const value = 1;\n",
  "src/b.ts": "export const value = 2;\n",
  "src/leaf.ts": "export const value = 3;\n",
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

const ALIASED = 'export { value } from "@leaf";\n';
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
const A = ref("test/gate-a.test.ts");

/** The gateway's static targets in the walk `id`'s current key for `test` was written with. */
const gatewayOf = (store: ReturnType<typeof open>, id: string, test = A) =>
  readImportGraph(store, id).walk(test)?.imports.get(GATE)?.static;

describe("edges by result key, from real adapters (R1 B2, R2)", SLOW, () => {
  it("keeps two worktrees' walks apart when their aliases differ", async () => {
    const store = open(fakeCommonDir());
    for (const [id, file] of [
      ["one", "a.ts"],
      ["two", "b.ts"],
    ] as const) {
      const fx = await openFixture("basic", {
        ...SOURCES,
        "src/gateway.ts": ALIASED,
        "vitest.config.ts": oneProject(file),
      });
      const closures = [await fx.adapter.closure(A)];
      await persistGraph(store, id, fx.root, {
        closures,
        environments: await fx.adapter.environment(),
      });
    }
    expect(gatewayOf(store, "one")).toEqual(["src/a.ts"]);
    expect(gatewayOf(store, "two")).toEqual(["src/b.ts"]);
  });

  it("keeps two projects' walks apart in one worktree", async () => {
    const store = open(fakeCommonDir());
    const fx = await openFixture("basic", {
      ...SOURCES,
      "src/gateway.ts": ALIASED,
      "vitest.config.ts": TWO_PROJECTS,
    });
    const pa = ref("test/gate-a.test.ts", "pa");
    const pb = ref("test/gate-b.test.ts", "pb");
    const closures = [await fx.adapter.closure(pa), await fx.adapter.closure(pb)];
    await persistGraph(store, "one", fx.root, {
      closures,
      environments: await fx.adapter.environment(),
    });
    expect(gatewayOf(store, "one", pa)).toEqual(["src/a.ts"]);
    expect(gatewayOf(store, "one", pb)).toEqual(["src/b.ts"]);
  });

  it("keeps the .js/.ts fallback apart with equal environment hashes (review 0.1.415-r2 B2)", async () => {
    const store = open(fakeCommonDir());
    const roots: Record<string, Awaited<ReturnType<typeof persistGraph>>> = {};
    const environments: Record<string, string | undefined> = {};
    // Identical config, setup and gateway bytes; only `two` holds src/leaf.js beside src/leaf.ts.
    for (const [id, extra] of [
      ["one", {}],
      ["two", { "src/leaf.js": "export const value = 4;\n" }],
      ["same", {}],
    ] as const) {
      const fx = await openFixture("basic", {
        ...SOURCES,
        ...extra,
        "src/gateway.ts": 'export { value } from "./leaf.js";\n',
      });
      const closures = [await fx.adapter.closure(A)];
      roots[id] = await persistGraph(store, id, fx.root, {
        closures,
        environments: await fx.adapter.environment(),
      });
      environments[id] = roots[id]?.index.environment("");
    }

    // The review's evidence: one environment hash, two resolutions.
    expect(environments.two).toBe(environments.one);
    expect(gatewayOf(store, "one")).toEqual(["src/leaf.ts"]);
    expect(gatewayOf(store, "two")).toEqual(["src/leaf.js"]);
    // Each key owns its walk; a worktree at the same key shares the first one's.
    expect(roots.two?.index.key(A)).not.toBe(roots.one?.index.key(A));
    expect(roots.same?.index.key(A)).toBe(roots.one?.index.key(A));
    expect(gatewayOf(store, "same")).toEqual(["src/leaf.ts"]);
  });
});
