import { describe, expect, it } from "vitest";
import {
  closuresToReresolve,
  createInputMatcher,
  ReverseIndex,
  testFileId,
} from "../../../src/core/keys/index.js";
import type { FileChange, TestFileRef } from "../../../src/core/types/index.js";
import { all, type FixtureProject, openFixture, SLOW } from "./helpers.js";

// Scratch survey for 001-72: per scenario, which test files each rule picks and whose closure moved.

type Step =
  | { add: string; content?: string }
  | { remove: string }
  | { edit: string; content: string };

const reads = (specifier: string) =>
  `import { it } from "vitest";\nimport { which } from "${specifier}";\nit("x", () => void which);\n`;

const scenarios: [string, Record<string, string>, Step[]][] = [
  [
    "S1a missing target appears (extension)",
    {
      "src/uses-later.ts": 'export { which } from "./later";\n',
      "test/later.test.ts": reads("../src/uses-later.ts"),
    },
    [{ add: "src/later.ts" }],
  ],
  [
    "S1b missing target appears (index)",
    {
      "src/uses-pkg.ts": 'export { which } from "./pkg";\n',
      "test/pkg.test.ts": reads("../src/uses-pkg.ts"),
    },
    [{ add: "src/pkg/index.ts" }],
  ],
  [
    "S2 resolved target deleted",
    {
      "src/util.ts": "export const which = 1;\n",
      "src/util/index.ts": "export const which = 2;\n",
      "src/uses-util.ts": 'export { which } from "./util";\n',
      "test/util.test.ts": reads("../src/uses-util.ts"),
    },
    [{ remove: "src/util.ts" }],
  ],
  [
    "S3 new file shadows a resolved directory index",
    {
      "src/util/index.ts": "export const which = 2;\n",
      "src/uses-util.ts": 'export { which } from "./util";\n',
      "test/util.test.ts": reads("../src/uses-util.ts"),
    },
    [{ add: "src/util.ts" }],
  ],
  [
    "S4 unrelated add, then delete",
    {},
    [{ add: "src/unrelated.ts" }, { remove: "src/unrelated.ts" }],
  ],
  [
    "S5 import.meta.glob",
    {
      "src/plugins/a.ts": "export const name = 'a';\n",
      "src/registry.ts":
        'const plugins = import.meta.glob("./plugins/*.ts", { eager: true });\nexport const which = Object.keys(plugins).length;\n',
      "test/registry.test.ts": reads("../src/registry.ts"),
    },
    [{ add: "src/plugins/b.ts" }],
  ],
  [
    "S6 template-literal import",
    {
      "src/locales/en.ts": "export const which = 1;\n",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture's own template literal.
      "src/locale.ts": "export const which = (l: string) => import(`./locales/${l}.ts`);\n",
      "test/locale.test.ts": reads("../src/locale.ts"),
    },
    [{ add: "src/locales/fr.ts" }],
  ],
  [
    "S7 new file shadows a package.json directory",
    {
      "src/pkg/package.json": '{ "main": "lib.ts" }\n',
      "src/pkg/lib.ts": "export const which = 1;\n",
      "src/uses.ts": 'export { which } from "./pkg";\n',
      "test/pkg.test.ts": reads("../src/uses.ts"),
    },
    [{ add: "src/pkg.ts" }],
  ],
  [
    "S8 new package.json re-points a directory",
    {
      "src/pkg/index.ts": "export const which = 1;\n",
      "src/pkg/lib.ts": "export const which = 2;\n",
      "src/uses.ts": 'export { which } from "./pkg";\n',
      "test/pkg.test.ts": reads("../src/uses.ts"),
    },
    [{ add: "src/pkg/package.json", content: '{ "main": "lib.ts" }\n' }],
  ],
  [
    "S8b package.json deleted: the directory falls back to its index",
    {
      "src/pkg/package.json": '{ "main": "lib.ts" }\n',
      "src/pkg/index.ts": "export const which = 1;\n",
      "src/pkg/lib.ts": "export const which = 2;\n",
      "src/uses.ts": 'export { which } from "./pkg";\n',
      "test/pkg.test.ts": reads("../src/uses.ts"),
    },
    [{ remove: "src/pkg/package.json" }],
  ],
  [
    "S8c package.json main edited",
    {
      "src/pkg/package.json": '{ "main": "lib.ts" }\n',
      "src/pkg/other.ts": "export const which = 1;\n",
      "src/pkg/lib.ts": "export const which = 2;\n",
      "src/uses.ts": 'export { which } from "./pkg";\n',
      "test/pkg.test.ts": reads("../src/uses.ts"),
    },
    [{ edit: "src/pkg/package.json", content: '{ "main": "other.ts" }\n' }],
  ],
  [
    "S9 alias",
    {
      "vitest.config.ts": [
        'import { fileURLToPath } from "node:url";',
        'import { defineConfig } from "vitest/config";',
        'import { include } from "./vitest.shared.ts";',
        'export default defineConfig({ resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } }, test: { include } });',
        "",
      ].join("\n"),
      "src/uses.ts": 'export { which } from "@/later";\n',
      "test/later.test.ts": reads("../src/uses.ts"),
    },
    [{ add: "src/later.ts" }],
  ],
  [
    "S11 package.json main entry appears",
    {
      "src/pkg/package.json": '{ "main": "lib.ts" }\n',
      "src/pkg/index.ts": "export const which = 1;\n",
      "src/uses.ts": 'export { which } from "./pkg";\n',
      "test/pkg.test.ts": reads("../src/uses.ts"),
    },
    [{ add: "src/pkg/lib.ts" }],
  ],
  [
    "R1 .js beside a resolved .ts",
    {
      "src/a.ts": "export const which = 1;\n",
      "src/uses-a.ts": 'export { which } from "./a";\n',
      "test/a.test.ts": reads("../src/uses-a.ts"),
    },
    [{ add: "src/a.js" }, { remove: "src/a.js" }],
  ],
  [
    "R1b .js twin of a .ts imported as ./a.js",
    {
      "src/a.ts": "export const which = 1;\n",
      "src/uses-a.ts": 'export { which } from "./a.js";\n',
      "test/a.test.ts": reads("../src/uses-a.ts"),
    },
    [{ add: "src/a.js" }],
  ],
  [
    "R3 index beside a resolved file",
    {
      "src/bar.ts": "export const which = 1;\n",
      "src/uses-bar.ts": 'export { which } from "./bar";\n',
      "test/bar.test.ts": reads("../src/uses-bar.ts"),
    },
    [{ add: "src/bar/index.ts" }],
  ],
  [
    "R4 root .js beside a resolved .ts",
    { "root.ts": "export const which = 1;\n", "test/root.test.ts": reads("../root") },
    [{ add: "root.js" }],
  ],
];

