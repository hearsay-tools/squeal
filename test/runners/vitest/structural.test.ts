import { describe, expect, it } from "vitest";
import type { RunReport } from "../../../src/core/types/index.js";
import { resolutionBases, resolutionCandidates } from "../../../src/runners/vitest/graph.js";
import { openFixture, paths, ref, SLOW } from "./helpers.js";

const outcomes = (report: RunReport) => report.results.map((r) => r.outcome);

const readsTest = (specifier: string, expected: string) =>
  [
    'import { expect, it } from "vitest";',
    `import { which } from "${specifier}";`,
    `it("reads ${expected}", () => expect(which).toBe("${expected}"));`,
    "",
  ].join("\n");

describe("resolutionBases", () => {
  const extensions = [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"];

  it("inverts resolutionCandidates: extension, index and TypeScript twin", () => {
    expect(resolutionBases("/r/src/util.ts", extensions)).toEqual([
      "/r/src/util.ts",
      "/r/src/util",
      "/r/src/util.js",
    ]);
    expect(resolutionBases("/r/src/pkg/index.tsx", extensions)).toEqual([
      "/r/src/pkg/index.tsx",
      "/r/src/pkg/index",
      "/r/src/pkg",
      "/r/src/pkg/index.js",
      "/r/src/pkg/index.jsx",
    ]);
    expect(resolutionBases("/r/README", extensions)).toEqual(["/r/README"]);
    for (const path of ["/r/src/util.ts", "/r/src/pkg/index.tsx", "/r/a.mts", "/r/b.json"]) {
      for (const base of resolutionBases(path, extensions)) {
        expect(resolutionCandidates(base, extensions)).toContain(path);
      }
    }
  });
});

/*
 * Lessons, defect 11: an add or delete invalidates only the transforms it can
 * change (spec 001 D4), never every cached transform. One test per case the
 * full invalidation covered, and one that the rest stays cached.
 */
describe("vitest adapter: targeted invalidation on add and delete", SLOW, () => {
  it("a missing import target appears: the importer resolves it", async () => {
    const fx = await openFixture();
    fx.write("src/uses-later.ts", 'export { which } from "./later";\n');
    fx.write("src/uses-pkg.ts", 'export { which } from "./pkg";\n');
    fx.write("test/later.test.ts", readsTest("../src/uses-later.ts", "later"));
    fx.write("test/pkg.test.ts", readsTest("../src/uses-pkg.ts", "pkg"));
    await fx.adapter.invalidate([
      { path: "src/uses-later.ts", kind: "add" },
      { path: "src/uses-pkg.ts", kind: "add" },
      { path: "test/later.test.ts", kind: "add" },
      { path: "test/pkg.test.ts", kind: "add" },
    ]);
    const tests = [ref("test/later.test.ts"), ref("test/pkg.test.ts")];
    const before = await fx.adapter.run(tests, fx.runOptions());
    expect(before.fileErrors).toHaveLength(2);

    // `./later` resolves through an extension, `./pkg` through `index`.
    fx.write("src/later.ts", 'export const which = "later";\n');
    fx.write("src/pkg/index.ts", 'export const which = "pkg";\n');
    await fx.adapter.invalidate([
      { path: "src/later.ts", kind: "add" },
      { path: "src/pkg/index.ts", kind: "add" },
    ]);

    expect(paths(await fx.adapter.affected(["src/later.ts"]))).toEqual(["test/later.test.ts"]);
    expect(paths(await fx.adapter.affected(["src/pkg/index.ts"]))).toEqual(["test/pkg.test.ts"]);
    const after = await fx.adapter.run(tests, fx.runOptions());
    expect(after.fileErrors).toEqual([]);
    expect(outcomes(after)).toEqual(["pass", "pass"]);
  });

  it("a resolved target is deleted: the importer resolves the next candidate", async () => {
    const fx = await openFixture();
    fx.write("src/util.ts", 'export const which = "file";\n');
    fx.write("src/util/index.ts", 'export const which = "index";\n');
    fx.write("src/uses-util.ts", 'export { which } from "./util";\n');
    fx.write("test/util.test.ts", readsTest("../src/uses-util.ts", "index"));
    await fx.adapter.invalidate(
      ["src/util.ts", "src/util/index.ts", "src/uses-util.ts", "test/util.test.ts"].map((path) => ({
        path,
        kind: "add" as const,
      })),
    );
    const test = [ref("test/util.test.ts")];
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["fail"]);

    fx.remove("src/util.ts");
    await fx.adapter.invalidate([{ path: "src/util.ts", kind: "delete" }]);

    expect(paths(await fx.adapter.affected(["src/util/index.ts"]))).toEqual(["test/util.test.ts"]);
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["pass"]);
  });

  it("a new file shadows a resolved one: the importer resolves the new file", async () => {
    const fx = await openFixture();
    fx.write("src/util/index.ts", 'export const which = "index";\n');
    fx.write("src/uses-util.ts", 'export { which } from "./util";\n');
    fx.write("test/util.test.ts", readsTest("../src/uses-util.ts", "file"));
    await fx.adapter.invalidate(
      ["src/util/index.ts", "src/uses-util.ts", "test/util.test.ts"].map((path) => ({
        path,
        kind: "add" as const,
      })),
    );
    const test = [ref("test/util.test.ts")];
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["fail"]);

    fx.write("src/util.ts", 'export const which = "file";\n');
    await fx.adapter.invalidate([{ path: "src/util.ts", kind: "add" }]);

    expect(paths(await fx.adapter.affected(["src/util.ts"]))).toEqual(["test/util.test.ts"]);
    expect(await fx.adapter.affected(["src/util/index.ts"])).toEqual([]);
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["pass"]);
  });

  it("an unrelated add or delete leaves every other transform cached", async () => {
    const fx = await openFixture();
    expect(paths(await fx.adapter.affected(["src/strings.ts"]))).toEqual(["test/strings.test.ts"]);

    // Edited on disk but not invalidated: only a dropped cache would see the new import.
    fx.write("src/math.ts", fx.read("src/math.ts").replace("\n", '\nimport "./strings.ts";\n'));
    fx.write("src/unrelated.ts", "export const unrelated = 1;\n");
    await fx.adapter.invalidate([{ path: "src/unrelated.ts", kind: "add" }]);
    fx.remove("src/unrelated.ts");
    await fx.adapter.invalidate([{ path: "src/unrelated.ts", kind: "delete" }]);
    expect(paths(await fx.adapter.affected(["src/strings.ts"]))).toEqual(["test/strings.test.ts"]);

    await fx.adapter.invalidate([{ path: "src/math.ts", kind: "change" }]);
    expect(paths(await fx.adapter.affected(["src/strings.ts"]))).toEqual([
      "test/each.test.ts",
      "test/math.test.ts",
      "test/strings.test.ts",
    ]);
  });
});

