import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dependencyKeys, installedDependencies } from "../../../src/core/keys/index.js";
import type { NodeTestProject, RunnerPackages } from "../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";
import { type FixturePackage, writeInstall } from "../../keys/install.js";

// Review wave-3 B1 and B2 (task 003-33): every probe of the review, as a live node:test file. An
// install bump of `ext` from value 1 to value 2 makes `node --test` fail the file; the file's key
// must change with it, either through `ext` in its packages or through the whole fingerprint
// (`module` among its builtins, or the environment's). Each probe runs before and after the bump.

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-node-test-resolved-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const SLOW = { timeout: 60_000 } as const;

const ext = (value: number): FixturePackage => ({
  version: `${value}.0.0`,
  manifest: { type: "module", main: "index.js" },
  files: {
    "index.js": `export const value = ${value};\n`,
    "data.json": `{ "value": ${value} }\n`,
    "value.cjs": `module.exports = { value: ${value} };\n`,
  },
});

const TEST_HEAD = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\n';
const asserts = (expr: string) => `${TEST_HEAD}test("value", () => assert.equal(${expr}, 1));\n`;
const loads = (code: string) => asserts("value").replace("test(", `${code}\ntest(`);
const SETUP = "scripts/setup.mjs";

interface Probe {
  /** The test file's source; it is `test/a.test.mjs`. */
  readonly test: string;
  readonly files?: Readonly<Record<string, string>>;
  readonly imports?: Readonly<Record<string, string>>;
  readonly argv?: readonly string[];
  readonly nodeOptions?: string;
  /** Where the key must notice `ext`: its packages, `module` in the file's, or the environment's. */
  readonly through: "package" | "file-module" | "environment-module";
}

const PROBES: Readonly<Record<string, Probe>> = {
  "a # alias": {
    test: loads('import { value } from "#ext";'),
    imports: { "#ext": "ext" },
    through: "package",
  },
  "a relative JS import into node_modules": {
    test: loads('import { value } from "../node_modules/ext/index.js";'),
    through: "package",
  },
  "an aliased JSON import": {
    test: asserts("data.value").replace(
      "test(",
      'import data from "#data" with { type: "json" };\ntest(',
    ),
    imports: { "#data": "ext/data.json" },
    through: "package",
  },
  "a relative JSON import into node_modules": {
    test: asserts("data.value").replace(
      "test(",
      'import data from "../node_modules/ext/data.json" with { type: "json" };\ntest(',
    ),
    through: "package",
  },
  "an argv preload through a # alias": {
    test: asserts("globalThis.extValue"),
    files: { [SETUP]: 'import { value } from "#ext";\nglobalThis.extValue = value;\n' },
    imports: { "#ext": "ext" },
    argv: ["--import", `./${SETUP}`],
    through: "package",
  },
  "a NODE_OPTIONS preload through a # alias": {
    test: asserts("globalThis.extValue"),
    files: { [SETUP]: 'import { value } from "#ext";\nglobalThis.extValue = value;\n' },
    imports: { "#ext": "ext" },
    nodeOptions: `--import ./${SETUP}`,
    through: "package",
  },
  "an unexpandable template import": {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the test file's own template literal.
    test: loads("const leaf = 'index';\nconst { value } = await import(`ext/${leaf}.js`);"),
    through: "file-module",
  },
  "a template import globbing into node_modules": {
    test: loads(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the test file's own template literal.
      "const leaf = 'index';\nconst { value } = await import(`../node_modules/ext/${leaf}.js`);",
    ),
    through: "package",
  },
  "createRequire through process.getBuiltinModule": {
    test: loads(
      "const r = process.getBuiltinModule('module').createRequire(import.meta.url);\nconst { value } = r('ext/value.cjs');",
    ),
    through: "file-module",
  },
  "createRequire in a preload": {
    test: asserts("globalThis.extValue"),
    files: {
      [SETUP]:
        "const r = process.getBuiltinModule('module').createRequire(import.meta.url);\nglobalThis.extValue = r('ext/value.cjs').value;\n",
    },
    argv: ["--import", `./${SETUP}`],
    through: "environment-module",
  },
};

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

async function open(probe: Probe) {
  const root = join(scratch, randomUUID());
  const manifest = { name: "app", type: "module", imports: probe.imports };
  write(root, "package.json", `${JSON.stringify(manifest)}\n`);
  write(root, "test/a.test.mjs", probe.test);
  for (const [path, text] of Object.entries(probe.files ?? {})) write(root, path, text);
  writeInstall(root, { "node_modules/ext": ext(1) });
  const project: NodeTestProject = {
    name: "p",
    node: process.execPath,
    argv: probe.argv ?? [],
    env: { NODE_OPTIONS: probe.nodeOptions ?? "" },
    include: ["test/*.test.mjs"],
  };
  const adapter = await createNodeTestAdapter(project, { root, tempDir: scratch });
  const ref = { project: "p", path: "test/a.test.mjs" };
  const packages = async () => ({
    file: (await adapter.closure(ref)).packages,
    environment: (await adapter.environment())[0]?.packages,
  });
  const key = async () => {
    const { file, environment } = await packages();
    const keys = dependencyKeys(await installedDependencies(root, root), environment);
    return `${keys.environment}\0${keys.of(file)}`;
  };
  const outcome = async () => {
    const report = await adapter.run([ref], {
      runId: "r",
      logDir: join(root, ".logs", randomUUID()),
      timeoutMs: 30_000,
    });
    return report.results.map((r) => r.outcome).join();
  };
  return { root, packages, key, outcome };
}

const hasExt = (packages: RunnerPackages | undefined) =>
  packages?.imports.some((entry) => entry.name === "ext" && entry.from === "") ?? false;

describe("node-test: installed packages reached by any load re-key the file (003-33)", () => {
  it.each(Object.entries(PROBES))("%s", SLOW, async (_name, probe) => {
    const fx = await open(probe);
    const { file, environment } = await fx.packages();
    if (probe.through === "package") expect(hasExt(file) || hasExt(environment)).toBe(true);
    if (probe.through === "file-module") expect(file?.builtins).toContain("module");
    if (probe.through === "environment-module") expect(environment?.builtins).toContain("module");
    const before = { key: await fx.key(), outcome: await fx.outcome() };
    writeInstall(fx.root, { "node_modules/ext": ext(2) });
    const after = { key: await fx.key(), outcome: await fx.outcome() };
    expect({
      rekeyed: before.key !== after.key,
      before: before.outcome,
      after: after.outcome,
    }).toEqual({ rekeyed: true, before: "pass", after: "fail" });
  });
});
