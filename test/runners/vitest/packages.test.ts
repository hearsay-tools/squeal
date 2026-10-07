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

const esm = (source: string) => ({ manifest: { type: "module" }, files: { "index.js": source } });

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
  "node_modules/plugin-pkg": {
    version: "1.0.0",
    ...esm('export default function plugin() {\n  return { name: "plugin-pkg" };\n}\n'),
  },
  "node_modules/@types/node": { version: "22.0.0", files: { "index.d.ts": "export {};\n" } },
};

const TEST_FILES = [
  "test/ext.test.ts",
  "test/inl.test.ts",
  "test/plain.test.ts",
  "test/spawn.test.ts",
];

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
    expect(names(environment?.packages)).toEqual([">plugin-pkg", ">setup-pkg", ">vitest"]);
  });

  it("re-keys exactly the test files that use a bumped package", async () => {
    const fx = await open();
    const rekeyed = (location: string, version: string) =>
      rekeyedBy(fx, () => writeInstall(fx.root, bump(location, version)));
    // Restore the install between bumps, so each bump stands alone.
    const restore = () => writeInstall(fx.root, PACKAGES);

    expect(await rekeyed("node_modules/ext-trans", "1.0.1")).toEqual([
      "test/ext.test.ts",
      "test/spawn.test.ts",
    ]);
    restore();
    expect(await rekeyed("node_modules/inl-trans", "1.0.1")).toEqual([
      "test/inl.test.ts",
      "test/spawn.test.ts",
    ]);
    restore();
    expect(await rekeyed("node_modules/setup-pkg", "1.0.1")).toEqual(TEST_FILES);
    restore();
    expect(await rekeyed("node_modules/plugin-pkg", "1.0.1")).toEqual(TEST_FILES);
    restore();
    // Types only: no file Node loads. Only the child-process file, keyed by the whole lockfile, moves.
    expect(await rekeyed("node_modules/@types/node", "24.0.0")).toEqual(["test/spawn.test.ts"]);
  });

  it("re-keys every test file when a package folder appears without the hidden lockfile being rewritten", async () => {
    const fx = await open();
    const rekeyed = await rekeyedBy(fx, () =>
      fx.write("node_modules/sideloaded/package.json", '{"name":"sideloaded","version":"1.0.0"}'),
    );
    expect(rekeyed).toEqual(TEST_FILES);
  });
});
