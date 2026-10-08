import { cpSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dependencyKeys, installedDependencies } from "../../../src/core/keys/index.js";
import type {
  NodeTestProject,
  RunnerAdapter,
  RunnerPackages,
} from "../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";
import { type FixturePackage, writeInstall } from "../../keys/install.js";

// Task 003-22, the board row's done-when on `test/fixtures/node-test/packages/`: bumping a package
// one node:test file imports, directly or through a project module, re-keys exactly that file;
// bumping tsx or the preload's package re-keys every file; `spawn.test.ts` imports
// `child_process`, so it keeps the whole fingerprint and re-keys on every bump; a file importing
// nothing installed keeps its key across an unrelated install.

const FIXTURE = resolve(import.meta.dirname, "../../fixtures/node-test/packages");
const scratch = mkdtempSync(join(tmpdir(), "squeal-node-test-packages-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const esm = (source: string) => ({ manifest: { type: "module" }, files: { "index.js": source } });

const PACKAGES: Readonly<Record<string, FixturePackage>> = {
  "node_modules/ext": {
    version: "1.0.0",
    dependencies: { "ext-trans": "^1" },
    ...esm(
      'import { transValue } from "ext-trans";\nexport const extValue = "ext+" + transValue;\n',
    ),
  },
  "node_modules/ext-trans": { version: "1.0.0", ...esm('export const transValue = "trans-1";\n') },
  "node_modules/helper-pkg": { version: "1.0.0", ...esm('export const helperPkg = "helper-1";\n') },
  "node_modules/setup-pkg": { version: "1.0.0", ...esm('export const setupValue = "setup-1";\n') },
  // Reaches `module`, as tsx does: it drives the run, so the environment keeps its scoped hash.
  "node_modules/tsx": {
    version: "4.21.0",
    ...esm('import { register } from "node:module";\nexport { register };\n'),
  },
  "node_modules/unrelated": { version: "1.0.0" },
};

const TEST_FILES = [
  "test/ext.test.ts",
  "test/helper.test.ts",
  "test/plain.test.ts",
  "test/spawn.test.ts",
];
const WHOLE = ["test/spawn.test.ts"];
const plusWhole = (...files: string[]) =>
  TEST_FILES.filter((path) => files.includes(path) || WHOLE.includes(path));

const bump = (location: string, version: string) => ({
  ...PACKAGES,
  [location]: { ...PACKAGES[location], version } as FixturePackage,
});

interface Fixture {
  readonly root: string;
  readonly adapter: RunnerAdapter;
}

async function open(): Promise<Fixture> {
  const root = join(scratch, `p${Math.random().toString(36).slice(2)}`);
  cpSync(FIXTURE, root, { recursive: true });
  writeInstall(root, PACKAGES);
  const project: NodeTestProject = {
    name: "p",
    node: process.execPath,
    argv: ["--import", "tsx", "--import", "./scripts/setup.ts"],
    env: { NODE_OPTIONS: "" },
    include: ["test/*.test.ts"],
  };
  return { root: realpathSync(root), adapter: await createNodeTestAdapter(project, { root }) };
}

const ref = (path: string) => ({ project: "p", path });

/** Each test file's key inputs from installed dependencies: the environment's, then its own. */
async function dependencyKeysOf(fx: Fixture): Promise<Map<string, string>> {
  const [environment] = await fx.adapter.environment();
  const keys = dependencyKeys(await installedDependencies(fx.root, fx.root), environment?.packages);
  const result = new Map<string, string>();
  for (const path of TEST_FILES) {
    const closure = await fx.adapter.closure(ref(path));
    result.set(path, `${keys.environment}\0${keys.of(closure.packages)}`);
  }
  return result;
}

async function rekeyedBy(fx: Fixture, change: () => void): Promise<string[]> {
  const before = await dependencyKeysOf(fx);
  change();
  const after = await dependencyKeysOf(fx);
  return TEST_FILES.filter((path) => before.get(path) !== after.get(path));
}

const names = (packages: readonly { from: string; name: string }[] | undefined) =>
  [...new Set(packages?.map((entry) => `${entry.from}>${entry.name}`))].sort();
const imports = (packages: RunnerPackages | undefined) => names(packages?.imports);

describe("node-test adapter: per-package dependency keys (003-22)", () => {
  it("reports the first-hop packages of each closure and of the environment", async () => {
    const fx = await open();
    expect(imports((await fx.adapter.closure(ref("test/ext.test.ts"))).packages)).toEqual([">ext"]);
    expect(imports((await fx.adapter.closure(ref("test/helper.test.ts"))).packages)).toEqual([
      ">helper-pkg",
    ]);
    const plain = (await fx.adapter.closure(ref("test/plain.test.ts"))).packages;
    expect(plain).toEqual({ imports: [], builtins: ["assert", "test"] });
    const spawn = (await fx.adapter.closure(ref("test/spawn.test.ts"))).packages;
    expect(spawn?.builtins).toContain("child_process");
    const [environment] = await fx.adapter.environment();
    expect(imports(environment?.packages)).toEqual([">setup-pkg", ">tsx"]);
    expect(names(environment?.packages?.runner)).toEqual([">tsx"]);
  });

  // Each from a fresh install: `bump` writes the base install with one package changed.
  it.each([
    ["node_modules/ext", "1.0.1", plusWhole("test/ext.test.ts")],
    ["node_modules/ext-trans", "1.0.1", plusWhole("test/ext.test.ts")],
    ["node_modules/helper-pkg", "1.0.1", plusWhole("test/helper.test.ts")],
    ["node_modules/tsx", "4.21.1", TEST_FILES],
    ["node_modules/setup-pkg", "1.0.1", TEST_FILES],
  ])(
    "bumping %s to %s re-keys exactly the files that load it",
    async (location, version, files) => {
      const fx = await open();
      expect(await rekeyedBy(fx, () => writeInstall(fx.root, bump(location, version)))).toEqual(
        files,
      );
    },
  );

  it("keeps a file that imports nothing installed across an unrelated install", async () => {
    const fx = await open();
    expect(
      await rekeyedBy(fx, () => writeInstall(fx.root, bump("node_modules/unrelated", "2.0.0"))),
    ).toEqual(WHOLE);
    expect(
      await rekeyedBy(fx, () =>
        writeInstall(fx.root, { ...PACKAGES, "node_modules/added": { version: "1.0.0" } }),
      ),
    ).toEqual(WHOLE);
  });
});