const configWith = (resolve: string) =>
  [
    'import { fileURLToPath } from "node:url";',
    'import { defineConfig } from "vitest/config";',
    'import { include } from "./vitest.shared.ts";',
    `export default defineConfig({ resolve: ${resolve}, test: { include } });`,
    "",
  ].join("\n");

/*
 * Review wave 7, B1: resolution that is not extension, `index` or twin
 * probing. Each case gave the right result under `invalidateAll` and a stale
 * one under the first targeted rule.
 */
describe("vitest adapter: an add re-resolves every resolution path", SLOW, () => {
  // An inline project with a plugin of its own gets its own Vite server (D4: the scan covers it).
  it.each([
    ["the root project", ""],
    ["an inline project with its own Vite server", "own"],
  ])("import.meta.glob picks up the new file in %s", async (_, project) => {
    const own = [
      'import { defineConfig } from "vitest/config";',
      "export default defineConfig({ test: { projects: [",
      '  { plugins: [{ name: "own-server" }], test: { name: "own", include: ["test/**/*.test.ts"] } },',
      "] } });",
      "",
    ].join("\n");
    const fx = await openFixture("basic", {
      ...(project === "" ? {} : { "vitest.config.ts": own }),
      "src/plugins/a.ts": "export const name = 'a';\n",
      // Not `Object.keys(import.meta.glob(...))`: Vite turns that into the keys alone, no imports.
      "src/registry.ts": [
        'const plugins = import.meta.glob("./plugins/*.ts", { eager: true });',
        "export const count = Object.keys(plugins).length;",
        "",
      ].join("\n"),
      "test/registry.test.ts": [
        'import { expect, it } from "vitest";',
        'import { count } from "../src/registry.ts";',
        'it("counts two plugins", () => expect(count).toBe(2));',
        "",
      ].join("\n"),
    });
    const test = [ref("test/registry.test.ts", project)];
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["fail"]);

    fx.write("src/plugins/b.ts", "export const name = 'b';\n");
    await fx.adapter.invalidate([{ path: "src/plugins/b.ts", kind: "add" }]);

    expect(paths(await fx.adapter.affected(["src/plugins/b.ts"]))).toEqual([
      "test/registry.test.ts",
    ]);
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["pass"]);
  });

  it("a template-literal dynamic import loads the new file", async () => {
    const fx = await openFixture("basic", {
      "src/locales/en.ts": 'export const which = "en";\n',
      "src/locale.ts":
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture's own template literal.
        "export const load = (l: string) => import(`./locales/${l}.ts`).then((m) => m.which);\n",
      "test/locale.test.ts": [
        'import { expect, it } from "vitest";',
        'import { load } from "../src/locale.ts";',
        'it("loads fr", async () => expect(await load("fr")).toBe("fr"));',
        "",
      ].join("\n"),
    });
    const test = [ref("test/locale.test.ts")];
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["fail"]);

    fx.write("src/locales/fr.ts", 'export const which = "fr";\n');
    await fx.adapter.invalidate([{ path: "src/locales/fr.ts", kind: "add" }]);

    expect(paths(await fx.adapter.affected(["src/locales/fr.ts"]))).toEqual([
      "test/locale.test.ts",
    ]);
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["pass"]);
  });

  it("a new file shadows a directory resolved through its package.json", async () => {
    const fx = await openFixture("basic", {
      "src/pkg/package.json": '{ "main": "lib.ts" }\n',
      "src/pkg/lib.ts": 'export const which = "dir";\n',
      "src/uses.ts": 'export { which } from "./pkg";\n',
      "test/pkg.test.ts": readsTest("../src/uses.ts", "file"),
    });
    const test = [ref("test/pkg.test.ts")];
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["fail"]);

    fx.write("src/pkg.ts", 'export const which = "file";\n');
    await fx.adapter.invalidate([{ path: "src/pkg.ts", kind: "add" }]);

    expect(paths(await fx.adapter.affected(["src/pkg.ts"]))).toEqual(["test/pkg.test.ts"]);
    expect(await fx.adapter.affected(["src/pkg/lib.ts"])).toEqual([]);
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["pass"]);
  });

  it("a new package.json re-points a directory resolved through its index", async () => {
    const fx = await openFixture("basic", {
      "src/pkg/index.ts": 'export const which = "index";\n',
      "src/pkg/lib.ts": 'export const which = "main";\n',
      "src/uses.ts": 'export { which } from "./pkg";\n',
      "test/pkg.test.ts": readsTest("../src/uses.ts", "main"),
    });
    const test = [ref("test/pkg.test.ts")];
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["fail"]);

    fx.write("src/pkg/package.json", '{ "main": "lib.ts" }\n');
    await fx.adapter.invalidate([{ path: "src/pkg/package.json", kind: "add" }]);

    expect(paths(await fx.adapter.affected(["src/pkg/lib.ts"]))).toEqual(["test/pkg.test.ts"]);
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["pass"]);
  });

  it.each([
    ["an alias", '{ alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } }', "@"],
    ["tsconfig paths", "{ tsconfigPaths: true }", "~"],
  ])("an unresolved %s specifier enters the closure", async (_, resolve, prefix) => {
    const fx = await openFixture("basic", {
      "vitest.config.ts": configWith(resolve),
      "tsconfig.json": '{ "compilerOptions": { "paths": { "~/*": ["./src/*"] } } }\n',
      "src/uses.ts": `export { which } from "${prefix}/later";\n`,
      "test/later.test.ts": readsTest("../src/uses.ts", "later"),
    });
    const later = ref("test/later.test.ts");
    const test = [later];
    expect((await fx.adapter.run(test, fx.runOptions())).fileErrors).toHaveLength(1);

    fx.write("src/later.ts", 'export const which = "later";\n');
    await fx.adapter.invalidate([{ path: "src/later.ts", kind: "add" }]);

    expect(paths(await fx.adapter.affected(["src/later.ts"]))).toEqual(["test/later.test.ts"]);
    expect((await fx.adapter.closure(later)).paths).toContain("src/later.ts");
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["pass"]);

    fx.write("src/later.ts", 'export const which = "changed";\n');
    await fx.adapter.invalidate([{ path: "src/later.ts", kind: "change" }]);
    expect(paths(await fx.adapter.affected(["src/later.ts"]))).toEqual(["test/later.test.ts"]);
  });
});

