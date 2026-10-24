import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";
import type { Pack } from "../driver.js";
import { isTest, type Module } from "../scenarios/index.js";

/** node:test's pack (spec 016 D1): ES modules under `src/`, tests under `test/`. */
export const nodeTest: Pack = {
  name: "node-test",
  path: (name, module) => (isTest(module) ? `test/${name}.test.mjs` : `src/${name}.mjs`),
  text: (module: Module) => {
    switch (module.kind) {
      case "value":
        return `export const value = ${module.value};\n`;
      case "reexport":
        return `export { value } from "./${module.from}.mjs";\n`;
      case "test":
        return [
          `import assert from "node:assert/strict";`,
          `import { test } from "node:test";`,
          `import { value } from "../src/${module.from}.mjs";`,
          `test(${JSON.stringify(module.check)}, () => assert.equal(value, ${module.expect}));`,
          "",
        ].join("\n");
      case "broken":
        return "export const value = ;\n";
    }
  },
  fullName: (check) => check,
  project: { "package.json": '{ "name": "kit", "private": true, "type": "module" }\n' },
  open: (root) =>
    createNodeTestAdapter(
      { name: "kit", node: process.execPath, argv: [], env: {}, include: ["test/*.test.mjs"] },
      { root },
    ),
};
