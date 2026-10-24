import { lutimesSync, mkdirSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { dependencyKeys, installedDependencies, PackageScans } from "../../src/core/keys/index.js";
import type { RunnerPackages } from "../../src/core/types/index.js";
import { tempDir } from "../hash/git-repo.js";
import { type PnpmFixture, writePnpmInstall } from "./install.js";

// Review 0.1.282 B2.1 (011 C11, "a package is found as Node finds it"): pnpm installs and links no
// skipped optional package, so Node walks past it: from an importer to each parent importer and
// the root with its public hoisting, from a package folder to the private hoisting and the root.
// The key holds the copy Node finds there, with its closure, beside the skipped marker.

const ENVIRONMENT: RunnerPackages = {
  imports: [{ from: "", name: "vitest" }],
  builtins: [],
  runner: [{ from: "", name: "vitest" }],
};

/** A time before every fixture install's `lock.yaml`. */
const BEFORE_LOCK = new Date("2026-01-01T00:00:00Z");

const uses = (from: string, name: string): RunnerPackages => ({
  imports: [{ from, name }],
  builtins: [],
});

interface Keyed {
  readonly key: string;
  /** What Node loads for `require(name)` from `from`, each fixture package exporting its id. */
  readonly loaded: unknown;
}

/** The key of `packages`, and what Node loads for them, over a fresh install of each fixture. */
async function keysOver(fixtures: readonly PnpmFixture[], packages: RunnerPackages) {
  const keyed: Keyed[] = [];
  for (const fixture of fixtures) {
    const dir = tempDir();
    try {
      writePnpmInstall(dir.path, fixture);
      const installed = await installedDependencies(dir.path, dir.path, new PackageScans());
      expect([installed.note, installed.graph === null]).toEqual([null, false]);
      const keys = dependencyKeys(installed, ENVIRONMENT);
      const [{ from, name }] = packages.imports as [{ from: string; name: string }];
      keyed.push({
        key: `${keys.environment}\0${keys.of(packages)}`,
        loaded: createRequire(join(dir.path, from, "probe.cjs"))(name),
      });
    } finally {
      dir.cleanup();
    }
  }
  return keyed;
}

describe("a skipped optional package Node walks past (review 0.1.282 B2.1)", () => {
  it("keys the root's copy a workspace loads past its own skipped one, so a root bump re-keys", async () => {
    const rootAt = (version: string): PnpmFixture => ({
      importers: { ".": { a: version, vitest: "4.0.0" }, "packages/app": { a: "1.0.0" } },
      snapshots: { "a@1.0.0": { skipped: true }, [`a@${version}`]: {}, "vitest@4.0.0": {} },
    });
    const [two, three] = await keysOver(
      [rootAt("2.0.0"), rootAt("3.0.0")],
      uses("packages/app/test", "a"),
    );
    expect([two?.loaded, three?.loaded]).toEqual(["a@2.0.0", "a@3.0.0"]);
    expect(three?.key).not.toBe(two?.key);
  });

  it("keys the root's copy a package loads past its skipped edge, so a root bump re-keys", async () => {
    const edgeAt = (version: string): PnpmFixture => ({
      importers: { ".": { a: version, p: "1.0.0", vitest: "4.0.0" } },
      snapshots: {
        "a@1.0.0": { skipped: true },
        [`a@${version}`]: {},
        "p@1.0.0": { optionalDependencies: { a: "1.0.0" } },
        "vitest@4.0.0": {},
      },
    });
    const from = "node_modules/.pnpm/p@1.0.0/node_modules/p";
    const [two, three] = await keysOver([edgeAt("2.0.0"), edgeAt("3.0.0")], uses(from, "a"));
    expect([two?.loaded, three?.loaded]).toEqual(["a@2.0.0", "a@3.0.0"]);
    expect(three?.key).not.toBe(two?.key);
    const [viaP, viaP3] = await keysOver([edgeAt("2.0.0"), edgeAt("3.0.0")], uses("test", "p"));
    expect(viaP3?.key).not.toBe(viaP?.key);
  });

  it("keys the private hoist a package loads past its skipped edge, so its bump re-keys", async () => {
    const hoistAt = (version: string): PnpmFixture => ({
      importers: { ".": { p: "1.0.0", q: "1.0.0", vitest: "4.0.0" } },
      snapshots: {
        "a@1.0.0": { skipped: true },
        [`a@${version}`]: {},
        "p@1.0.0": { optionalDependencies: { a: "1.0.0" } },
        "q@1.0.0": { dependencies: { a: version } },
        "vitest@4.0.0": {},
      },
      modules: { hoistedDependencies: { [`a@${version}`]: { a: "private" } } },
    });
    const from = "node_modules/.pnpm/p@1.0.0/node_modules/p";
    const [two, three] = await keysOver([hoistAt("2.0.0"), hoistAt("3.0.0")], uses(from, "a"));
    expect([two?.loaded, three?.loaded]).toEqual(["a@2.0.0", "a@3.0.0"]);
    expect(three?.key).not.toBe(two?.key);
  });

  it("keys the public hoist the root loads past its own skipped entry, so its bump re-keys", async () => {
    const publicAt = (version: string): PnpmFixture => ({
      importers: { ".": { a: "1.0.0", q: "1.0.0", vitest: "4.0.0" } },
      snapshots: {
        "a@1.0.0": { skipped: true },
        [`a@${version}`]: {},
        "q@1.0.0": { dependencies: { a: version } },
        "vitest@4.0.0": {},
      },
      modules: { hoistedDependencies: { [`a@${version}`]: { a: "public" } } },
    });
    const [two, three] = await keysOver([publicAt("2.0.0"), publicAt("3.0.0")], uses("test", "a"));
    expect([two?.loaded, three?.loaded]).toEqual(["a@2.0.0", "a@3.0.0"]);
    expect(three?.key).not.toBe(two?.key);
  });

  it("keys a skipped optional package with no other copy by its marker alone", async () => {
    const dir = tempDir();
    try {
      writePnpmInstall(dir.path, {
        importers: { ".": { vitest: "4.0.0" }, "packages/app": { a: "1.0.0" } },
        snapshots: { "a@1.0.0": { skipped: true }, "vitest@4.0.0": {} },
      });
      const { graph, note } = await installedDependencies(dir.path, dir.path);
      expect(note).toBeNull();
      expect(graph?.identities(uses("packages/app/test", "a").imports)).toEqual([
        "skipped:a@1.0.0#sha512-a@1.0.0",
      ]);
    } finally {
      dir.cleanup();
    }
  });

  it("is stale with one note where a skipped package's link is there, which the graph cannot model", async () => {
    const fixture: PnpmFixture = {
      importers: {
        ".": { a: "2.0.0", p: "1.0.0", vitest: "4.0.0" },
        "packages/app": { a: "1.0.0" },
      },
      snapshots: {
        "a@1.0.0": { skipped: true },
        "a@2.0.0": {},
        "p@1.0.0": { optionalDependencies: { a: "1.0.0" } },
        "vitest@4.0.0": {},
      },
    };
    const target = "node_modules/.pnpm/a@2.0.0/node_modules/a";
    for (const path of [
      "packages/app/node_modules/a",
      "node_modules/.pnpm/p@1.0.0/node_modules/a",
    ]) {
      const dir = tempDir();
      try {
        writePnpmInstall(dir.path, fixture);
        mkdirSync(dirname(join(dir.path, path)), { recursive: true });
        symlinkSync(join(dir.path, target), join(dir.path, path));
        // Older than lock.yaml, as an install leaves it, so only the skipped rule applies.
        lutimesSync(join(dir.path, path), BEFORE_LOCK, BEFORE_LOCK);
        const installed = await installedDependencies(dir.path, dir.path);
        expect(installed.note).toBe(
          "node_modules/.pnpm/lock.yaml does not describe the installed packages " +
            `(installed though skipped: ${path}); ` +
            "dependencies are keyed by their package.json files until pnpm rewrites it",
        );
        expect([installed.graph, installed.formerPnpm ?? null]).toEqual([null, null]);
      } finally {
        dir.cleanup();
      }
    }
  });
});
