import { describe, expect, it } from "vitest";
import { dependencyKeys, installedDependencies } from "../../../src/core/keys/index.js";
import type { RunnerPackages } from "../../../src/core/types/index.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { type FixturePackage, writeInstall } from "../../keys/install.js";
import { type FixtureProject, openFixture, ref, SLOW } from "./helpers.js";

// Task 001-105, the fixture half of the board row's done-when: bumping a declared dependency of an
// externalized package, an inlined package's dependency, a setup file's package and a config plugin
// each re-keys exactly the test files that use them; bumping @types/node re-keys none of them; a
// package folder added without rewriting the hidden lockfile re-keys every file. `spawn.test.ts`
// runs a child process, so it keeps the whole-lockfile fingerprint and re-keys on every bump.
// Task 001-109 (review wave-11b B1 to B3), each a bump that kept its key before: a package the config
// names by string (`environment`, `snapshotSerializers`) re-keys every file, one a docblock names
// its file; a bare `require` keys its package; `require.resolve` and a package that spawns send
// their files to the whole fingerprint.

const esm = (source: string) => ({ manifest: { type: "module" }, files: { "index.js": source } });
const environment = (name: string) =>
  esm(
    `export default { name: "${name}", viteEnvironment: "ssr", setup() {\n` +
      `  globalThis.environmentName = "${name}-1";\n  return { teardown() {} };\n} };\n`,
  );

const PACKAGES: Readonly<Record<string, FixturePackage>> = {
  "node_modules/ext": {
    version: "1.0.0",
    dependencies: { "ext-trans": "^1", "@types/node": "*" },
    ...esm(
      'import { transValue } from "ext-trans";\nexport const extValue = "ext+" + transValue;\n',
    ),
  },
  "node_modules/ext-trans": { version: "1.0.0", ...esm('export const transValue = "trans-1";\n') },
  "node_modules/inl": {
    version: "1.0.0",
    dependencies: { "inl-trans": "^1" },
    ...esm('import { inlTrans } from "inl-trans";\nexport const inlValue = "inl+" + inlTrans;\n'),
  },
  "node_modules/inl-trans": {
    version: "1.0.0",
    ...esm('export const inlTrans = "inl-trans-1";\n'),
  },
  "node_modules/setup-pkg": { version: "1.0.0", ...esm('export const setupValue = "setup-1";\n') },
  // Reaches `child_process`, as plugins do; a config plugin drives the run and no test imports it
  // (001-109), so the environment keeps its scoped hash.
  "node_modules/plugin-pkg": {
    version: "1.0.0",
    ...esm(
      'import "node:child_process";\n' +
        'export default function plugin() {\n  return { name: "plugin-pkg" };\n}\n',
    ),
  },
  "node_modules/@types/node": { version: "22.0.0", files: { "index.d.ts": "export {};\n" } },
  "node_modules/vitest-environment-custom": { version: "1.0.0", ...environment("custom") },
  "node_modules/vitest-environment-docblock": { version: "1.0.0", ...environment("docblock") },
  "node_modules/ser-pkg": {
    version: "1.0.0",
    files: { "index.js": "module.exports = { test: () => false, serialize: () => '' };\n" },
  },
  "node_modules/cjs-pkg": {
    version: "1.0.0",
    files: { "index.js": 'exports.cjsValue = "cjs-1";\n' },
  },
  "node_modules/data-pkg": { version: "1.0.0", files: { "data.json": '"data-1"\n' } },
  "node_modules/spawner": {
    version: "1.0.0",
    ...esm(
      'import { execFileSync } from "node:child_process";\n' +
        "const script = \"process.stdout.write(require('child-pkg'))\";\n" +
        "export const spawned = () => execFileSync(process.execPath, ['-e', script]).toString();\n",
    ),
  },
  "node_modules/child-pkg": {
    version: "1.0.0",
    files: { "index.js": 'module.exports = "child-1";\n' },
  },
};

const TEST_FILES = [
  "test/docblock.test.ts",
  "test/ext.test.ts",
  "test/inl.test.ts",
  "test/plain.test.ts",
  "test/require.test.ts",
  "test/resolve.test.ts",
  "test/spawn.test.ts",
  "test/spawner.test.ts",
];

/** Files keyed by the whole fingerprint: a child process, `require.resolve`, a package that spawns. */
const WHOLE = ["test/resolve.test.ts", "test/spawn.test.ts", "test/spawner.test.ts"];

/** `files` and every whole-fingerprint file, in `TEST_FILES` order, as `rekeyedBy` reports them. */
const plusWhole = (...files: string[]) =>
  TEST_FILES.filter((path) => files.includes(path) || WHOLE.includes(path));

const bump = (location: string, version: string) => ({
  ...PACKAGES,
  [location]: { ...PACKAGES[location], version } as FixturePackage,
});

async function open(): Promise<FixtureProject> {
  return openFixture("packages", {}, async (root) => {
    writeInstall(root, PACKAGES);
    return createVitestAdapter({ root });
  });
}

