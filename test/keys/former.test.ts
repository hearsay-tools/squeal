import { createHash } from "node:crypto";
import { readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formerReadAsOne } from "../../src/core/keys/former.js";
import {
  type DependencyKeys,
  dependencyKeys,
  environmentHash,
  type InstalledDependencies,
  installedDependencies,
  KEY_FORMAT_VERSION,
  KEY_FORMATS_READ_AS_ONE,
  type ReadAsOne,
} from "../../src/core/keys/index.js";
import type {
  CoreEnvironmentInputs,
  RunnerEnvironment,
  RunnerPackages,
  TestFileRef,
} from "../../src/core/types/index.js";
import { tempDir, writeFile } from "../hash/git-repo.js";
import { writeInstall } from "./install.js";

// Row 011-90 (task 011-85 R4; 011 C3): the inputs the key definition before 011-85 hashed, read as
// one. That definition took npm's hidden lockfile and pnpm's `lock.yaml` whole, and every Vitest
// project's config files and their packages (review 0.1.253 B1). Where its inputs are the current
// ones, nothing more is read.

const HIDDEN = "node_modules/.package-lock.json";
const PNPM = "node_modules/.pnpm/lock.yaml";
const LINKED =
  "importers:\n  .:\n    dependencies:\n      w:\n        specifier: ^1.0.0\n        version: link:w\n";

/** The fingerprint 0.1.245 took of an install with no patches: the file whole. */
const whole = (root: string, path: string) =>
  createHash("sha256")
    .update(`${path}\0`)
    .update(readFileSync(join(root, path)))
    .digest("hex");

const CORE: CoreEnvironmentInputs = {
  squealVersion: "0",
  nodeVersion: "v24.0.0",
  platform: "linux",
  arch: "x64",
  installedDependencies: "",
  env: {},
};
const ENVIRONMENT: RunnerEnvironment = {
  project: "server",
  runnerName: "vitest",
  runnerVersion: "5.0.3",
  adapterVersion: "3",
  resolvedConfig: "{}",
  files: ["vitest.config.ts"],
};
const HASHES: Record<string, string> = { "vitest.config.ts": "r1", "e2e/vitest.config.ts": "e1" };
const hashOf = (path: string) => HASHES[path] ?? null;
const FORMATS = [KEY_FORMAT_VERSION, ...Object.keys(KEY_FORMATS_READ_AS_ONE).map(Number)];

describe("the former installed-dependency fingerprint (011-90)", () => {
  let dir: ReturnType<typeof tempDir>;
  beforeEach(() => {
    dir = tempDir();
  });
  afterEach(() => dir.cleanup());

  it("is the file whole, for a trusted hidden lockfile and for pnpm's", async () => {
    writeInstall(dir.path, { "node_modules/a": { version: "1.0.0" } }, "1.4.0");
    const npm = await installedDependencies(dir.path, dir.path);
    expect(npm.former).toBe(whole(dir.path, HIDDEN));
    expect(npm.former).not.toBe(npm.fingerprint);

    const pnpm = tempDir();
    try {
      writeFile(pnpm.path, PNPM, LINKED);
      const read = await installedDependencies(pnpm.path, pnpm.path);
      expect(read.former).toBe(whole(pnpm.path, PNPM));
      expect(read.former).not.toBe(read.fingerprint);
    } finally {
      pnpm.cleanup();
    }
  });

  it("hashes the patches after the file, as the current one does", async () => {
    writeInstall(dir.path, { "node_modules/a": { version: "1.0.0" } });
    const before = await installedDependencies(dir.path, dir.path);
    writeFile(dir.path, "patches/a+1.0.0.patch", "--- a\n+++ b\n");
    const patched = await installedDependencies(dir.path, dir.path);
    expect(patched.former).not.toBe(before.former);
    expect(patched.former).not.toBe(patched.fingerprint);
  });

  it("is null where it is the current one: a stale install, another format, none", async () => {
    writeInstall(dir.path, { "node_modules/a": { version: "1.0.0" } });
    writeFile(dir.path, "node_modules/b/package.json", '{"name":"b","version":"1.0.0"}');
    utimesSync(join(dir.path, "node_modules/b"), new Date(0), new Date(0));
    const stale = await installedDependencies(dir.path, dir.path);
    expect(stale.note).toMatch(/not listed in it: node_modules\/b/);
    expect(stale.former).toBeNull();

    const other = tempDir();
    try {
      expect((await installedDependencies(other.path, other.path)).former ?? null).toBeNull();
      writeFile(other.path, "node_modules/.yarn-state.yml", "__metadata:\n  version: 1\n");
      expect((await installedDependencies(other.path, other.path)).former).toBeNull();
    } finally {
      other.cleanup();
    }
  });
});

