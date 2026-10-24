/*
 * THROWAWAY probe for research 016-10. One pack per runner: where each
 * abstract module lives, its text in the runner's language, the files the
 * project needs, and how the adapter opens. This is all a runner writes to
 * join the kit; `kit.ts` holds no runner name.
 */
import { symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  ObservedPaths,
  RunnerAdapter,
  RunReport,
  TestFileRef,
} from "../../../../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../../../../src/runners/node-test/adapter.js";
import { createPytestAdapter } from "../../../../../../src/runners/pytest/adapter.js";
import { createVitestAdapter } from "../../../../../../src/runners/vitest/index.js";
import type { Module } from "./scenarios.js";

const REPO = resolve(import.meta.dirname, "../../../../../..");
const PROJECT = "kit";

export interface Opened {
  readonly adapter: RunnerAdapter;
  /** The paths a run observed for `testFile` beyond its closure, wherever this runner keeps them. */
  readonly observed: (report: RunReport, testFile: TestFileRef) => readonly string[];
}

export interface Pack {
  readonly name: string;
  readonly path: (name: string, module: Module) => string;
  readonly text: (module: Module) => string;
  /** The check's full name as this runner reports it. */
  readonly fullName: (check: string) => string;
  readonly project: Readonly<Record<string, string>>;
  readonly open: (root: string, scratch: string) => Promise<Opened>;
  /** Scenarios this runner is documented not to meet, with the spec line that says so. */
  readonly known?: Readonly<Record<string, string>>;
}

const isTest = (m: Module) => m.kind === "test" || m.kind === "computed" || m.kind === "broken";

/** An in-memory stand-in for the daemon's observed meta keys (node:test and pytest only). */
function memory() {
  const value: Record<string, string[]> = {};
  const extra: string[] = [];
  const merge = (additions: ObservedPaths) => {
    for (const [file, paths] of Object.entries(additions)) {
      value[file] = [...new Set([...(value[file] ?? []), ...paths])].sort();
    }
  };
  return { value, extra, merge };
}

export const vitest: Pack = {
  name: "vitest",
  path: (name, m) => (isTest(m) ? `test/${name}.test.ts` : `src/${name}.ts`),
  text: (m) => {
    switch (m.kind) {
      case "value":
        return `export const value = ${m.value};\n`;
      case "reexport":
        return `export { value } from "./${m.from}";\n`;
      case "test":
        return [
          `import { expect, it } from "vitest";`,
          `import { value } from "../src/${m.from}";`,
          `it(${JSON.stringify(m.check)}, () => expect(value).toBe(${m.expect}));`,
          "",
        ].join("\n");
      case "computed":
        return [
          `import { expect, it } from "vitest";`,
          `it(${JSON.stringify(m.check)}, async () => {`,
          `  const { value } = await import(/* @vite-ignore */ ["..", "src", "${m.from}.ts"].join("/"));`,
          `  expect(value).toBe(${m.expect});`,
          `});`,
          "",
        ].join("\n");
      case "broken":
        return [
          `import { it } from "vitest";`,
          `import { value } from "../src/${m.missing}";`,
          `it(${JSON.stringify(m.check)}, () => void value);`,
          "",
        ].join("\n");
    }
  },
  fullName: (check) => check,
  known: {
    "computed-import":
      "011 C12, observed runtime inputs: not seen, left to `inputs`: a computed `import()` Vite loads",
  },
  project: {
    "package.json": '{ "name": "kit", "private": true, "type": "module" }\n',
    "vitest.config.ts": 'export default { test: { include: ["test/**/*.test.ts"] } };\n',
  },
  open: async (root) => {
    symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
    const adapter = await createVitestAdapter({ root, observe: () => true });
    return {
      adapter,
      observed: (report, file) =>
        (report.observed ?? []).filter((o) => o.testFile.path === file.path).flatMap((o) => o.paths),
    };
  },
};

