import { describe, expect, it } from "vitest";
import { dependencyKeys, installedDependencies } from "../../../src/core/keys/index.js";
import type { RunOutcome } from "../../../src/core/types/index.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { type FixturePackage, writeInstall } from "../../keys/install.js";
import { type FixtureProject, openFixture, ref, SLOW } from "./helpers.js";

// Task 001-117, review wave-11d S1 to S3: each a package bump that kept a test file's complete
// dependency key while its result went from pass to fail. Each phase is a fresh copy of the
// fixture, so no module cached by an earlier run hides the bump; keys are worktree-relative, so
// two copies of one install key alike.

const esm = (source: string) => ({
  manifest: { type: "module", main: "index.js" },
  files: { "index.js": source },
});

const PACKAGES: Readonly<Record<string, FixturePackage>> = {
  "node_modules/@types/probe": { version: "1.0.0", files: { "index.d.ts": "export {};\n" } },
  "node_modules/cjs-pkg": { version: "1.0.0", files: { "index.js": 'exports.value = "one";\n' } },
  // The config plugin declares `spawner` and never calls it.
  "node_modules/plugin-pkg": {
    version: "1.0.0",
    dependencies: { spawner: "^1" },
    ...esm('export default function plugin() {\n  return { name: "plugin-pkg" };\n}\n'),
  },
  "node_modules/outer": {
    version: "1.0.0",
    dependencies: { middle: "^1" },
    ...esm('export { actual } from "middle";\n'),
  },
  "node_modules/middle": {
    version: "1.0.0",
    dependencies: { spawner: "^1" },
    ...esm('export { actual } from "spawner";\n'),
  },
  // Runs a child at the project root that loads `child-pkg`, which `spawner` does not declare.
  "node_modules/spawner": {
    version: "1.0.0",
    ...esm(
      'import { execFileSync } from "node:child_process";\n' +
        'import { fileURLToPath } from "node:url";\n' +
        'const cwd = fileURLToPath(new URL("../../", import.meta.url));\n' +
        "const script = \"process.stdout.write(require('child-pkg'))\";\n" +
        "export const actual = () =>\n" +
        "  execFileSync(process.execPath, ['-e', script], { cwd }).toString();\n",
    ),
  },
  "node_modules/child-pkg": {
    version: "1.0.0",
    files: { "index.js": 'module.exports = "one";\n' },
  },
};

const TEST_FILES = [
  "test/helper.test.ts",
  "test/manifest.test.ts",
  "test/outer.test.ts",
  "test/plain.test.ts",
];

/** The install with `location` at 1.0.1, its files as `files` gives them. */
const bumped = (location: string, files?: Readonly<Record<string, string>>) => ({
  ...PACKAGES,
  [location]: { ...PACKAGES[location], version: "1.0.1", ...(files ? { files } : {}) },
});

interface Phase {
  readonly fx: FixtureProject;
  /** Each test file's dependency key inputs: the environment's, then its own segment. */
  readonly keys: ReadonlyMap<string, string>;
  readonly segments: ReadonlyMap<string, string>;
  readonly outcomes: ReadonlyMap<string, readonly RunOutcome[]>;
}

async function phase(packages: Readonly<Record<string, FixturePackage>>): Promise<Phase> {
  const fx = await openFixture("escapes", {}, async (root) => {
    writeInstall(root, packages);
    return createVitestAdapter({ root });
  });
  const [environment] = await fx.adapter.environment();
  const dependencies = dependencyKeys(
    await installedDependencies(fx.root, fx.root),
    environment?.packages,
  );
  const keys = new Map<string, string>();
  const segments = new Map<string, string>();
  for (const path of TEST_FILES) {
    const closure = await fx.adapter.closure(ref(path));
    const segment = dependencies.of(closure.packages);
    segments.set(path, segment);
    keys.set(path, `${dependencies.environment}\0${segment}`);
  }
  const report = await fx.adapter.run(
    TEST_FILES.map((path) => ref(path)),
    fx.runOptions(),
  );
  const outcomes = new Map<string, RunOutcome[]>();
  for (const result of report.results) {
    const list = outcomes.get(result.check.testPath) ?? [];
    list.push(result.outcome);
    outcomes.set(result.check.testPath, list);
  }
  return { fx, keys, segments, outcomes };
}

