import type { Case } from "../case.js";

/*
 * Spec 028 D1 (row 028-05): the loader reads `jest`. A good entry keys
 * nothing beyond its own project, and an entry this tree refuses (a bad
 * field, a config file Jest does not read, a name another runner's project
 * holds, an undeclared container) is skipped, as the last release skips the
 * unknown `jest` key: the keys of the other projects equal the last release's.
 */

const JEST: readonly unknown[] = [
  { name: "web", config: "web/jest.config.ts", cwd: "web", include: ["src/**/*.test.ts"] },
  {
    name: "full",
    config: "full/package.json",
    exclude: ["e2e/**"],
    args: ["--silent"],
    env: { TZ: "UTC" },
    slow: true,
    batchSize: 3,
    container: "box",
  },
  { name: "api", config: "api/jest.config.js" },
  { name: "text", config: "notes.txt" },
  { name: "zero", config: "z/jest.config.js", batchSize: 0 },
  { name: "away", config: "y/jest.config.js", container: "missing" },
  { config: "x/jest.config.js" },
  "web",
];

export const JEST_POLICY: readonly Case[] = [
  {
    kind: "assemble",
    name: "a repository whose policy lists jest projects, some this tree refuses",
    why: "028 D1: the loader keeps good jest entries and skips each bad one, each repeated name and each whose name a pytest project holds, as the last release skips the unknown jest key, so the keys equal the last release's",
    input: {
      files: {
        "squeal.config.json": `${JSON.stringify({
          containers: { box: { image: "sb/box" } },
          pytest: [{ name: "api", include: ["t/*.py"] }],
          jest: JEST,
        })}\n`,
        "src/app.ts": "export const app = 1;\n",
        "test/app.test.ts": "import '../src/app';\n",
      },
      closures: [{ path: "test/app.test.ts", imports: ["src/app.ts"] }],
    },
  },
];
