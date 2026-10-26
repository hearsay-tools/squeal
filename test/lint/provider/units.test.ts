import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { buildSync } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import { sortLoaded } from "../../../src/core/lint/provider/loaded.js";
import {
  findTsconfigs,
  loadedTypeScript,
  namedTsconfigs,
  ProgramReader,
} from "../../../src/core/lint/provider/program.js";
import { lintWorkerScript } from "../../../src/core/lint/provider/script.js";
import { lintSignals } from "../../../src/core/lint/provider/signals.js";

const REPO = join(import.meta.dirname, "../../..");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "squeal-lint-unit-"));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe("D5 signals from a computed config", () => {
  it("typed: project, projectService or programs", () => {
    for (const parserOptions of [
      { project: true },
      { project: "./a.json" },
      { projectService: true },
      { programs: [] },
    ]) {
      expect(
        lintSignals({ languageOptions: { parserOptions } }).typed,
        JSON.stringify(parserOptions),
      ).toBe(true);
    }
    expect(
      lintSignals({ languageOptions: { parserOptions: { project: false, projectService: null } } })
        .typed,
    ).toBe(false);
    expect(lintSignals({}).typed).toBe(false);
  });

  it("cross-file: an enabled rule of import or import-x, by namespace or by plugin name", () => {
    expect(lintSignals({ rules: { "import/named": [2] } }).crossFile).toBe(true);
    expect(lintSignals({ rules: { "import-x/no-cycle": [1, {}] } }).crossFile).toBe(true);
    expect(
      lintSignals({ plugins: ["@", "i:eslint-plugin-import-x@4.17.1"], rules: { "i/named": [2] } })
        .crossFile,
    ).toBe(true);
    expect(
      lintSignals({ plugins: ["i:eslint-plugin-import@2.31.0"], rules: { "i/named": "error" } })
        .crossFile,
    ).toBe(true);
    expect(lintSignals({ rules: { "import-x/named": [0] } }).crossFile).toBe(false);
    expect(lintSignals({ rules: { "import/named": "off" } }).crossFile).toBe(false);
    expect(
      lintSignals({
        plugins: ["x:eslint-plugin-react@7.0.0"],
        rules: { "x/jsx-key": [2], "no-undef": [2] },
      }).crossFile,
    ).toBe(false);
  });
});

describe("D4 modules the worker resolved", () => {
  it("are project files or package roots", () => {
    const root = "/p";
    const url = (path: string) => pathToFileURL(path).href;
    expect(
      sortLoaded(
        [
          `${url("/p/eslint.config.js")}?mtime=12`,
          url("/p/eslint/local.js"),
          url("/p/node_modules/eslint-plugin-x/lib/index.js"),
          url("/p/node_modules/@scope/config/index.js"),
          url("/p/node_modules/a/node_modules/b/b.js"),
          url("/repo/node_modules/eslint/lib/api.js"),
          url("/shared/base.js"),
          "node:fs",
        ],
        root,
      ),
    ).toEqual({
      closure: ["eslint.config.js", "eslint/local.js"],
      packages: [
        "/p/node_modules/@scope/config",
        "/p/node_modules/a/node_modules/b",
        "/p/node_modules/eslint-plugin-x",
        "/repo/node_modules/eslint",
        "/shared/base.js",
      ],
    });
  });
});

