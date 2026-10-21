import { lutimesSync, rmSync, symlinkSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dependencyKeys, installedDependencies } from "../../src/core/keys/index.js";
import { tempDir, writeFile } from "../hash/git-repo.js";

// Task 011-85, R1 (011 C11): npm's hidden lockfile keys the install, never the root's or a
// workspace's own version, which a release raises. Regressions 1 to 3 of the design.

const INSTALLED = new Date("2026-09-10T00:00:00Z");
const LOCKED = new Date("2026-09-12T00:00:00Z");
const pkg = (name: string, version: string) => JSON.stringify({ name, version });

const LOCKFILE = {
  name: "app",
  version: "1.4.0",
  lockfileVersion: 3,
  requires: true,
  packages: {
    "": { name: "app", version: "1.4.0", workspaces: ["packages/ws"] },
    "node_modules/a": { version: "1.0.0", integrity: "sha512-a1" },
    "node_modules/ws": { resolved: "packages/ws", link: true },
    "packages/ws": { name: "ws", version: "0.3.0", dependencies: { a: "^1.0.0" } },
  },
};

/** `LOCKFILE` with top-level fields and some entries' fields replaced. */
function lockfileWith(top: object, entries: Readonly<Record<string, object>> = {}) {
  const packages: Record<string, object | undefined> = { ...LOCKFILE.packages };
  for (const [path, fields] of Object.entries(entries)) {
    packages[path] = { ...packages[path], ...fields };
  }
  return { ...LOCKFILE, ...top, packages };
}

describe("the installed-dependency fingerprint and own versions (011-85)", () => {
  let dir: ReturnType<typeof tempDir>;
  let root: string;
  beforeEach(() => {
    dir = tempDir();
    root = dir.path;
    writeFile(root, "node_modules/a/package.json", pkg("a", "1.0.0"));
    writeFile(root, "packages/ws/package.json", pkg("ws", "0.3.0"));
    writeFile(root, "packages/other/package.json", pkg("other", "0.1.0"));
    symlinkSync("../packages/ws", join(root, "node_modules/ws"));
    utimesSync(join(root, "node_modules/a"), INSTALLED, INSTALLED);
    lutimesSync(join(root, "node_modules/ws"), INSTALLED, INSTALLED);
    lock(LOCKFILE);
  });
  afterEach(() => dir.cleanup());

  function lock(content: unknown): void {
    writeFile(root, "node_modules/.package-lock.json", JSON.stringify(content));
    utimesSync(join(root, "node_modules/.package-lock.json"), LOCKED, LOCKED);
  }
  const fingerprint = async () => {
    const read = await installedDependencies(root, root);
    expect(read.note).toBeNull();
    return read.fingerprint;
  };

  it("keeps it across a raise of the root's version", async () => {
    const before = await fingerprint();
    lock(lockfileWith({ version: "1.5.0" }, { "": { version: "1.5.0" } }));
    expect(await fingerprint()).toBe(before);
  });

  it("keeps it across a raise of a workspace's version", async () => {
    const before = await fingerprint();
    lock(lockfileWith({}, { "packages/ws": { version: "0.4.0" } }));
    expect(await fingerprint()).toBe(before);
  });

  it("moves it for an upgrade under node_modules: a version or an integrity (regression 1)", async () => {
    const before = await fingerprint();
    lock(lockfileWith({}, { "node_modules/a": { version: "1.0.1" } }));
    const version = await fingerprint();
    lock(lockfileWith({}, { "node_modules/a": { integrity: "sha512-a2" } }));
    const integrity = await fingerprint();
    expect(new Set([before, version, integrity]).size).toBe(3);
  });

  it("keeps an opaque environment and an opaque test file's segment across a raise, and moves both for an upgrade (regression 1)", async () => {
    const opaque = { imports: [], builtins: ["child_process"] };
    const keys = async () => {
      const installed = await installedDependencies(root, root);
      return [
        dependencyKeys(installed, opaque).environment,
        dependencyKeys(installed, { imports: [], builtins: [] }).of(opaque),
      ];
    };
    const before = await keys();
    lock(lockfileWith({ version: "1.5.0" }));
    expect(await keys()).toEqual(before);
    lock(lockfileWith({}, { "node_modules/a": { version: "1.0.1" } }));
    const [environment, segment] = await keys();
    expect(environment).not.toBe(before[0]);
    expect(segment).not.toBe(before[1]);
  });

  it("moves it for a workspace added, a link retargeted or a workspace's edges changed (regression 2)", async () => {
    const before = await fingerprint();
    lock(lockfileWith({}, { "packages/other": { name: "other", version: "0.1.0" } }));
    const added = await fingerprint();
    lock(lockfileWith({}, { "node_modules/ws": { resolved: "packages/other" } }));
    const retargeted = await fingerprint();
    lock(lockfileWith({}, { "packages/ws": { dependencies: { a: "^1.0.1" } } }));
    const edges = await fingerprint();
    expect(new Set([before, added, retargeted, edges]).size).toBe(4);
  });

  it("still keys a stale lockfile by its package folders, which a raise does not move (regression 3, 001-104)", async () => {
    writeFile(root, "node_modules/b/package.json", pkg("b", "1.0.0"));
    utimesSync(join(root, "node_modules/b"), INSTALLED, INSTALLED);
    const stale = await installedDependencies(root, root);
    expect(stale.note).toMatch(/not listed in it: node_modules\/b/);
    lock(lockfileWith({ version: "1.5.0" }));
    expect((await installedDependencies(root, root)).fingerprint).toBe(stale.fingerprint);
    rmSync(join(root, "node_modules/b"), { recursive: true });
    writeFile(root, "node_modules/b/package.json", pkg("b", "1.0.1"));
    utimesSync(join(root, "node_modules/b"), INSTALLED, INSTALLED);
    expect((await installedDependencies(root, root)).fingerprint).not.toBe(stale.fingerprint);
  });
});
