import type { NodeTestProject } from "../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";
import type { Fixture, Pack } from "../driver.js";
import { isTest, type Module, type Written } from "../scenarios/index.js";

/*
 * node:test's pack (spec 016 D1): ES modules under `src/`, tests under
 * `test/`, a dependency under `node_modules/`. A startup hook is a preload;
 * its variants are the forms reviews found the recorder missed: a
 * `--require` preload runs before every `--import` (003 wave 2.5 B1), and
 * Node splits `NODE_OPTIONS` at double quotes (003 wave 2.6 B1).
 */

const STARTED = (holds: string) => `new URL("../${holds}.started", import.meta.url)`;
/** What a startup hook shares with every test. */
const SHARED = "globalThis.kitValue";

function test(module: Extract<Written, { kind: "test" }>, of: (name: string) => Module): string {
  const from = of(module.from);
  const check = `test(${JSON.stringify(module.check)}, () => assert.equal(`;
  if (from.kind === "hook") return `${check}${SHARED}, ${module.expect}));`;
  const specifier = from.kind === "dependency" ? module.from : `../src/${module.from}.mjs`;
  return [
    `import { value } from ${JSON.stringify(specifier)};`,
    `${check}value, ${module.expect}));`,
  ].join("\n");
}

function text(module: Written, of: (name: string) => Module): string {
  switch (module.kind) {
    case "value":
      return `export const value = ${module.value};\n`;
    case "reexport":
      return `export { value } from "./${module.from}.mjs";\n`;
    case "test":
      return [
        `import assert from "node:assert/strict";`,
        `import { test } from "node:test";`,
        test(module, of),
        "",
      ].join("\n");
    case "computed":
      return [
        `import assert from "node:assert/strict";`,
        `import { test } from "node:test";`,
        `test(${JSON.stringify(module.check)}, async () => {`,
        `  const { value } = await import(["..", "src", "${module.from}.mjs"].join("/"));`,
        `  assert.equal(value, ${module.expect});`,
        `});`,
        "",
      ].join("\n");
    case "hook":
      return [
        `const { value } = await import(["./${module.from}", "mjs"].join("."));`,
        `${SHARED} = value;`,
        "",
      ].join("\n");
    case "dependency":
      return `exports.value = ${module.value};\n`;
    case "held":
      return [
        `import { writeFileSync } from "node:fs";`,
        `import { test } from "node:test";`,
        `test(${JSON.stringify(module.check)}, () => {});`,
        `test(${JSON.stringify(module.holds)}, async () => {`,
        `  writeFileSync(${STARTED(module.holds)}, "");`,
        `  await new Promise((done) => setTimeout(done, 600_000));`,
        `});`,
        "",
      ].join("\n");
    case "broken":
      return "export const value = ;\n";
  }
}

function path(name: string, module: Module): string {
  if (isTest(module)) return `test/${name}.test.mjs`;
  return module.kind === "dependency" ? `node_modules/${name}/index.js` : `src/${name}.mjs`;
}

const PROJECT: NodeTestProject = {
  name: "kit",
  node: process.execPath,
  argv: [],
  env: {},
  include: ["test/*.test.mjs"],
};

/** Opens with each hook preloaded as `preload` gives its arguments and env. */
const opener =
  (preload: (hook: string) => Pick<NodeTestProject, "argv" | "env">) =>
  (root: string, _scratch: string, { hooks }: Fixture) =>
    createNodeTestAdapter(
      { ...PROJECT, ...(hooks[0] === undefined ? {} : preload(`./${hooks[0]}`)) },
      { root },
    );

const base: Pack = {
  name: "node-test",
  path,
  text,
  fullName: (check) => check,
  project: { "package.json": '{ "name": "kit", "private": true, "type": "module" }\n' },
  open: opener((hook) => ({ argv: ["--import", hook], env: {} })),
};

/** A `--require` preload: CommonJS modules under `src/`, the hook's load a computed `require`. */
const required: Pack = {
  ...base,
  path: (name, module) => (isTest(module) ? path(name, module) : `src/${name}.cjs`),
  text: (module, of) => {
    switch (module.kind) {
      case "value":
        return `module.exports = { value: ${module.value} };\n`;
      case "hook":
        return `${SHARED} = require(["./${module.from}", "cjs"].join(".")).value;\n`;
      default:
        return text(module, of);
    }
  },
};

export const nodeTest: Pack = {
  ...base,
  variants: [
    {
      name: "--require",
      scenarios: ["K5"],
      pack: {
        ...required,
        name: "node-test --require",
        open: opener((hook) => ({ argv: ["--require", hook], env: {} })),
      },
    },
    {
      name: "quoted NODE_OPTIONS",
      scenarios: ["K5"],
      pack: {
        ...required,
        name: "node-test quoted NODE_OPTIONS",
        open: opener((hook) => ({ argv: [], env: { NODE_OPTIONS: `"--require" ${hook}` } })),
      },
    },
  ],
};
