import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Part, PartInspector } from "../../../src/core/ci/parts.js";
import { decodeBundle } from "../../../src/core/store/transfer-bundle.js";
import { ci, committed, scratch } from "../../ci/fixture.js";
import { TS_WORKER } from "../../code/coverage/payloads.js";
import { recordCovered } from "./ci-coverage-kit.js";

/*
 * Review of 0.1.443 B1 (spec 020 D13.4, D19.6; row 020-26ab R1): whenever a
 * coverage provider ran, the project's or Squeal's, `ci export` leaves out
 * every test file that loaded `node:inspector`, also when `ci record`
 * yielded to the project's provider and made no record. Four forms load it
 * inside a test: a literal `import()`, a `require()`, a
 * `process.getBuiltinModule` call, and a helper module reached only through
 * a computed `import()`. A fifth file never loads it and stays exported. A
 * run with no coverage provider at all exports every file, as before.
 */

const SLOW = { timeout: 300_000 } as const;

const typeOfSession = (load: string) =>
  [
    'import { createRequire } from "node:module";',
    'import { expect, it } from "vitest";',
    "const require = createRequire(import.meta.url);",
    `it("loads", async () => expect(typeof (${load}).Session).toBe("function"));`,
    "",
  ].join("\n");

/** The project's coverage: `PROVIDER` `custom` (re-exports the V8 provider, so Squeal yields) or `v8`. */
const FILES: Readonly<Record<string, string>> = {
  "package.json": JSON.stringify({ name: "ci-inspector-fixture", private: true, type: "module" }),
  ".gitignore": "coverage/\nnode_modules/\n",
  "squeal.config.json": `${JSON.stringify({ observe: { runtimeInputs: true } })}\n`,
  "vitest.config.ts": [
    'import { defineConfig } from "vitest/config";',
    "export default defineConfig({",
    "  test: {",
    '    include: ["test/*.test.ts"],',
    "    // test options",
    "    coverage: {",
    '      enabled: process.env.PROJECT_COVERAGE !== "0",',
    '      provider: process.env.PROVIDER === "v8" ? "v8" : "custom",',
    '      customProviderModule: "./custom-v8.mjs",',
    '      reporter: ["json"],',
    "    },",
    "  },",
    "});",
    "",
  ].join("\n"),
  "custom-v8.mjs": 'export { default } from "@vitest/coverage-v8";\n',
  "src/helper.ts": [
    "export async function running(): Promise<string> {",
    '  const { Session } = await import("node:inspector");',
    "  return typeof Session;",
    "}",
    "",
  ].join("\n"),
  "test/literal.test.ts": typeOfSession('await import("node:inspector")'),
  "test/require.test.ts": typeOfSession('require("node:inspector")'),
  "test/builtin.test.ts": typeOfSession('process.getBuiltinModule("node:inspector")'),
  "test/runtime.test.ts": [
    'import { expect, it } from "vitest";',
    'it("runtime", async () => {',
    '  const target = "../src/" + ["help", "er"].join("") + ".ts";',
    "  const { running } = await import(/* @vite-ignore */ target);",
    '  expect(await running()).toBe("function");',
    "});",
    "",
  ].join("\n"),
  "test/plain.test.ts":
    'import { expect, it } from "vitest";\nit("adds", () => expect(1 + 1).toBe(2));\n',
};

/** Every test file of `FILES`, sorted. */
const EVERY = [
  "test/builtin.test.ts",
  "test/literal.test.ts",
  "test/plain.test.ts",
  "test/require.test.ts",
  "test/runtime.test.ts",
];

/**
 * `ci record` in a fresh fixture with `env`, with the sources' records'
 * worker when `worker` and the test `options` in its config, then `ci
 * export` of its part there: the part and the exported files.
 */
async function recordAndExport(name: string, env: NodeJS.ProcessEnv, worker = false, options = "") {
  const config = FILES["vitest.config.ts"] ?? "";
  const fixture = { ...FILES, "vitest.config.ts": config.replace("    // test options", options) };
  const root = committed(scratch(name), fixture);
  const out = join(dirname(root), "parts");
  const deps = worker ? { mapWorker: TS_WORKER } : {};
  const both = { ...process.env, CI: "true", ...env };
  const recorded = await recordCovered(root, out, [], deps, both);
  expect(recorded.code, recorded.said).toBe(0);
  const target = join(dirname(root), "results.json.gz");
  const exported = await ci(["export", "--parts", out, "--out", target], root, both);
  const bundle = existsSync(target) ? decodeBundle(readFileSync(target)) : null;
  if (typeof bundle === "string") throw new Error(bundle);
  const files = (bundle?.testFiles ?? []).map((file) => file.path).sort();
  return { part: recorded.parts[0] as Part, files, code: exported.code, said: exported.said };
}