describe("the former dependency keys (011-90, review 0.1.253 B1)", () => {
  let dir: ReturnType<typeof tempDir>;
  beforeEach(() => {
    dir = tempDir();
  });
  afterEach(() => dir.cleanup());

  /** A trusted install whose plugin `p` reaches `child_process`, as plugins do; `a` does not. */
  async function install() {
    const esm = (source: string) => ({
      manifest: { type: "module" },
      files: { "index.js": source },
    });
    writeInstall(
      dir.path,
      {
        "node_modules/a": { version: "1.0.0" },
        "node_modules/p": { version: "1.0.0", ...esm('import "node:child_process";\n') },
      },
      "1.4.0",
    );
    return installedDependencies(dir.path, dir.path);
  }

  /** What the definition before 011-85 gave: these keys over its fingerprint, no former read. */
  const then = (read: InstalledDependencies, packages: RunnerPackages | undefined) =>
    dependencyKeys(
      { ...read, fingerprint: read.former ?? read.fingerprint, former: null },
      packages,
    );

  const A = { from: "", name: "a" };
  const P = { from: "", name: "p" };
  const SCOPED: RunnerPackages = { imports: [], builtins: [] };
  const FILES: readonly (RunnerPackages | undefined)[] = [
    undefined,
    { imports: [A], builtins: [] },
    { imports: [P], builtins: [] },
    { imports: [], builtins: ["child_process"] },
  ];

  it("over the same packages: the former fingerprint where the environment holds the whole one, else the scoped input", async () => {
    const read = await install();
    expect(read.former).not.toBeNull();
    const opaque = dependencyKeys(read, { imports: [], builtins: ["child_process"] });
    expect(opaque.environment).toBe(read.fingerprint);
    expect(opaque.former?.environment).toBe(read.former);
    const scoped = dependencyKeys(read, SCOPED);
    expect(scoped.former?.environment).toBe(scoped.environment);
    // A file keyed by the whole fingerprint reads the former one; a scoped file reads itself.
    expect(scoped.former?.of(undefined)).toBe(`whole:${read.former}`);
    expect(scoped.former?.of(FILES[1])).toBe(scoped.of(FILES[1]));
    expect(scoped.of(FILES[1])).not.toMatch(/^whole:/);
  });

  it("over a sibling's builtin: the former fingerprint whole, and no file adds a segment", async () => {
    const read = await install();
    const former: RunnerPackages = { imports: [], builtins: ["child_process"] };
    const keys = dependencyKeys(read, SCOPED, former);
    expect(keys.environment).not.toBe(read.fingerprint);
    expect(keys.former?.environment).toBe(read.former);
    expect(keys.former?.environment).toBe(then(read, former).environment);
    for (const file of FILES) {
      expect(keys.former?.of(file)).toBe("");
      expect(keys.former?.of(file)).toBe(then(read, former).of(file));
    }
  });

  it("over a sibling's opaque plugin: a file the current keys send whole reads its scoped segment", async () => {
    const read = await install();
    const former: RunnerPackages = { imports: [P], builtins: [], runner: [P] };
    const keys = dependencyKeys(read, SCOPED, former);
    expect(keys.of(FILES[2])).toBe(`whole:${read.fingerprint}`);
    expect(keys.former?.of(FILES[2])).not.toMatch(/^whole:/);
    expect(keys.former?.environment).not.toBe(keys.environment);
    expect(keys.former?.environment).toBe(then(read, former).environment);
    for (const file of FILES) expect(keys.former?.of(file)).toBe(then(read, former).of(file));
  });

  it("over a sibling's packages on a stale install: the same fingerprint, that definition's segments", async () => {
    await install();
    writeFile(dir.path, "node_modules/b/package.json", '{"name":"b","version":"1.0.0"}');
    utimesSync(join(dir.path, "node_modules/b"), new Date(0), new Date(0));
    const stale = await installedDependencies(dir.path, dir.path);
    expect(stale.former).toBeNull();
    const keys = dependencyKeys(stale, SCOPED, { imports: [], builtins: ["child_process"] });
    expect(keys.former?.environment).toBe(stale.fingerprint);
    expect(keys.former?.of(FILES[1])).toBe("");
  });

  it("is null where that definition's inputs are these", async () => {
    const none = { fingerprint: "now", former: null, note: null, graph: null, patches: "none" };
    expect(dependencyKeys(none, undefined).former ?? null).toBeNull();
    expect(dependencyKeys(none, SCOPED).former ?? null).toBeNull();
    expect(dependencyKeys(none, SCOPED, SCOPED).former ?? null).toBeNull();
  });
});

