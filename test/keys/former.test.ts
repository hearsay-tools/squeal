import { createHash } from "node:crypto";
import { readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formerReadAsOne } from "../../src/core/keys/former.js";
import {
  dependencyKeys,
  environmentHash,
  installedDependencies,
  KEY_FORMAT_VERSION,
  KEY_FORMATS_READ_AS_ONE,
} from "../../src/core/keys/index.js";
import type { CoreEnvironmentInputs, RunnerEnvironment } from "../../src/core/types/index.js";
import { tempDir, writeFile } from "../hash/git-repo.js";
import { writeInstall } from "./install.js";

// Row 011-90 (task 011-85 R4; 011 C3): the inputs the key definition before 011-85 hashed, read as
// one. That definition took npm's hidden lockfile and pnpm's `lock.yaml` whole, and every Vitest
// project's config files. Where its inputs are the current ones, nothing more is read.

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

describe("the former dependency input (011-90)", () => {
  const installed = (former: string | null) => ({
    fingerprint: "now",
    former,
    note: null,
    graph: null,
    patches: "none",
  });

  it("is the former fingerprint where the environment holds the whole one, a whole segment reading it", () => {
    expect(dependencyKeys(installed("then"), undefined).former).toEqual({
      environment: "then",
      segment: { from: "whole:now", to: "whole:then" },
    });
  });

  it("keeps a scoped environment input, a whole segment reading the former fingerprint", async () => {
    const dir = tempDir();
    try {
      writeInstall(dir.path, { "node_modules/a": { version: "1.0.0" } });
      const read = await installedDependencies(dir.path, dir.path);
      const keys = dependencyKeys(read, { imports: [], builtins: [] });
      expect(keys.environment).not.toBe(read.fingerprint);
      expect(keys.former).toEqual({
        environment: keys.environment,
        segment: { from: `whole:${read.fingerprint}`, to: `whole:${read.former}` },
      });
    } finally {
      dir.cleanup();
    }
  });

  it("is null where the fingerprint is the former one", () => {
    expect(dependencyKeys(installed(null), undefined).former ?? null).toBeNull();
  });
});

describe("formerReadAsOne (011-90)", () => {
  const former = {
    environment: "deps-then",
    segment: { from: "whole:deps-now", to: "whole:deps-then" },
  };
  const keys = (former: { environment: string; segment: { from: string; to: string } } | null) => ({
    environment: "deps-now",
    of: () => "",
    former,
  });
  const core = { ...CORE, installedDependencies: "deps-now" };

  it("hashes the former install at the current format and each format read as one, with its segment", () => {
    const at = (format: number) =>
      environmentHash({ ...core, installedDependencies: "deps-then" }, ENVIRONMENT, hashOf, format);
    expect(formerReadAsOne(core, ENVIRONMENT, keys(former), hashOf)).toEqual(
      FORMATS.map((format) => ({ environment: at(format), segment: former.segment })),
    );
  });

  it("hashes the former files, every segment its own", () => {
    const formerFiles = ["e2e/vitest.config.ts", "vitest.config.ts"];
    const environment = { ...ENVIRONMENT, formerFiles };
    const at = (format: number) =>
      environmentHash(core, { ...ENVIRONMENT, files: formerFiles }, hashOf, format);
    expect(formerReadAsOne(core, environment, keys(null), hashOf)).toEqual(
      FORMATS.map((format) => ({ environment: at(format) })),
    );
  });

  it("reads nothing where the former inputs are the current ones", () => {
    expect(formerReadAsOne(core, ENVIRONMENT, keys(null), hashOf)).toEqual([]);
    expect(formerReadAsOne(core, ENVIRONMENT, undefined, hashOf)).toEqual([]);
  });
});