const countsTwo = (from: string) =>
  [
    'import { expect, it } from "vitest";',
    `import { count } from "${from}";`,
    'it("counts two plugins", () => expect(count).toBe(2));',
    "",
  ].join("\n");

const globsPlugins = [
  'const plugins = import.meta.glob("/src/plugins/*.ts", { eager: true });',
  "export const count = Object.keys(plugins).length;",
].join("\n");

/*
 * Review wave 7.5, B1 and B2: adds that `invalidateAll` re-ran right and the
 * targeted rules left stale. A glob in a module with no source of its own on
 * disk (a virtual module, an inlined dependency) never enters a closure
 * (N5), so `affected` stays empty there; the run must still read the disk.
 */
describe("vitest adapter: an add re-resolves past the scan and the index fallback", SLOW, () => {
  it.each([
    [
      "a virtual module",
      "virtual:plugins",
      {
        "vitest.config.ts": [
          'import { defineConfig } from "vitest/config";',
          'import { include } from "./vitest.shared.ts";',
          'const id = "virtual:plugins";',
          'const key = "\\0virtual:plugins";',
          "export default defineConfig({",
          "  plugins: [{",
          '    name: "plugins",',
          "    resolveId: (source) => (source === id ? key : undefined),",
          `    load: (loaded) => (loaded === key ? ${JSON.stringify(globsPlugins)} : undefined),`,
          "  }],",
          "  test: { include },",
          "});",
          "",
        ].join("\n"),
      },
    ],
    [
      "an inlined dependency",
      "globby-lib",
      {
        "vitest.config.ts": [
          'import { defineConfig } from "vitest/config";',
          'import { include } from "./vitest.shared.ts";',
          'export default defineConfig({ test: { include, server: { deps: { inline: ["globby-lib"] } } } });',
          "",
        ].join("\n"),
        "node_modules/globby-lib/package.json":
          '{ "name": "globby-lib", "type": "module", "main": "index.js" }\n',
        "node_modules/globby-lib/index.js": `${globsPlugins}\n`,
      },
    ],
  ])("import.meta.glob in %s picks up the new file", async (_, from, files) => {
    const fx = await openFixture("basic", {
      ...files,
      "src/plugins/a.ts": "export const name = 'a';\n",
      "test/registry.test.ts": countsTwo(from),
    });
    const test = [ref("test/registry.test.ts")];
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["fail"]);

    fx.write("src/plugins/b.ts", "export const name = 'b';\n");
    await fx.adapter.invalidate([{ path: "src/plugins/b.ts", kind: "add" }]);

    expect(await fx.adapter.affected(["src/plugins/b.ts"])).toEqual([]);
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["pass"]);
  });

  it("the file a package.json main names appears: the directory leaves its index", async () => {
    const fx = await openFixture("basic", {
      "src/pkg/package.json": '{ "main": "lib.ts" }\n',
      "src/pkg/index.ts": 'export const which = "index";\n',
      "src/uses.ts": 'export { which } from "./pkg";\n',
      "test/pkg.test.ts": readsTest("../src/uses.ts", "lib"),
    });
    const test = [ref("test/pkg.test.ts")];
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["fail"]);

    fx.write("src/pkg/lib.ts", 'export const which = "lib";\n');
    await fx.adapter.invalidate([{ path: "src/pkg/lib.ts", kind: "add" }]);

    expect(paths(await fx.adapter.affected(["src/pkg/lib.ts"]))).toEqual(["test/pkg.test.ts"]);
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["pass"]);
  });
});