/** Test files whose key moved between two phases. */
const rekeyed = (before: Phase, after: Phase) =>
  TEST_FILES.filter((path) => before.keys.get(path) !== after.keys.get(path));

describe("vitest adapter: dependency keys that kept a result-changing bump (001-117)", SLOW, () => {
  it("re-keys and re-runs on each bump that flips a result", async () => {
    const before = await phase(PACKAGES);
    for (const path of TEST_FILES) expect(before.outcomes.get(path), path).toEqual(["pass"]);
    // The config plugin alone reaches `spawner`: a file that does not keeps its scoped key.
    expect(before.segments.get("test/plain.test.ts")).not.toMatch(/^whole:/);

    // S1: a literal require of a types-only package's manifest keys its version.
    const manifest = await phase(bumped("node_modules/@types/probe", { "index.d.ts": "" }));
    expect(manifest.outcomes.get("test/manifest.test.ts")).toEqual(["fail"]);
    expect(rekeyed(before, manifest)).toContain("test/manifest.test.ts");

    // S2: the test's own path to `spawner` holds an opaque package, though the plugin's does too.
    const child = await phase(
      bumped("node_modules/child-pkg", { "index.js": 'module.exports = "two";\n' }),
    );
    expect(child.outcomes.get("test/outer.test.ts")).toEqual(["fail"]);
    expect(before.segments.get("test/outer.test.ts")).toMatch(/^whole:/);
    expect(rekeyed(before, child)).toEqual(["test/outer.test.ts"]);

    // S3: the helper a relative require reaches is walked, and its package keys the test.
    const helper = await phase(
      bumped("node_modules/cjs-pkg", { "index.js": 'exports.value = "two";\n' }),
    );
    expect(helper.outcomes.get("test/helper.test.ts")).toEqual(["fail"]);
    expect(rekeyed(before, helper)).toEqual(["test/helper.test.ts", "test/outer.test.ts"]);
  });

  it("puts a relatively required helper in its test file's closure (S3)", async () => {
    const fx = await openFixture("escapes", {}, async (root) => {
      writeInstall(root, PACKAGES);
      return createVitestAdapter({ root });
    });
    const closure = await fx.adapter.closure(ref("test/helper.test.ts"));
    expect(closure.paths).toContain("test/helper.cjs");
    expect(closure.packages?.imports).toContainEqual({ from: "test", name: "cjs-pkg" });
    expect(closure.packages?.builtins).not.toContain("module");
  });

  it("follows each shape of relative require, or keys by the whole fingerprint (S3)", async () => {
    const requires = (...specifiers: string[]) =>
      `import { it } from "vitest";\ndeclare const require: { (id: string): unknown; resolve(id: string): string };\n${specifiers.join("\n")}\nit("x", () => {});\n`;
    const fx = await openFixture(
      "escapes",
      {
        "test/missing.test.ts": requires('require("./absent.cjs");'),
        "test/resolve.test.ts": requires('require.resolve("./data.json");'),
        "test/data.json": "{}\n",
        "test/directory.test.ts": requires('require("./lib");'),
        "test/lib/package.json": '{ "main": "main.js" }\n',
        "test/lib/main.js": "",
      },
      async (root) => {
        writeInstall(root, PACKAGES);
        return createVitestAdapter({ root });
      },
    );
    // Not there yet: the target and its candidates, so the file's appearance re-keys.
    const missing = await fx.adapter.closure(ref("test/missing.test.ts"));
    expect(missing.paths).toContain("test/absent.cjs");
    expect(missing.packages?.builtins).not.toContain("module");
    const resolved = await fx.adapter.closure(ref("test/resolve.test.ts"));
    expect(resolved.paths).toContain("test/data.json");
    expect(resolved.packages?.builtins).not.toContain("module");
    // A directory's `main` is not resolved statically.
    const directory = await fx.adapter.closure(ref("test/directory.test.ts"));
    expect(directory.packages?.builtins).toContain("module");
  });
});