describe("D5 the tsconfig program", () => {
  const ts = loadedTypeScript([join(REPO, "test/fixtures/lint/toolchain/node_modules/typescript")]);

  it("finds every tsconfig.json outside node_modules and dot folders", () => {
    const root = tree({
      "tsconfig.json": "{}",
      "packages/a/tsconfig.json": "{}",
      "node_modules/x/tsconfig.json": "{}",
      ".cache/tsconfig.json": "{}",
      "tsconfig.build.json": "{}",
    });
    expect(findTsconfigs(root)).toEqual([
      join(root, "packages/a/tsconfig.json"),
      join(root, "tsconfig.json"),
    ]);
  });

  it("names the tsconfigs a typed config's project gives, from tsconfigRootDir", () => {
    const root = tree({
      "tsconfig.eslint.json": "{}",
      "packages/a/tsconfig.json": "{}",
      "packages/b/tsconfig.json": "{}",
    });
    expect(namedTsconfigs({ project: "./tsconfig.eslint.json" }, root)).toEqual([
      join(root, "tsconfig.eslint.json"),
    ]);
    expect(
      namedTsconfigs(
        { project: ["packages/*/tsconfig.json"], tsconfigRootDir: root },
        "/elsewhere",
      ),
    ).toEqual([join(root, "packages/a/tsconfig.json"), join(root, "packages/b/tsconfig.json")]);
    expect(namedTsconfigs({ project: true }, root)).toEqual([]);
  });

  it("reads each tsconfig's files and the configs it extends", () => {
    const root = tree({
      "base.json": '{ "compilerOptions": { "strict": true } }',
      "tsconfig.json": '{ "extends": "./base.json", "include": ["src/**/*.ts"] }',
      "src/a.ts": "export {};",
      "src/b.ts": "export {};",
      "other/c.ts": "export {};",
      "broken/tsconfig.json": "{ not json",
    });
    expect(ts).not.toBeNull();
    if (ts === null) return;
    expect(
      new ProgramReader(ts, root).read([join(root, "tsconfig.json"), join(root, "missing.json")]),
    ).toEqual({
      tsconfigs: ["base.json", "missing.json", "tsconfig.json"],
      files: ["src/a.ts", "src/b.ts"],
    });
  });

  it("follows imports past include, as TypeScript's own program does (review 0.1.348 B3)", () => {
    const root = tree({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { module: "nodenext", allowJs: true, noEmit: true },
        include: ["src/a.ts"],
      }),
      "package.json": '{ "type": "module" }',
      "src/a.ts": [
        '/// <reference path="../types/ref.d.ts" />',
        'import { b } from "./b.js";',
        'import "pkg";',
        'export const a = b + (await import("./later.js")).later;',
      ].join("\n"),
      "src/b.ts": 'export { c as b } from "../lib/c.js";',
      "src/later.ts": "export const later = 1;",
      "lib/c.js": '/** @import { D } from "./d.js" */\nexport const c = 1;',
      "lib/d.ts": "export type D = number;",
      "types/ref.d.ts": "declare const ref: number;",
      "other/x.ts": "export {};",
      "node_modules/pkg/package.json": '{ "name": "pkg", "types": "index.d.ts" }',
      "node_modules/pkg/index.d.ts": 'import "../../other/x.js";',
    });
    expect(ts).not.toBeNull();
    if (ts === null) return;
    const reader = new ProgramReader(ts, root);
    const { files } = reader.read([join(root, "tsconfig.json")]);
    expect(files).toEqual([
      "lib/c.js",
      "lib/d.ts",
      "src/a.ts",
      "src/b.ts",
      "src/later.ts",
      "types/ref.d.ts",
    ]);
    // A package's own imports are the install's (D5's packages), not followed.
    expect(files).toEqual(typeScriptsOwn(root).filter((p) => p !== "other/x.ts"));

    // A file's edit is read again; the others are kept by their stat.
    writeFileSync(join(root, "src/b.ts"), 'export const b = 1;\nimport "../other/x.js";');
    expect(reader.read([join(root, "tsconfig.json")]).files).toEqual(typeScriptsOwn(root));
  });
});

/** The project files of TypeScript's own program of `root`'s tsconfig, its packages left out. */
function typeScriptsOwn(root: string): string[] {
  const own = createRequire(join(REPO, "test/fixtures/lint/toolchain/package.json"))(
    "typescript",
  ) as {
    sys: object;
    getParsedCommandLineOfConfigFile(
      path: string,
      options: object,
      host: object,
    ): { fileNames: string[]; options: object };
    createProgram(
      files: string[],
      options: object,
    ): {
      getSourceFiles(): { fileName: string }[];
    };
  };
  const parsed = own.getParsedCommandLineOfConfigFile(
    join(root, "tsconfig.json"),
    {},
    {
      ...own.sys,
      onUnRecoverableConfigFileDiagnostic: () => {},
    },
  );
  return own
    .createProgram(parsed.fileNames, parsed.options)
    .getSourceFiles()
    .map((f) => relative(root, f.fileName))
    .filter((p) => !p.startsWith("..") && !p.includes("node_modules"))
    .sort();
}

describe("the worker's script (spec 017 D3)", () => {
  it("bundles no package: the project's ESLint and plugins load at run time", () => {
    const built = buildSync({
      entryPoints: [join(REPO, "src/core/lint/provider/worker.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
      metafile: true,
    });
    const inputs = Object.keys(built.metafile.inputs);
    expect(inputs.filter((path) => !path.startsWith("src/core/"))).toEqual([]);
  });

  it("is found beside the bundled CLI or tsc's build, and not beside the sources", () => {
    const dir = tree({ "lint-worker.mjs": "", "provider/worker.js": "" });
    expect(lintWorkerScript(pathToFileURL(join(dir, "squeal.mjs")))).toBe(
      join(dir, "lint-worker.mjs"),
    );
    expect(lintWorkerScript(pathToFileURL(join(dir, "provider/script.js")))).toBe(
      join(dir, "provider/worker.js"),
    );
    expect(
      lintWorkerScript(pathToFileURL(join(REPO, "src/core/lint/provider/script.ts"))),
    ).toBeNull();
  });
});
