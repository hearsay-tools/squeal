import { describe, expect, it } from "vitest";
import { buildReport } from "../../src/core/reach/report.js";
import { readImportGraph } from "../../src/core/store/import-graph.js";
import { openFixture, ref, SLOW } from "../runners/vitest/helpers.js";
import { fakeCommonDir, open } from "../store/helpers.js";
import { persistGraph } from "../store/persist-graph.js";
import { snapshot, testFile } from "./fixture.js";

/*
 * Review 0.1.415 B3: the config and setup walks' edges travel from a real
 * Vitest adapter through the store to the report, so a setup pair names
 * its chain from the file the runner loads first, and a config import
 * gets the config suggestion. The test file imports neither.
 */

const FILES = {
  "vitest.config.ts": [
    'import { defineConfig } from "vitest/config";',
    'import Reporter from "./src/reporter.ts";',
    "export default defineConfig({",
    '  test: { include: ["test/plain.test.ts"], setupFiles: ["test/setup.ts"], reporters: [new Reporter()] },',
    "});",
    "",
  ].join("\n"),
  "src/reporter.ts": "export default class Reporter {}\n",
  "test/setup.ts": 'import { init } from "../src/env.ts";\n\ninit();\n',
  "src/env.ts":
    "export function init() {\n  (globalThis as { ready?: boolean }).ready = true;\n}\n",
  "test/plain.test.ts":
    'import { expect, it } from "vitest";\n\nit("plain", () => expect(1).toBe(1));\n',
};

describe("setup chains from a real adapter (R1 B3)", SLOW, () => {
  it("records test/setup.ts -> src/env.ts and vitest.config.ts -> src/reporter.ts, and reports them", async () => {
    const fx = await openFixture("basic", FILES);
    const environments = await fx.adapter.environment();
    const closure = await fx.adapter.closure(ref("test/plain.test.ts"));
    const store = open(fakeCommonDir());
    await persistGraph(store, "one", fx.root, { closures: [closure], environments });
    const graph = readImportGraph(store, "one");
    // Read through the test file's key row, at the environment hash it was keyed with (R2).
    const setup = graph.walk(ref("test/plain.test.ts"))?.environment;

    expect(setup?.roots).toEqual(["test/setup.ts", "vitest.config.ts"]);
    expect(setup?.imports.get("test/setup.ts")?.static).toEqual(["src/env.ts"]);
    expect(setup?.imports.get("vitest.config.ts")?.static).toEqual(["src/reporter.ts"]);

    const test = testFile("test/plain.test.ts", [...closure.paths], { seconds: 2 });
    const report = buildReport(snapshot([test], { graph }), {
      paths: null,
      limit: null,
      command: "squeal",
      listed: 1,
    });
    const entry = (file: string) => report.files.find((e) => e.files.includes(file));
    expect(entry("src/env.ts")).toMatchObject({
      files: ["src/env.ts"],
      gateway: { kind: "setup", gateway: "test/setup.ts", chain: ["test/setup.ts", "src/env.ts"] },
      suggestion: { text: "keep the setup's imports leaf-only: test/setup.ts → src/env.ts" },
    });
    expect(entry("src/reporter.ts")).toMatchObject({
      files: ["src/reporter.ts"],
      gateway: {
        kind: "setup",
        gateway: "vitest.config.ts",
        chain: ["vitest.config.ts", "src/reporter.ts"],
      },
      suggestion: {
        text: "vitest.config.ts imports src/reporter.ts: name it by path, or load it only where it is used",
      },
    });
  });

  it("takes a config's edges from the transform, never from quoted text (R2-N1)", async () => {
    const fx = await openFixture("basic", {
      ...FILES,
      "vitest.config.ts": [
        'import { defineConfig } from "vitest/config";',
        'import Reporter from "./config/bridge.js";',
        "const example = 'example: import \"./src/reporter.js\";';",
        'export default defineConfig({ test: { include: ["test/plain.test.ts"], reporters: [new Reporter()], name: example.slice(0, 0) } });',
        "",
      ].join("\n"),
      "config/bridge.ts": 'export { default } from "../src/reporter.js";\n',
    });
    const environments = await fx.adapter.environment();
    const closure = await fx.adapter.closure(ref("test/plain.test.ts"));
    const store = open(fakeCommonDir());
    await persistGraph(store, "one", fx.root, { closures: [closure], environments });
    const graph = readImportGraph(store, "one");
    const setup = graph.walk(ref("test/plain.test.ts"))?.environment;

    expect(setup?.imports.get("vitest.config.ts")?.static).toEqual(["config/bridge.ts"]);
    expect(setup?.imports.get("config/bridge.ts")?.static).toEqual(["src/reporter.ts"]);
    const test = testFile("test/plain.test.ts", [...closure.paths], { seconds: 2 });
    const report = buildReport(snapshot([test], { graph }), {
      paths: null,
      limit: null,
      command: "squeal",
      listed: 1,
    });
    expect(report.files.find((e) => e.files.includes("src/reporter.ts"))?.gateway).toMatchObject({
      kind: "setup",
      gateway: "config/bridge.ts",
      chain: ["vitest.config.ts", "config/bridge.ts", "src/reporter.ts"],
    });
  });
});
