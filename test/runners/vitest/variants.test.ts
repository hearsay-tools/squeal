import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { openFixture, outcomes, readsTest, ref, SLOW } from "./helpers.js";

/*
 * Task 001-157's inventory (`tasks/001-157/notes.md`): each way Vite and
 * Vitest hold bytes of a project file. A run on transient bytes caches them;
 * the file is restored with no revision and no `invalidate`; the next run
 * must run the bytes on disk. `src/mod.ts` exports `which`; each test
 * expects `"new"`, the transient bytes.
 */

const NEW = 'export const which = "new";\n';
const OLD = 'export const which = "old";\n';

const config = (test: string, extra = "") =>
  `import { defineConfig } from "vitest/config";\n${extra}export default defineConfig({ ${test} });\n`;
const INCLUDE = 'include: ["test/*.test.ts"]';

/** A test file of `body` lines, under the imports `head` names. */
const testFile = (head: string, body: string) =>
  [
    `import { expect, it, vi } from "vitest";`,
    head,
    `it("reads new", async () => {`,
    body,
    "});",
    "",
  ].join("\n");

interface Class {
  readonly files: Readonly<Record<string, string>>;
  /** The file rewritten and restored; `src/mod.ts` unless named. */
  readonly path?: string;
  readonly transient?: string;
  readonly disk?: string;
}

const CLASSES: Readonly<Record<string, Class>> = {
  // The plain/query pair in one container is test/integration/query-stamps.test.ts.
  "a query variant": {
    files: {
      "test/t.test.ts": testFile(
        'import { which } from "../src/mod.ts?variant";',
        '  expect(which).toBe("new");',
      ),
    },
  },
  "a ?raw import": {
    files: {
      "test/t.test.ts": testFile(
        'import raw from "../src/mod.ts?raw";',
        '  expect(raw).toContain("new");',
      ),
    },
  },
  // Vitest processes no CSS by default, and `?inline` is then empty.
  "a CSS ?inline import with CSS processed": {
    path: "src/style.css",
    transient: '.x { content: "new"; }\n',
    disk: '.x { content: "old"; }\n',
    files: {
      "vitest.config.ts": config(`test: { ${INCLUDE}, css: { include: [/.+/] } }`),
      "test/t.test.ts": testFile(
        'import css from "../src/style.css?inline";',
        '  expect(css).toContain("new");',
      ),
    },
  },
  "a \\0 ID a plugin resolves to the file": {
    files: {
      "vitest.config.ts": config(
        `plugins: [{ name: "virtual-mod", resolveId: (id) => (id === "virtual:mod" ? "\\0" + resolve(import.meta.dirname, "src/mod.ts") + "?virtual" : null), load: (id) => (id.startsWith("\\0") && id.endsWith("/src/mod.ts?virtual") ? readFileSync(id.slice(1, -"?virtual".length), "utf8") : null) }], test: { ${INCLUDE} }`,
        'import { readFileSync } from "node:fs";\nimport { resolve } from "node:path";\n',
      ),
      "test/t.test.ts": testFile(
        'import { which } from "virtual:mod";',
        '  expect(which).toBe("new");',
      ),
    },
  },
  "a virtual module built from the file": {
    files: {
      "vitest.config.ts": config(
        `plugins: [{ name: "virtual-which", resolveId: (id) => (id === "virtual:which" ? "\\0virtual:which" : null), load(id) { if (id !== "\\0virtual:which") return null; const file = resolve(import.meta.dirname, "src/mod.ts"); this.addWatchFile(file); return readFileSync(file, "utf8"); } }], test: { ${INCLUDE} }`,
        'import { readFileSync } from "node:fs";\nimport { resolve } from "node:path";\n',
      ),
      "test/t.test.ts": testFile(
        'import { which } from "virtual:which";',
        '  expect(which).toBe("new");',
      ),
    },
  },
  "an eager import.meta.glob": {
    files: {
      "test/t.test.ts": testFile(
        'const mods = import.meta.glob("../src/mod.ts", { eager: true });',
        '  expect(Object.values(mods).map((m) => m.which)).toEqual(["new"]);',
      ),
    },
  },
  "the original under a vi.mock factory": {
    files: {
      "test/t.test.ts": testFile(
        'import { which } from "../src/mod.ts";\nvi.mock("../src/mod.ts", async (original) => ({ ...(await original()) }));',
        '  expect(which).toBe("new");',
      ),
    },
  },
  "a __mocks__ file": {
    path: "src/__mocks__/mod.ts",
    files: {
      "src/__mocks__/mod.ts": OLD,
      "test/t.test.ts": testFile(
        'import { which } from "../src/mod.ts";\nvi.mock("../src/mod.ts");',
        '  expect(which).toBe("new");',
      ),
    },
  },
  "an automocked module": {
    transient: 'export const which = () => "new";\n',
    disk: "export const which = 1;\n",
    files: {
      "test/t.test.ts": testFile(
        'import { which } from "../src/mod.ts";\nvi.mock("../src/mod.ts");',
        '  expect(typeof which).toBe("function");',
      ),
    },
  },
  "the client environment": {
    files: {
      "vitest.config.ts": config(`test: { ${INCLUDE}, environment: "./test/web.ts" }`),
      "test/web.ts":
        'export default { name: "web", viteEnvironment: "client", setup: () => ({ teardown() {} }) };\n',
      "test/t.test.ts": testFile(
        'import { which } from "../src/mod.ts";',
        '  expect(which).toBe("new");',
      ),
    },
  },
  "a worker reused across files (isolate: false)": {
    files: {
      "vitest.config.ts": config(`test: { ${INCLUDE}, isolate: false, maxWorkers: 1 }`),
      "test/a.test.ts": readsTest("../src/mod.ts", "new"),
      "test/t.test.ts": readsTest("../src/mod.ts", "new"),
    },
  },
};

