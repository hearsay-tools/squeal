import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type DependencyKeys,
  dependencyKeys,
  installedDependencies,
} from "../../src/core/keys/index.js";
import type { RunnerPackages } from "../../src/core/types/index.js";
import { tempDir, writeFile } from "../hash/git-repo.js";
import { type FixturePackage, writeInstall } from "./install.js";

// Task 001-105, scheme B of `research/per-package-keys.md`: a test file's key holds the lockfile
// closure of the installed packages its closure imports directly; the environment hash the runner's
// own, the setup files' and the config's; a closure that reaches a process, a thread or `module`
// keys by the whole fingerprint.

const BASE: Readonly<Record<string, FixturePackage>> = {
  "node_modules/vitest": {
    version: "5.0.0",
    dependencies: { vite: "8" },
    peerDependencies: { "@types/node": "*" },
  },
  "node_modules/vite": { version: "8.0.0" },
  "node_modules/@types/node": {
    version: "22.0.0",
    dependencies: { "undici-types": "6" },
    files: {
      "index.d.ts": "export {};\n",
      "fs/promises.d.ts": "export {};\n",
      "README.md": "",
      LICENSE: "",
    },
  },
  "node_modules/undici-types": { version: "6.0.0", files: { "index.d.ts": "export {};\n" } },
  "node_modules/ext": { version: "1.0.0", dependencies: { trans: "1" } },
  "node_modules/trans": { version: "1.0.0" },
  "node_modules/other": { version: "1.0.0" },
  "node_modules/setup-pkg": { version: "1.0.0" },
  "node_modules/nested": { version: "1.0.0", dependencies: { trans: "2" } },
  "node_modules/nested/node_modules/trans": { version: "2.0.0" },
  "node_modules/opt": { version: "1.0.0", optionalDependencies: { missing: "1" } },
  "node_modules/ts-src": { version: "1.0.0", files: { "index.ts": "export const x = 1;\n" } },
  "node_modules/ws": { version: "", link: "packages/ws" },
};

const ENVIRONMENT: RunnerPackages = {
  imports: [
    { from: "", name: "vitest" },
    { from: "test", name: "setup-pkg" },
  ],
  builtins: [],
};

const uses = (...names: string[]): RunnerPackages => ({
  imports: names.map((name) => ({ from: "test", name })),
  builtins: [],
});

