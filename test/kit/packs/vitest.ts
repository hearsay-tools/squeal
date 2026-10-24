import { symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import type { Pack } from "../driver.js";
import { isTest, type Module } from "../scenarios/index.js";

const REPO = resolve(import.meta.dirname, "../../..");

/** Vitest's pack (spec 016 D1): TypeScript modules under `src/`, tests under `test/`. */
export const vitest: Pack = {
  name: "vitest",
  path: (name, module) => (isTest(module) ? `test/${name}.test.ts` : `src/${name}.ts`),
  text: (module: Module) => {
    switch (module.kind) {
      case "value":
        return `export const value = ${module.value};\n`;
      case "reexport":
        return `export { value } from "./${module.from}";\n`;
      case "test":
        return [
          `import { expect, it } from "vitest";`,
          `import { value } from "../src/${module.from}";`,
          `it(${JSON.stringify(module.check)}, () => expect(value).toBe(${module.expect}));`,
          "",
        ].join("\n");
      case "broken":
        return "export const value = ;\n";
    }
  },
  fullName: (check) => check,
  project: {
    "package.json": '{ "name": "kit", "private": true, "type": "module" }\n',
    "vitest.config.ts": 'export default { test: { include: ["test/**/*.test.ts"] } };\n',
  },
  open: (root) => {
    // `vitest/node` resolves from the fixture root: the repository's own Vitest.
    symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
    return createVitestAdapter({ root, observe: () => true });
  },
};