describe("vitest adapter: every way a project file's bytes are held (001-157)", SLOW, () => {
  it.each(Object.entries(CLASSES))("runs the bytes on disk through %s", async (_, c) => {
    const path = c.path ?? "src/mod.ts";
    const fx = await openFixture("basic", {
      "vitest.config.ts": config(`test: { ${INCLUDE} }`),
      "src/mod.ts": OLD,
      ...c.files,
      [path]: c.disk ?? OLD,
    });
    const files = Object.keys(c.files)
      .filter((p) => p.endsWith(".test.ts"))
      .sort()
      .map((p) => ref(p));
    const expected = (outcome: string) => files.map(() => outcome);
    fx.write(path, c.transient ?? NEW);
    const first = await fx.adapter.run(files, fx.runOptions());
    expect([first.failure, first.fileErrors]).toEqual([null, []]);
    expect(outcomes(first)).toEqual(expected("pass"));
    // Restored with no revision: nothing tells the adapter.
    fx.write(path, c.disk ?? OLD);
    expect(outcomes(await fx.adapter.run(files, fx.runOptions()))).toEqual(expected("fail"));
  });
});

describe("vitest adapter: Vitest's fsModuleCache (001-157)", SLOW, () => {
  it.each([
    [
      "the root config",
      { "vitest.config.ts": config(`test: { ${INCLUDE}, fsModuleCache: true }`) },
    ],
    [
      "a project's own config file",
      {
        "vitest.config.ts": config('test: { projects: ["./vitest.unit.config.ts"] }'),
        "vitest.unit.config.ts": config(`test: { name: "unit", ${INCLUDE}, fsModuleCache: true }`),
      },
    ],
  ])("is off whatever %s says, so every transform is stamped", async (_, files) => {
    const fx = await openFixture("basic", {
      ...files,
      "src/mod.ts": NEW,
      "test/mod.test.ts": readsTest("../src/mod.ts", "new"),
    });
    const project = "vitest.unit.config.ts" in files ? "unit" : "";
    const mod = ref("test/mod.test.ts", project);
    // A second instance would load the first's cached transforms without reading them.
    const fresh = await createVitestAdapter({ root: fx.root });
    try {
      for (const adapter of [fx.adapter, fresh, fresh]) {
        const report = await adapter.run([mod], fx.runOptions());
        expect(report.failure).toBeNull();
        expect(outcomes(report)).toEqual(["pass"]);
      }
    } finally {
      await fresh.close();
    }
    expect(existsSync(join(fx.root, "node_modules/.vitest-cache"))).toBe(false);
  });
});