describe("per-package dependency keys (001-105)", () => {
  let dir: ReturnType<typeof tempDir>;
  let root: string;
  beforeEach(() => {
    dir = tempDir();
    root = dir.path;
    writeFile(root, "packages/ws/package.json", JSON.stringify({ name: "ws", version: "0.0.0" }));
  });
  afterEach(() => dir.cleanup());

  const keysOf = async (
    packages: Readonly<Record<string, FixturePackage>>,
    /** `null`: the runner reports no environment packages. */
    environment: RunnerPackages | null = ENVIRONMENT,
  ): Promise<DependencyKeys> => {
    const scratch = tempDir();
    try {
      writeFile(scratch.path, "packages/ws/package.json", "{}");
      writeInstall(scratch.path, packages);
      const installed = await installedDependencies(scratch.path, scratch.path);
      return dependencyKeys(installed, environment ?? undefined);
    } finally {
      scratch.cleanup();
    }
  };
  const bump = (location: string, version: string) => ({
    ...BASE,
    [location]: { ...BASE[location], version } as FixturePackage,
  });

  it("re-keys a test file when a declared dependency of a package it imports changes, and only it", async () => {
    const before = await keysOf(BASE);
    const after = await keysOf(bump("node_modules/trans", "1.0.1"));
    expect(after.environment).toBe(before.environment);
    expect(after.of(uses("ext"))).not.toBe(before.of(uses("ext")));
    expect(after.of(uses("other"))).toBe(before.of(uses("other")));
    // `nested` loads its own copy of `trans`, which did not change.
    expect(after.of(uses("nested"))).toBe(before.of(uses("nested")));
  });

  it("looks a package up from the importer's directory first, as Node does", async () => {
    const before = await keysOf(BASE);
    const after = await keysOf(bump("node_modules/nested/node_modules/trans", "2.0.1"));
    expect(after.of(uses("nested"))).not.toBe(before.of(uses("nested")));
    expect(after.of(uses("ext"))).toBe(before.of(uses("ext")));
  });

  it("re-keys every test file when a package the environment imports changes", async () => {
    const before = await keysOf(BASE);
    const after = await keysOf(bump("node_modules/setup-pkg", "1.0.1"));
    expect(after.environment).not.toBe(before.environment);
    expect((await keysOf(bump("node_modules/vite", "8.0.1"))).environment).not.toBe(
      before.environment,
    );
  });

  it("keys a package with no runtime file as a constant: bumping @types/node re-keys nothing", async () => {
    const before = await keysOf(BASE);
    const after = await keysOf({
      ...bump("node_modules/@types/node", "24.0.0"),
      "node_modules/undici-types": {
        ...BASE["node_modules/undici-types"],
        version: "7.0.0",
      } as FixturePackage,
    });
    expect(after.environment).toBe(before.environment);
    expect(after.of(uses("ext", "@types/node"))).toBe(before.of(uses("ext", "@types/node")));
  });

  it("counts TypeScript sources as runtime files", async () => {
    const before = await keysOf(BASE);
    const after = await keysOf(bump("node_modules/ts-src", "1.0.1"));
    expect(after.of(uses("ts-src"))).not.toBe(before.of(uses("ts-src")));
  });

  it("keys a name that does not resolve as absent, so its install re-keys", async () => {
    const before = await keysOf(BASE);
    const after = await keysOf({ ...BASE, "node_modules/late": { version: "1.0.0" } });
    expect(after.of(uses("late"))).not.toBe(before.of(uses("late")));
    expect(after.of(uses("ext"))).toBe(before.of(uses("ext")));
    const optional = await keysOf({ ...BASE, "node_modules/missing": { version: "1.0.0" } });
    expect(optional.of(uses("opt"))).not.toBe(before.of(uses("opt")));
  });

  it("keys a workspace link by its location: its files are project files in the closure", async () => {
    const before = await keysOf(BASE);
    const after = await keysOf(bump("node_modules/other", "2.0.0"));
    expect(after.of(uses("ws"))).toBe(before.of(uses("ws")));
  });

  it("keys a closure that imports child_process, worker_threads or module by the whole fingerprint", async () => {
    const before = await keysOf(BASE);
    const after = await keysOf(bump("node_modules/other", "2.0.0"));
    for (const builtin of ["child_process", "worker_threads", "module"]) {
      const spawns = { ...uses("ext"), builtins: ["fs", builtin] };
      expect(after.of(spawns)).not.toBe(before.of(spawns));
    }
    const plain = { ...uses("ext"), builtins: ["fs", "path"] };
    expect(after.of(plain)).toBe(before.of(plain));
  });

  it("keys a test file whose runner reports no packages (node:test today) by the whole fingerprint", async () => {
    // Agreed with the 002/003 coordinator, 2026-10-07: until their 003-22.
    const before = await keysOf(BASE);
    const after = await keysOf(bump("node_modules/other", "2.0.0"));
    expect(after.of(undefined)).not.toBe(before.of(undefined));
    expect(after.of(uses())).toBe(before.of(uses()));
  });

  it("holds the whole fingerprint in the environment hash when the environment imports a process builtin", async () => {
    const spawning = { ...ENVIRONMENT, builtins: ["child_process"] };
    const before = await keysOf(BASE, spawning);
    const after = await keysOf(bump("node_modules/other", "2.0.0"), spawning);
    expect(after.environment).not.toBe(before.environment);
    expect(after.of(uses("ext"))).toBe("");
  });

  it("holds the whole fingerprint in the environment hash when the runner reports no environment packages", async () => {
    const before = await keysOf(BASE, null);
    const after = await keysOf(bump("node_modules/other", "2.0.0"), null);
    expect(after.environment).not.toBe(before.environment);
  });

  it("re-keys every test file when a package folder appears without the hidden lockfile being rewritten", async () => {
    writeInstall(root, BASE);
    const before = dependencyKeys(await installedDependencies(root, root), ENVIRONMENT);
    writeFile(
      root,
      "node_modules/sideloaded/package.json",
      JSON.stringify({ name: "sideloaded", version: "1.0.0" }),
    );
    const stale = await installedDependencies(root, root);
    expect(stale.graph).toBeNull();
    expect(stale.note).toContain("node_modules/sideloaded");
    const after = dependencyKeys(stale, ENVIRONMENT);
    expect(after.environment).not.toBe(before.environment);
  });

  it("keys a project below the worktree root against its own install", async () => {
    // Review N8's case the scheme B way: `packages/app/node_modules` holds the project's install.
    const app = join(root, "packages/app");
    writeInstall(app, BASE);
    const keysOfApp = async () =>
      dependencyKeys(await installedDependencies(app, root), {
        imports: [{ from: "packages/app", name: "vitest" }],
        builtins: [],
      });
    const appTest = { imports: [{ from: "packages/app/test", name: "ext" }], builtins: [] };
    const appOther = { imports: [{ from: "packages/app/test", name: "other" }], builtins: [] };
    const before = await keysOfApp();
    writeInstall(app, bump("node_modules/trans", "1.0.1"));
    const after = await keysOfApp();
    expect(after.environment).toBe(before.environment);
    expect(after.of(appTest)).not.toBe(before.of(appTest));
    expect(after.of(appOther)).toBe(before.of(appOther));
  });

  it("keeps the whole fingerprint for lockfile formats other than npm's hidden lockfile", async () => {
    writeFile(root, "node_modules/.yarn-state.yml", "a@1:\n  locations: [node_modules/a]\n");
    const installed = await installedDependencies(root, root);
    expect(installed.graph).toBeNull();
    expect(dependencyKeys(installed, ENVIRONMENT).environment).toBe(installed.fingerprint);
  });

  it("re-keys every test file when a patch changes", async () => {
    writeInstall(root, BASE);
    const before = dependencyKeys(await installedDependencies(root, root), ENVIRONMENT);
    writeFile(root, "patches/ext+1.0.0.patch", "--- a\n+++ b\n");
    const after = dependencyKeys(await installedDependencies(root, root), ENVIRONMENT);
    expect(after.environment).not.toBe(before.environment);
    expect(after.of(uses("ext"))).toBe(before.of(uses("ext")));
  });
});