describe("formerReadAsOne (011-90)", () => {
  const a: TestFileRef = { project: "server", path: "test/a.test.ts" };
  const b: TestFileRef = { project: "server", path: "test/b.test.ts" };
  const PACKAGES: RunnerPackages = { imports: [], builtins: [] };
  const packagesOf = (ref: TestFileRef) => (ref.path === a.path ? PACKAGES : undefined);
  const keys = (former: DependencyKeys | null): DependencyKeys => ({
    environment: "deps-now",
    of: () => "",
    former,
  });
  const former: DependencyKeys = {
    environment: "deps-then",
    of: (packages) => (packages === PACKAGES ? "scoped" : "whole:deps-then"),
  };
  const core = { ...CORE, installedDependencies: "deps-now" };
  /** Each entry's environment hash, and the segment it gives `a` and `b`. */
  const read = (entries: ReadAsOne[]) =>
    entries.map((entry) => ({
      environment: entry.environment,
      segments: entry.segment === undefined ? null : [entry.segment(a), entry.segment(b)],
    }));

  it("hashes the former install at the current format and each format read as one, each file reading its former segment", () => {
    const at = (format: number) =>
      environmentHash({ ...core, installedDependencies: "deps-then" }, ENVIRONMENT, hashOf, format);
    expect(read(formerReadAsOne(core, ENVIRONMENT, keys(former), hashOf, packagesOf))).toEqual(
      FORMATS.map((format) => ({
        environment: at(format),
        segments: ["scoped", "whole:deps-then"],
      })),
    );
  });

  it("hashes the former files, every segment its own", () => {
    const formerFiles = ["e2e/vitest.config.ts", "vitest.config.ts"];
    const environment = { ...ENVIRONMENT, formerFiles };
    const at = (format: number) =>
      environmentHash(core, { ...ENVIRONMENT, files: formerFiles }, hashOf, format);
    expect(read(formerReadAsOne(core, environment, keys(null), hashOf, packagesOf))).toEqual(
      FORMATS.map((format) => ({ environment: at(format), segments: null })),
    );
  });

  it("reads nothing where the former inputs are the current ones", () => {
    expect(formerReadAsOne(core, ENVIRONMENT, keys(null), hashOf, packagesOf)).toEqual([]);
    expect(formerReadAsOne(core, ENVIRONMENT, undefined, hashOf, packagesOf)).toEqual([]);
  });
});
