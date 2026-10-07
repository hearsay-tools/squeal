import { lutimesSync, mkdirSync, rmSync, symlinkSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installedDependencies,
  installedDependenciesFingerprint,
} from "../../src/core/keys/index.js";
import { tempDir, writeFile } from "../hash/git-repo.js";

// Task 001-104: npm trusts `node_modules/.package-lock.json` only when every package folder in the
// `node_modules` hierarchy is listed in it and none it lists is newer than it. Folder times are set
// explicitly, so the fixture does not depend on the clock.
const INSTALLED = new Date("2026-09-10T00:00:00Z");
const LOCKED = new Date("2026-09-12T00:00:00Z");
const LATER = new Date("2026-09-14T00:00:00Z");

const pkg = (name: string, version: string) => JSON.stringify({ name, version });

describe("installedDependencies with npm's hidden lockfile (001-104)", () => {
  let dir: ReturnType<typeof tempDir>;
  let root: string;
  beforeEach(() => {
    dir = tempDir();
    root = dir.path;
    install(root);
  });
  afterEach(() => dir.cleanup());

  const lockfile = {
    packages: {
      "": { name: "app", workspaces: ["packages/ws"] },
      "node_modules/a": { version: "1.0.0" },
      "node_modules/@s/b": { version: "2.0.0" },
      "node_modules/a/node_modules/c": { version: "3.0.0" },
      "node_modules/ws": { resolved: "packages/ws", link: true },
      "packages/ws": { name: "ws", version: "0.0.0" },
      "packages/ws/node_modules/d": { version: "4.0.0" },
    },
  };

  /** A clean npm install: every folder listed, the lockfile written last. */
  function install(at: string): void {
    writeFile(at, "node_modules/a/package.json", pkg("a", "1.0.0"));
    writeFile(at, "node_modules/@s/b/package.json", pkg("@s/b", "2.0.0"));
    writeFile(at, "node_modules/a/node_modules/c/package.json", pkg("c", "3.0.0"));
    writeFile(at, "packages/ws/package.json", pkg("ws", "0.0.0"));
    writeFile(at, "packages/ws/node_modules/d/package.json", pkg("d", "4.0.0"));
    symlinkSync("../packages/ws", join(at, "node_modules/ws"));
    writeFile(at, "node_modules/.bin/a", "#!/bin/sh\n");
    for (const folder of [
      "node_modules/a",
      "node_modules/@s/b",
      "node_modules/a/node_modules/c",
      "packages/ws/node_modules/d",
    ]) {
      utimesSync(join(at, folder), INSTALLED, INSTALLED);
    }
    lutimesSync(join(at, "node_modules/ws"), INSTALLED, INSTALLED);
    writeFile(at, "node_modules/.package-lock.json", JSON.stringify(lockfile));
    utimesSync(join(at, "node_modules/.package-lock.json"), LOCKED, LOCKED);
  }

  /** Adds a package folder the lockfile does not list, dated before it. */
  function bypass(folder: string, version = "9.0.0"): void {
    writeFile(
      root,
      `${folder}/package.json`,
      pkg(folder.split("node_modules/").pop() ?? "", version),
    );
    utimesSync(join(root, folder), INSTALLED, INSTALLED);
  }

  const read = () => installedDependencies(root, root);

  it("keeps the lockfile fingerprint, without a note, for a clean install", async () => {
    const clean = await read();
    expect(clean.note).toBeNull();

    expect(await read()).toEqual(clean);
    expect(await installedDependenciesFingerprint(root, root)).toBe(clean.fingerprint);
  });

  it("re-keys, with one note, when a top-level package folder is not listed", async () => {
    const clean = await read();
    bypass("node_modules/@fontsource/poppins");
    const stale = await read();
    expect(stale.fingerprint).not.toBe(clean.fingerprint);
    expect(stale.note).toBe(
      "node_modules/.package-lock.json does not describe the installed packages (not listed in it: " +
        "node_modules/@fontsource/poppins); dependencies are keyed by their package.json files until npm rewrites it",
    );
    expect(await installedDependenciesFingerprint(root, root)).toBe(stale.fingerprint);
  });

  it("re-keys when a nested package folder is not listed, in a package or a workspace", async () => {
    const clean = await read();
    bypass("node_modules/@s/b/node_modules/e");
    const nested = await read();
    expect(nested.fingerprint).not.toBe(clean.fingerprint);
    expect(nested.note).toContain("not listed in it: node_modules/@s/b/node_modules/e;");

    rmSync(join(root, "node_modules/@s/b/node_modules"), { recursive: true });
    utimesSync(join(root, "node_modules/@s/b"), INSTALLED, INSTALLED);
    expect(await read()).toEqual(clean);
    bypass("packages/ws/node_modules/f");
    expect((await read()).note).toContain("not listed in it: packages/ws/node_modules/f)");
  });

  it("re-keys, with one note, when a listed folder is newer than the lockfile", async () => {
    const clean = await read();
    utimesSync(join(root, "node_modules/a/node_modules/c"), LATER, LATER);
    const newer = await read();
    expect(newer.fingerprint).not.toBe(clean.fingerprint);
    expect(newer.note).toContain("(newer than it: node_modules/a/node_modules/c)");
  });

  it("re-keys when a listed folder is missing", async () => {
    const clean = await read();
    rmSync(join(root, "node_modules/a/node_modules/c"), { recursive: true });
    const missing = await read();
    expect(missing.fingerprint).not.toBe(clean.fingerprint);
    expect(missing.note).toContain("(missing: node_modules/a/node_modules/c)");
  });

  it("names every kind of violation in the one note, with a count past the first", async () => {
    bypass("node_modules/x");
    bypass("node_modules/y");
    utimesSync(join(root, "node_modules/a"), LATER, LATER);
    expect((await read()).note).toContain(
      "(not listed in it: node_modules/x and 1 more; newer than it: node_modules/a)",
    );
  });

  it("compares a workspace link by lstat, never its live target", async () => {
    const clean = await read();
    writeFile(root, "packages/ws/src/index.ts", "export {};\n");
    utimesSync(join(root, "packages/ws"), LATER, LATER);
    expect(await read()).toEqual(clean);

    lutimesSync(join(root, "node_modules/ws"), LATER, LATER);
    expect((await read()).note).toContain("(newer than it: node_modules/ws)");
  });

  it("keys a stale install by its package folders, so a change still re-keys and none does not", async () => {
    bypass("node_modules/extra", "1.0.0");
    const first = await read();
    expect(await read()).toEqual(first);

    bypass("node_modules/extra", "1.0.1");
    const bumped = await read();
    expect(bumped.fingerprint).not.toBe(first.fingerprint);

    mkdirSync(join(root, "node_modules/a/node_modules/c/node_modules/g"), { recursive: true });
    expect((await read()).fingerprint).not.toBe(bumped.fingerprint);
  });

  it("treats an unreadable lockfile as stale", async () => {
    writeFile(root, "node_modules/.package-lock.json", "{not json");
    utimesSync(join(root, "node_modules/.package-lock.json"), LOCKED, LOCKED);
    expect((await read()).note).toContain("(not valid JSON)");
  });

  it("does not apply npm's rule to other package managers' lockfiles", async () => {
    rmSync(join(root, "node_modules/.package-lock.json"));
    writeFile(root, "node_modules/.yarn-state.yml", "x");
    bypass("node_modules/extra");
    expect((await read()).note).toBeNull();
  });
});
