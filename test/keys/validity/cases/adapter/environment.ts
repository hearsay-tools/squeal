import type { Case } from "../../case.js";

/*
 * Row 011-88 (task 011-85 R2, 011 C3): two file-based projects and the
 * root's config. Each project's environment holds the root's config file and
 * its own, never its sibling's. The files are keys: a release that moves
 * them re-keys, and the case runs the adapter's lines that list them.
 */

const config = (name: string) =>
  `export default { test: { name: "${name}", include: ["*.test.ts"] } };\n`;
const test = (name: string) => `import { it } from "vitest";\nit("${name}", () => {});\n`;

export const VITEST_ENVIRONMENT: readonly Case[] = [
  {
    kind: "adapter:vitest",
    name: "two projects' environment files",
    why: "011-88: a project's environment holds the root's config file and its own, never a sibling's",
    input: {
      environment: true,
      files: {
        "package.json": '{ "name": "validity-projects", "private": true, "type": "module" }\n',
        "vitest.config.ts":
          'export default { test: { projects: ["a/vitest.config.ts", "b/vitest.config.ts"] } };\n',
        "a/vitest.config.ts": config("a"),
        "a/a.test.ts": test("a"),
        "b/vitest.config.ts": config("b"),
        "b/b.test.ts": test("b"),
      },
      runs: [],
    },
  },
];