/** Each test file's key inputs from installed dependencies: the environment's, then its own. */
async function dependencyKeysOf(fx: FixtureProject): Promise<Map<string, string>> {
  const [environment] = await fx.adapter.environment();
  const keys = dependencyKeys(await installedDependencies(fx.root, fx.root), environment?.packages);
  const result = new Map<string, string>();
  for (const path of TEST_FILES) {
    const closure = await fx.adapter.closure(ref(path));
    result.set(path, `${keys.environment}\0${keys.of(closure.packages)}`);
  }
  return result;
}

async function rekeyedBy(fx: FixtureProject, change: () => void): Promise<string[]> {
  const before = await dependencyKeysOf(fx);
  change();
  const after = await dependencyKeysOf(fx);
  return TEST_FILES.filter((path) => before.get(path) !== after.get(path));
}

const names = (packages: RunnerPackages | undefined) =>
  [...new Set(packages?.imports.map((entry) => `${entry.from}>${entry.name}`))].sort();

describe("vitest adapter: per-package dependency keys (001-105)", SLOW, () => {
  it("reports the first-hop packages and builtins of each closure and of the environment", async () => {
    const fx = await open();
    const ext = await fx.adapter.closure(ref("test/ext.test.ts"));
    expect(names(ext.packages)).toEqual([">ext"]);
    const inl = await fx.adapter.closure(ref("test/inl.test.ts"));
    expect(names(inl.packages)).toEqual([">inl"]);
    const spawn = await fx.adapter.closure(ref("test/spawn.test.ts"));
    expect(spawn.packages?.builtins).toContain("child_process");
    const [environment] = await fx.adapter.environment();
    // Vite resolved the setup file's import to `node_modules/setup-pkg`, looked up from the root.
    expect(names(environment?.packages)).toEqual([
      ">plugin-pkg",
      ">ser-pkg",
      ">setup-pkg",
      ">vitest",
      ">vitest-environment-custom",
    ]);
  });

  it("reports what a closure loads without an import Vite sees (001-109, B1, B2)", async () => {
    const fx = await open();
    const required = await fx.adapter.closure(ref("test/require.test.ts"));
    expect(names(required.packages)).toEqual(["test>cjs-pkg"]);
    expect(required.packages?.builtins).not.toContain("module");
    const resolved = await fx.adapter.closure(ref("test/resolve.test.ts"));
    expect(resolved.packages?.builtins).toContain("module");
    const docblock = await fx.adapter.closure(ref("test/docblock.test.ts"));
    expect(names(docblock.packages)).toEqual([">vitest-environment-docblock"]);
  });

  it("re-keys exactly the test files that use a bumped package", async () => {
    const fx = await open();
    const rekeyed = (location: string, version: string) =>
      rekeyedBy(fx, () => writeInstall(fx.root, bump(location, version)));
    // Restore the install between bumps, so each bump stands alone.
    const restore = () => writeInstall(fx.root, PACKAGES);

    expect(await rekeyed("node_modules/ext-trans", "1.0.1")).toEqual(plusWhole("test/ext.test.ts"));
    restore();
    expect(await rekeyed("node_modules/inl-trans", "1.0.1")).toEqual(plusWhole("test/inl.test.ts"));
    restore();
    expect(await rekeyed("node_modules/setup-pkg", "1.0.1")).toEqual(TEST_FILES);
    restore();
    expect(await rekeyed("node_modules/plugin-pkg", "1.0.1")).toEqual(TEST_FILES);
    restore();
    // Types only: no file Node loads. Only the files keyed by the whole lockfile move.
    expect(await rekeyed("node_modules/@types/node", "24.0.0")).toEqual(WHOLE);
  });

  it("re-keys the users of a package loaded without an import Vite sees (001-109)", async () => {
    const fx = await open();
    const rekeyed = (location: string, version: string) =>
      rekeyedBy(fx, () => writeInstall(fx.root, bump(location, version)));
    const restore = () => writeInstall(fx.root, PACKAGES);

    // B1: named by string in the config, for every file; by a docblock, for its file.
    expect(await rekeyed("node_modules/vitest-environment-custom", "1.0.1")).toEqual(TEST_FILES);
    restore();
    expect(await rekeyed("node_modules/ser-pkg", "1.0.1")).toEqual(TEST_FILES);
    restore();
    expect(await rekeyed("node_modules/vitest-environment-docblock", "1.0.1")).toEqual(
      plusWhole("test/docblock.test.ts"),
    );
    restore();
    // B2: a bare `require` keys its package; `require.resolve` falls back to the whole lockfile.
    expect(await rekeyed("node_modules/cjs-pkg", "1.0.1")).toEqual(
      plusWhole("test/require.test.ts"),
    );
    restore();
    expect(await rekeyed("node_modules/data-pkg", "1.0.1")).toEqual(WHOLE);
    restore();
    // B3: `spawner` reaches `child_process`, so its importer keys by the whole lockfile.
    expect(await rekeyed("node_modules/child-pkg", "1.0.1")).toEqual(WHOLE);
  });

  it("re-keys every test file when a package folder appears without the hidden lockfile being rewritten", async () => {
    const fx = await open();
    const rekeyed = await rekeyedBy(fx, () =>
      fx.write("node_modules/sideloaded/package.json", '{"name":"sideloaded","version":"1.0.0"}'),
    );
    expect(rekeyed).toEqual(TEST_FILES);
  });
});