const ids = (refs: readonly TestFileRef[]) => refs.map((r) => r.path).sort();

async function closures(fx: FixtureProject): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for (const ref of await fx.adapter.testFiles()) {
    result.set(testFileId(ref), [...(await fx.adapter.closure(ref)).paths].sort());
  }
  return result;
}

describe("001-72 survey", SLOW, () => {
  it.each(scenarios)("%s", async (name, files, steps) => {
    const fx = await openFixture("basic", files);
    const listed = await fx.adapter.testFiles();
    await fx.adapter.run(listed, fx.runOptions());
    for (const step of steps) {
      const before = await closures(fx);
      const index = new ReverseIndex();
      for (const ref of listed) index.set(ref, before.get(testFileId(ref)) ?? []);
      const path = "add" in step ? step.add : "edit" in step ? step.edit : step.remove;
      const kind = "add" in step ? "add" : "edit" in step ? "change" : "delete";
      if ("add" in step) fx.write(path, step.content ?? "export const which = 3;\n");
      else if ("edit" in step) fx.write(path, step.content);
      else fx.remove(path);
      const change: FileChange = {
        path,
        oldHash: kind === "add" ? null : "h1",
        newHash: kind === "delete" ? null : "h2",
      };
      await fx.adapter.invalidate([{ path, kind }]);

      const heuristic = ids(closuresToReresolve([change], index, createInputMatcher([])));
      const rekeyed = ids(index.referencing([path]));
      const affected = ids(all(await fx.adapter.affected([path])));
      const after = await closures(fx);
      const moved = [...before.keys()]
        .filter((id) => after.has(id) && after.get(id)?.join() !== before.get(id)?.join())
        .map((id) => listed.find((r) => testFileId(r) === id)?.path as string)
        .sort();
      const covered = new Set([...rekeyed, ...affected]);
      const row = {
        name,
        step: `${kind} ${path}`,
        heuristic,
        rekeyed,
        affected,
        heuristicOnly: heuristic.filter((p) => !covered.has(p)),
        moved,
        movedMissed: moved.filter((p) => !covered.has(p)),
      };
      console.log(`SURVEY ${JSON.stringify(row)}`);
      await fx.adapter.run(await fx.adapter.testFiles(), fx.runOptions());
      expect(row.movedMissed.filter((p) => !heuristic.includes(p))).toEqual([]);
    }
  });
});
