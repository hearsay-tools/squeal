import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunReport, TestFileRef } from "../../../src/core/types/index.js";
import { type FixtureProject, openFixture, paths, ref, SLOW } from "./helpers.js";

/*
 * Task 013-02 (013 V5 Touched files as amended 2026-10-20, design 013-01
 * section 6): a touch counts for an instance only when the instance could
 * have read the path. It then withholds the run's test files whose graph
 * reaches it, and replaces the instance at the next call; any other touch
 * withholds nothing and keeps it. The held files wait inside their test
 * while `hold` exists, so a touch is heard mid-run.
 */

const markerDirs: string[] = [];
afterEach(() => {
  for (const dir of markerDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SLOW1 = ref("test/slow1.test.ts");
const SLOW2 = ref("test/slow2.test.ts");
const SLOW3 = ref("test/slow3.test.ts");

const config = (starts: string, cssHold: string, transforming: string, test: string) =>
  [
    'import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";',
    'import { resolve } from "node:path";',
    'import { setTimeout as delay } from "node:timers/promises";',
    'import { defineConfig } from "vitest/config";',
    "const here = import.meta.dirname;",
    // The markers go before the adapter closes: a start after a failed test finds none.
    `if (existsSync(${JSON.stringify(dirname(starts))})) appendFileSync(${JSON.stringify(starts)}, "x");`,
    "export default defineConfig({",
    "  plugins: [",
    "    {",
    '      name: "touched-scope",',
    "      resolveId(id) {",
    '        if (id === "virtual:which") return "\\0virtual:which";',
    '        if (id === "zero:file") return "\\0" + resolve(here, "src/zero.ts");',
    "      },",
    "      load(id) {",
    '        if (id === "\\0virtual:which") {',
    '          const file = resolve(here, "src/mod.ts");',
    "          this.addWatchFile(file);",
    '          return readFileSync(file, "utf8");',
    "        }",
    '        if (id.startsWith("\\0/")) return readFileSync(id.slice(1), "utf8");',
    "      },",
    "    },",
    "    {",
    '      name: "touched-scope-hold",',
    '      enforce: "pre",',
    "      async transform(_code, id) {",
    `        if (!id.includes("style.css") || !existsSync(${JSON.stringify(cssHold)})) return;`,
    `        writeFileSync(${JSON.stringify(transforming)}, "");`,
    `        while (existsSync(${JSON.stringify(cssHold)})) await delay(20);`,
    "      },",
    "    },",
    "  ],",
    `  test: ${test},`,
    "});",
    "",
  ].join("\n");

const BASIC_TEST = `{ include: ["test/**/*.test.ts"], setupFiles: ["test/setup.ts"], globalSetup: ["test/global-setup.ts"], css: { include: [/.+/] }, testTimeout: 60_000 }`;
// Each with a config file of its own, so a server of its own (review wave-13b B2): inline
// projects share the root's, and so one module graph.
const TWO_PROJECTS = `{ projects: ["a/vitest.config.ts", "b/vitest.config.ts"] }`;
const projectConfig = (name: string) =>
  `export default { test: { name: "${name}", include: ["test/*.test.ts"] } };\n`;

const held = (started: string, hold: string, imports: string, body: string) =>
  [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { setTimeout as delay } from "node:timers/promises";',
    'import { expect, it } from "vitest";',
    imports,
    'it("holds", async () => {',
    `  writeFileSync(${JSON.stringify(started)}, "");`,
    `  while (existsSync(${JSON.stringify(hold)})) await delay(20);`,
    `  ${body}`,
    "}, 120_000);",
    "",
  ].join("\n");

const plain = (imports: string, body: string) =>
  [
    'import { expect, it } from "vitest";',
    imports,
    `it("reads", async () => { ${body} });`,
    "",
  ].join("\n");

interface Scope {
  readonly fx: FixtureProject;
  /** How many instances have loaded the config: one more per start. */
  starts(): number;
  /** Runs `files` with `hold` in place, hears `touched` once one started, then releases it. */
  touchedRun(files: readonly TestFileRef[], touched: readonly string[]): Promise<RunReport>;
  readonly hold: string;
  readonly started: string;
  readonly cssHold: string;
  readonly transforming: string;
}

async function scope(
  test = BASIC_TEST,
  extra: Readonly<Record<string, string>> = {},
): Promise<Scope> {
  const markers = mkdtempSync(join(tmpdir(), "squeal-013-02-"));
  markerDirs.push(markers);
  const at = (name: string) => join(markers, name);
  const [starts, hold, started, cssHold, transforming] = [
    "starts",
    "hold",
    "started",
    "css-hold",
    "transforming",
  ].map(at) as [string, string, string, string, string];
  const fx = await openFixture("basic", {
    "vitest.config.ts": config(starts, cssHold, transforming, test),
    "dist/gen.js": "export const g = 1;\n",
    "dist/unrelated.js": "export const u = 1;\n",
    "src/zero.ts": 'export const zero = "zero";\n',
    "src/dyn.ts": 'export const dyn = "dyn";\n',
    "src/mod.ts": 'export const which = "old";\n',
    "src/style.css": '@import "./base.css";\n.x { color: red; }\n',
    "src/base.css": '.base { content: "old"; }\n',
    [SLOW1.path]: held(started, hold, 'import { g } from "../dist/gen.js";', "expect(g).toBe(1);"),
    [SLOW2.path]: held(started, hold, "", "expect(1).toBe(1);"),
    [SLOW3.path]: held(started, hold, "", "expect(1).toBe(1);"),
    "test/zero.test.ts": plain('import { zero } from "zero:file";', 'expect(zero).toBe("zero");'),
    "test/computed.test.ts": plain(
      "",
      'const { dyn } = await import(/* @vite-ignore */ ["..", "src", "dyn.ts"].join("/")); expect(dyn).toBe("dyn");',
    ),
    "test/virtual.test.ts": plain(
      'import { which } from "virtual:which";',
      'expect(which).toBe("old");',
    ),
    "test/plain.test.ts": plain(
      'import { which } from "../src/mod.ts";',
      'expect(which).toBe("old");',
    ),
    "test/css.test.ts": plain(
      'import style from "../src/style.css?inline";',
      'expect(style).toContain("old");',
    ),
    ...Object.fromEntries(
      Object.entries(extra).map(([path, text]) => [
        path,
        text.replaceAll("$HELD", held(started, hold, "", "expect(1).toBe(1);")),
      ]),
    ),
  });
  return {
    fx,
    starts: () => (existsSync(starts) ? readFileSync(starts, "utf8").length : 0),
    hold,
    started,
    cssHold,
    transforming,
    async touchedRun(files, touched) {
      writeFileSync(hold, "");
      rmSync(started, { force: true });
      const run = fx.adapter.run(files, fx.runOptions());
      await expect.poll(() => existsSync(started), { timeout: 60_000 }).toBe(true);
      await fx.adapter.invalidate(touched.map((path) => ({ path, kind: "touch" as const })));
      rmSync(hold, { force: true });
      return run;
    },
  };
}

const sorted = (refs: readonly TestFileRef[] | undefined) => paths(refs ?? []).sort();

describe(
  "vitest adapter: a touch withholds only what the instance could have read (013-02)",
  SLOW,
  () => {
    it("withholds nothing and keeps the instance for a touch no module names (1)", async () => {
      const s = await scope();
      const report = await s.touchedRun([SLOW1, SLOW2, SLOW3], ["dist/unrelated.js"]);
      expect(report.failure).toBeNull();
      expect(report.withheld).toBeUndefined();
      expect(sorted(report.completedFiles)).toEqual([SLOW1.path, SLOW2.path, SLOW3.path]);
      const starts = s.starts();
      await s.fx.adapter.testFiles();
      expect(s.starts()).toBe(starts);
    });

    it("withholds the files that reach a touched module and replaces the instance (2)", async () => {
      const s = await scope();
      const report = await s.touchedRun(
        [SLOW1, SLOW2, SLOW3],
        ["dist/gen.js", "dist/unrelated.js"],
      );
      expect(sorted(report.withheld)).toEqual([SLOW1.path]);
      expect(sorted(report.completedFiles)).toEqual([SLOW2.path, SLOW3.path]);
      expect(report.failure).toMatch(/dist\/gen\.js was written during this run.*task 001-159/);
      expect(report.failure).not.toContain("dist/unrelated.js");
      const starts = s.starts();
      await s.fx.adapter.testFiles();
      expect(s.starts()).toBe(starts + 1);
    });

    it("finds a module whose \\0 ID names the touched file (3)", async () => {
      const s = await scope();
      const report = await s.touchedRun([SLOW2, ref("test/zero.test.ts")], ["src/zero.ts"]);
      expect(sorted(report.withheld)).toEqual(["test/zero.test.ts"]);
      expect(sorted(report.completedFiles)).toEqual([SLOW2.path]);
    });

    it.each([
      ["a setup file", "test/setup.ts"],
      ["a computed import() target", "src/dyn.ts"],
    ])("withholds every file of the run for %s no test file reaches (4)", async (_, touched) => {
      const s = await scope();
      const computed = ref("test/computed.test.ts");
      const report = await s.touchedRun([SLOW2, SLOW3, computed], [touched]);
      expect(sorted(report.withheld)).toEqual([computed.path, SLOW2.path, SLOW3.path]);
      expect(report.completedFiles).toEqual([]);
    });

    it("withholds none of a project's files for a module only another project loaded (4)", async () => {
      const s = await scope(TWO_PROJECTS, {
        "a/vitest.config.ts": projectConfig("a"),
        "b/vitest.config.ts": projectConfig("b"),
        "src/only-b.ts": "export const b = 1;\n",
        "a/test/held.test.ts": "$HELD",
        "b/test/only.test.ts": plain(
          'import { b } from "../../src/only-b.ts";',
          "expect(b).toBe(1);",
        ),
      });
      const a = ref("a/test/held.test.ts", "a");
      const b = ref("b/test/only.test.ts", "b");
      const report = await s.touchedRun([a, b], ["src/only-b.ts"]);
      expect(report.withheld).toEqual([b]);
      expect(report.completedFiles).toEqual([a]);
    });

    it.each(["vitest.config.ts", "package.json"])(
      "withholds every file for a touched %s and replaces the instance (5)",
      async (touched) => {
        const s = await scope();
        const report = await s.touchedRun([SLOW2, SLOW3], [touched]);
        expect(sorted(report.withheld)).toEqual([SLOW2.path, SLOW3.path]);
        const starts = s.starts();
        await s.fx.adapter.testFiles();
        expect(s.starts()).toBe(starts + 1);
      },
    );

    it("withholds the files reaching a virtual module's input and an @import, not a sibling (6)", async () => {
      const s = await scope();
      const files = ["test/virtual.test.ts", "test/plain.test.ts", "test/css.test.ts"].map((p) =>
        ref(p),
      );
      const report = await s.touchedRun([SLOW2, ...files], ["src/mod.ts", "src/base.css"]);
      expect(sorted(report.withheld)).toEqual(sorted(files));
      expect(report.completedFiles).toEqual([SLOW2]);
    });

    it("counts a touch heard while a runner-part transform was reading the touched @import (7)", async () => {
      const s = await scope();
      writeFileSync(s.cssHold, "");
      const closure = s.fx.adapter.closure(ref("test/css.test.ts"));
      await expect.poll(() => existsSync(s.transforming), { timeout: 60_000 }).toBe(true);
      await s.fx.adapter.invalidate([{ path: "src/base.css", kind: "touch" }]);
      // A call sorting the touch before the transform recorded its read keeps it pending.
      const starts = s.starts();
      const report = await s.fx.adapter.run([SLOW2], s.fx.runOptions());
      expect(report.completedFiles).toEqual([SLOW2]);
      expect(s.starts()).toBe(starts);
      rmSync(s.cssHold, { force: true });
      await closure;
      await s.fx.adapter.testFiles();
      expect(s.starts()).toBe(starts + 1);
    });

    it("answers a runner-part call during the run for a touch no module names, with no recreate (8)", async () => {
      const s = await scope();
      writeFileSync(s.hold, "");
      let ended = false;
      const run = s.fx.adapter.run([SLOW2], s.fx.runOptions());
      void run.finally(() => {
        ended = true;
      });
      await expect.poll(() => existsSync(s.started), { timeout: 60_000 }).toBe(true);
      const starts = s.starts();
      await s.fx.adapter.invalidate([{ path: "dist/unrelated.js", kind: "touch" }]);
      let answered = false;
      const listed = s.fx.adapter.testFiles().then((files) => {
        answered = true;
        return files;
      });
      await expect.poll(() => answered, { timeout: 30_000 }).toBe(true);
      expect(ended).toBe(false);
      expect(await listed).toContainEqual(SLOW2);
      rmSync(s.hold, { force: true });
      expect((await run).completedFiles).toEqual([SLOW2]);
      await s.fx.adapter.testFiles();
      expect(s.starts()).toBe(starts);
    });
  },
);