/** The four files that load the inspector, as a part's `inspector.loaded` names them. */
const LOADED = EVERY.filter((path) => path !== "test/plain.test.ts").map((path) => ({
  project: "",
  path,
}));

/** `noRecord`, or `record`, of each file of `part`. */
const marks = (part: Part) => part.testFiles.map((f) => [f.path, f.noRecord ?? "record"]);

describe("ci export leaves out node:inspector users beside any coverage provider (review 0.1.443 B1)", () => {
  it(
    "yielded to a custom provider: all four forms are seen and left out, the plain file is exported",
    SLOW,
    async () => {
      const run = await recordAndExport("ci-inspector-custom", {});
      expect(run.part.header.coverage).toEqual({
        off: "project-coverage",
        note: expect.stringContaining('provider "custom"'),
        inspector: { loaded: LOADED, unknown: [] },
      });
      expect(run.code, run.said).toBe(0);
      expect(run.files).toEqual(["test/plain.test.ts"]);
      expect(run.said).toContain("Left out: 4 test files that loaded node:inspector");
    },
  );

  it("yielded to the project's V8 provider without a records' worker: the same", SLOW, async () => {
    const run = await recordAndExport("ci-inspector-v8-yield", { PROVIDER: "v8" });
    expect(run.part.header.coverage).toMatchObject({
      off: "project-coverage",
      inspector: { loaded: LOADED, unknown: [] },
    });
    expect(run.code, run.said).toBe(0);
    expect(run.files).toEqual(["test/plain.test.ts"]);
  });

  it(
    "wrapped the project's V8 provider: the four have noRecord inspector, the plain file a record",
    SLOW,
    async () => {
      const run = await recordAndExport("ci-inspector-v8-wrap", { PROVIDER: "v8" }, true);
      expect(run.part.header.coverage).toMatchObject({
        collector: "v8",
        inspector: { loaded: LOADED, unknown: [] },
      });
      expect(marks(run.part)).toEqual(
        EVERY.map((p) => [p, p === "test/plain.test.ts" ? "record" : "inspector"]),
      );
      expect(run.code, run.said).toBe(0);
      expect(run.files).toEqual(["test/plain.test.ts"]);
    },
  );

  it(
    "with Squeal's provider: the same, its own inspector session names no file",
    SLOW,
    async () => {
      const run = await recordAndExport("ci-inspector-squeal", { PROJECT_COVERAGE: "0" }, true);
      expect(run.part.header.coverage).toMatchObject({
        collector: "squeal",
        inspector: { loaded: LOADED, unknown: [] },
      });
      expect(marks(run.part)).toEqual(
        EVERY.map((p) => [p, p === "test/plain.test.ts" ? "record" : "inspector"]),
      );
      expect(run.code, run.said).toBe(0);
      expect(run.files).toEqual(["test/plain.test.ts"]);
    },
  );

  it("in worker threads: the same", SLOW, async () => {
    const run = await recordAndExport("ci-inspector-threads", {}, false, 'pool: "threads",');
    expect(run.part.header.coverage).toMatchObject({ inspector: { loaded: LOADED, unknown: [] } });
    expect(run.code, run.said).toBe(0);
    expect(run.files).toEqual(["test/plain.test.ts"]);
  });

  it("with isolate: false, the four too, though one worker keeps the modules", SLOW, async () => {
    const run = await recordAndExport("ci-inspector-shared", {}, false, "isolate: false,");
    const inspector = (run.part.header.coverage as { inspector?: PartInspector }).inspector;
    expect(inspector?.unknown).toEqual([]);
    expect(inspector?.loaded).toEqual(expect.arrayContaining(LOADED));
    expect(run.code, run.said).toBe(0);
    expect(run.files.filter((path) => path !== "test/plain.test.ts")).toEqual([]);
  });

  it(
    "in a VM pool, where the watch sees no test file: every file is unknown and left out",
    SLOW,
    async () => {
      const run = await recordAndExport("ci-inspector-vm", {}, false, 'pool: "vmThreads",');
      const unknown = EVERY.map((path) => ({ project: "", path }));
      expect(run.part.header.coverage).toMatchObject({ inspector: { loaded: [], unknown } });
      expect(run.code, run.said).toBe(1);
      expect(run.said).toContain("no test file to export; left out: 5 test files");
      expect(run.files).toEqual([]);
    },
  );

  it("with no coverage provider at all: every file is exported, as before", SLOW, async () => {
    const run = await recordAndExport("ci-inspector-none", { PROJECT_COVERAGE: "0" });
    expect(run.part.header.coverage).toEqual({ off: "no-provider", note: expect.any(String) });
    expect(run.code, run.said).toBe(0);
    expect(run.files).toEqual(EVERY);
  });
});
