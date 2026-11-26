import { existsSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import { createJestAdapter } from "../../../src/runners/jest/adapter.js";
import type { Fixture, Pack } from "../driver.js";
import { isTest, type Module, type Written } from "../scenarios/types.js";

/*
 * Jest's pack (spec 016 D1, spec 028 D6): CommonJS modules under `src/`,
 * tests under `test/`, a dependency under `node_modules/`, and the installed
 * Jest (`installJest`) linked in as `node_modules/jest`. A startup hook is a
 * `setupFiles` entry; its variant a `setupFilesAfterEnv` one. Hooks are known
 * at open, so `jest.config.js` is written then, the same text in every
 * worktree. Runs observe (`observe-runtime.cjs`, `recorder.cjs`), and the
 * core keeps what they saw (spec 016 D4).
 */

/** What a startup hook shares with every test. */
const SHARED = "globalThis.kitValue";
/** Longer than a held check waits, so only the cut ends it. */
const HELD_TIMEOUT_MS = 700_000;

function test(module: Extract<Written, { kind: "test" }>, of: (name: string) => Module): string {
  const from = of(module.from);
  const check = `test(${JSON.stringify(module.check)}, () => expect(`;
  if (from.kind === "hook") return `${check}${SHARED}).toBe(${module.expect}));\n`;
  const specifier = from.kind === "dependency" ? module.from : `../src/${module.from}.js`;
  return [
    `const { value } = require(${JSON.stringify(specifier)});`,
    `${check}value).toBe(${module.expect}));`,
    "",
  ].join("\n");
}

function text(module: Written, of: (name: string) => Module): string {
  switch (module.kind) {
    case "value":
      return `module.exports = { value: ${module.value} };\n`;
    case "reexport":
      return `const { value } = require("./${module.from}.js");\nmodule.exports = { value };\n`;
    case "test":
      return test(module, of);
    case "computed":
      return [
        `test(${JSON.stringify(module.check)}, () => {`,
        `  const { value } = require(["..", "src", "${module.from}.js"].join("/"));`,
        `  expect(value).toBe(${module.expect});`,
        `});`,
        "",
      ].join("\n");
    case "hook":
      return `${SHARED} = require(["./${module.from}", "js"].join(".")).value;\n`;
    case "dependency":
      return `exports.value = ${module.value};\n`;
    case "held":
      return [
        `const fs = require("fs");`,
        `const path = require("path");`,
        `test(${JSON.stringify(module.check)}, () => {});`,
        `test(${JSON.stringify(module.holds)}, async () => {`,
        `  fs.writeFileSync(path.join(__dirname, "..", "${module.holds}.started"), "");`,
        `  await new Promise((done) => setTimeout(done, 600_000));`,
        `}, ${HELD_TIMEOUT_MS});`,
        "",
      ].join("\n");
    case "child":
      return `const { value } = require("./${module.from}.js");\nconsole.log(value);\n`;
    case "spawns":
      return [
        `const { execFileSync } = require("child_process");`,
        `const path = require("path");`,
        `test(${JSON.stringify(module.check)}, () => {`,
        `  const child = path.join(__dirname, "..", "src", "${module.child}.js");`,
        `  const printed = execFileSync(process.execPath, [child], { encoding: "utf8" });`,
        `  expect(Number(printed)).toBe(${module.expect});`,
        `});`,
        "",
      ].join("\n");
    case "broken":
      return "module.exports = { value: ;\n";
  }
}

function path(name: string, module: Module): string {
  if (isTest(module)) return `test/${name}.test.js`;
  return module.kind === "dependency" ? `node_modules/${name}/index.js` : `src/${name}.js`;
}

/** The config with each hook under `key`. */
function config(hooks: readonly string[], key: "setupFiles" | "setupFilesAfterEnv"): string {
  return [
    "module.exports = {",
    `  testEnvironment: "node",`,
    `  testMatch: ["<rootDir>/test/**/*.test.js"],`,
    `  ${key}: ${JSON.stringify(hooks.map((hook) => `<rootDir>/${hook}`))},`,
    "};",
    "",
  ].join("\n");
}

/**
 * Jest's pack over the installed fixture `jest` returns, the root of an
 * `installJest` copy, read at the first open only.
 */
export function jestPack(major: number, jest: () => string): Pack {
  const opener =
    (key: "setupFiles" | "setupFilesAfterEnv") =>
    (root: AbsolutePath, scratch: AbsolutePath, { hooks }: Fixture) => {
      writeFileSync(join(root, "jest.config.js"), config(hooks, key));
      const link = join(root, "node_modules", "jest");
      if (!existsSync(link)) {
        mkdirSync(join(root, "node_modules"), { recursive: true });
        symlinkSync(realpathSync(join(jest(), "node_modules", "jest")), link);
      }
      return createJestAdapter(
        { name: "kit", config: "jest.config.js", include: [], exclude: [], args: [], env: {} },
        { root, cacheDir: join(scratch, "jest-cache") as AbsolutePath },
      );
    };
  const base: Pack = {
    name: `jest ${major}`,
    path,
    text,
    beside: (name, module) =>
      module.kind === "dependency"
        ? {
            [`node_modules/${name}/package.json`]: `{ "name": "${name}", "version": "${module.value}.0.0" }\n`,
          }
        : {},
    fullName: (check) => check,
    project: { "package.json": '{ "name": "kit", "private": true }\n' },
    open: opener("setupFiles"),
  };
  return {
    ...base,
    variants: [
      {
        name: "setupFilesAfterEnv",
        scenarios: ["K5"],
        pack: {
          ...base,
          name: `jest ${major} setupFilesAfterEnv`,
          open: opener("setupFilesAfterEnv"),
        },
      },
    ],
  };
}