export const nodeTest: Pack = {
  name: "node-test",
  path: (name, m) => (isTest(m) ? `test/${name}.test.mjs` : `src/${name}.mjs`),
  text: (m) => {
    switch (m.kind) {
      case "value":
        return `export const value = ${m.value};\n`;
      case "reexport":
        return `export { value } from "./${m.from}.mjs";\n`;
      case "test":
        return [
          `import assert from "node:assert/strict";`,
          `import { test } from "node:test";`,
          `import { value } from "../src/${m.from}.mjs";`,
          `test(${JSON.stringify(m.check)}, () => assert.equal(value, ${m.expect}));`,
          "",
        ].join("\n");
      case "computed":
        return [
          `import assert from "node:assert/strict";`,
          `import { test } from "node:test";`,
          `test(${JSON.stringify(m.check)}, async () => {`,
          `  const { value } = await import(["..", "src", "${m.from}.mjs"].join("/"));`,
          `  assert.equal(value, ${m.expect});`,
          `});`,
          "",
        ].join("\n");
      case "broken":
        return [
          `import { test } from "node:test";`,
          `import { value } from "../src/${m.missing}.mjs";`,
          `test(${JSON.stringify(m.check)}, () => void value);`,
          "",
        ].join("\n");
    }
  },
  fullName: (check) => check,
  project: { "package.json": '{ "name": "kit", "private": true, "type": "module" }\n' },
  open: async (root, scratch) => {
    const store = memory();
    const adapter = await createNodeTestAdapter(
      { name: PROJECT, node: process.execPath, argv: [], env: {}, include: ["test/*.test.mjs"] },
      {
        root,
        tempDir: join(scratch, "tmp"),
        observed: {
          read: () => store.value,
          write: store.merge,
          readPreloads: () => store.extra,
          writePreloads: (paths) => void store.extra.push(...paths),
        },
      },
    );
    // node:test keeps observed paths in the daemon's store, not in the report.
    return { adapter, observed: (_, file) => store.value[file.path] ?? [] };
  },
};

export const pytest: Pack = {
  name: "pytest",
  path: (name, m) => (isTest(m) ? `tests/test_${name}.py` : `app/${name}.py`),
  text: (m) => {
    switch (m.kind) {
      case "value":
        return `value = ${m.value}\n`;
      case "reexport":
        return `from app.${m.from} import value\n`;
      case "test":
        return [`from app.${m.from} import value`, "", "", `def test_${m.check}():`, `    assert value == ${m.expect}`, ""].join("\n");
      case "computed":
        return [
          "import importlib",
          "",
          "",
          `def test_${m.check}():`,
          `    module = importlib.import_module(".".join(["app", "${m.from}"]))`,
          `    assert module.value == ${m.expect}`,
          "",
        ].join("\n");
      case "broken":
        return [`from app.${m.missing} import value`, "", "", `def test_${m.check}():`, "    assert value", ""].join("\n");
    }
  },
  fullName: (check) => `test_${check}`,
  project: {
    "pyproject.toml": '[tool.pytest.ini_options]\npythonpath = ["."]\n',
    "app/__init__.py": "",
  },
  open: async (root, scratch) => {
    const store = memory();
    const python = process.env.RUNNER_KIT_PYTHON;
    if (python === undefined) throw new Error("RUNNER_KIT_PYTHON names no environment");
    const adapter = await createPytestAdapter(
      { name: PROJECT, python, args: [], env: {}, include: ["tests/test_*.py"] },
      {
        root,
        tempDir: join(scratch, "tmp"),
        cacheDir: join(scratch, "cache"),
        observed: {
          read: () => store.value,
          write: store.merge,
          readSession: () => store.extra,
          writeSession: (paths) => void store.extra.push(...paths),
        },
      },
    );
    // pytest, like node:test, keeps observed paths in the daemon's store.
    return { adapter, observed: (_, file) => store.value[file.path] ?? [] };
  },
};

export const PACKS: readonly Pack[] = [vitest, nodeTest, pytest];
