import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  coreEnvironmentInputs,
  environmentHash,
  installedDependenciesFingerprint,
} from "../../src/core/keys/index.js";
import type {
  CoreEnvironmentInputs,
  FileHash,
  RelativePath,
  RunnerEnvironment,
} from "../../src/core/types/index.js";
import { tempDir, writeFile } from "../hash/git-repo.js";

const core: CoreEnvironmentInputs = {
  squealVersion: "0.1.0",
  nodeVersion: "v24.21.0",
  platform: "linux",
  arch: "x64",
  installedDependencies: "deps-1",
  env: { CI: "1", TZ: "UTC" },
};

const runner: RunnerEnvironment = {
  project: "",
  runnerName: "vitest",
  runnerVersion: "5.0.3",
  adapterVersion: "1",
  resolvedConfig: '{"globals":false}',
  files: ["vitest.config.ts", "test/setup.ts"],
};

const hashes: Record<RelativePath, FileHash | null> = {
  "vitest.config.ts": "aaa",
  "test/setup.ts": "bbb",
  "test/setup2.ts": "bbb",
  "test/absent.ts": null,
};
const hashOf = (path: RelativePath) => hashes[path];
const hashWith =
  (overrides: Record<RelativePath, FileHash | null>) =>
  (path: RelativePath): FileHash | null | undefined =>
    path in overrides ? overrides[path] : hashOf(path);

describe("environmentHash", () => {
  it("is a lowercase sha256 hex digest", () => {
    expect(environmentHash(core, runner, hashOf)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable under reordering of env variables and runner files", () => {
    const reordered = environmentHash(
      { ...core, env: { TZ: "UTC", CI: "1" } },
      { ...runner, files: [...runner.files].reverse() },
      hashOf,
    );
    expect(reordered).toBe(environmentHash(core, runner, hashOf));
  });

  it("hashes runner files through the lookup, so a content change changes it", () => {
    const changed = hashWith({ "vitest.config.ts": "ccc" });
    expect(environmentHash(core, runner, changed)).not.toBe(environmentHash(core, runner, hashOf));
  });

  it("encodes an absent runner file, distinct from any content", () => {
    const withAbsent = { ...runner, files: [...runner.files, "test/absent.ts"] };
    const absent = environmentHash(core, withAbsent, hashOf);
    expect(absent).not.toBe(environmentHash(core, runner, hashOf));
    expect(absent).not.toBe(environmentHash(core, withAbsent, hashWith({ "test/absent.ts": "-" })));
  });

  it("refuses a runner file the lookup does not track", () => {
    const withUntracked = { ...runner, files: [...runner.files, "gen/setup.ts"] };
    expect(() => environmentHash(core, withUntracked, hashOf)).toThrow(
      /project "": runner file "gen\/setup.ts" has not been hashed/,
    );
  });

  const changes: Record<string, [Partial<CoreEnvironmentInputs>, Partial<RunnerEnvironment>]> = {
    "squeal version": [{ squealVersion: "0.2.0" }, {}],
    "node version": [{ nodeVersion: "v24.21.1" }, {}],
    platform: [{ platform: "darwin" }, {}],
    arch: [{ arch: "arm64" }, {}],
    "installed dependencies": [{ installedDependencies: "deps-2" }, {}],
    "an env value": [{ env: { CI: "1", TZ: "Europe/Warsaw" } }, {}],
    "an env variable set to empty": [{ env: { CI: "1", TZ: "UTC", HOME: "" } }, {}],
    project: [{}, { project: "unit" }],
    "runner name": [{}, { runnerName: "jest" }],
    "runner version": [{}, { runnerVersion: "5.0.4" }],
    "adapter version": [{}, { adapterVersion: "2" }],
    "resolved config": [{}, { resolvedConfig: '{"globals":true}' }],
    "a setup file path": [{}, { files: ["vitest.config.ts", "test/setup2.ts"] }],
  };
  for (const [name, [coreChange, runnerChange]] of Object.entries(changes)) {
    it(`changes with the ${name}`, () => {
      expect(
        environmentHash({ ...core, ...coreChange }, { ...runner, ...runnerChange }, hashOf),
      ).not.toBe(environmentHash(core, runner, hashOf));
    });
  }

  it("does not confuse field boundaries", () => {
    const a = environmentHash({ ...core, platform: "linux", arch: "x64" }, runner, hashOf);
    const b = environmentHash({ ...core, platform: "linuxx", arch: "64" }, runner, hashOf);
    expect(a).not.toBe(b);
  });
});

describe("coreEnvironmentInputs", () => {
  it("takes only allow-listed variables that are set", () => {
    const inputs = coreEnvironmentInputs({
      squealVersion: "0.1.0",
      installedDependencies: "deps",
      allowlist: ["TZ", "MISSING", "CI"],
      env: { TZ: "UTC", CI: "", SECRET: "x" },
    });
    expect(inputs.env).toEqual({ CI: "", TZ: "UTC" });
    expect(Object.keys(inputs.env)).toEqual(["CI", "TZ"]);
    expect(inputs.nodeVersion).toBe(process.version);
    expect(inputs.platform).toBe(process.platform);
    expect(inputs.arch).toBe(process.arch);
  });
});

describe("installedDependenciesFingerprint", () => {
  let dir: ReturnType<typeof tempDir>;
  beforeEach(() => {
    dir = tempDir();
  });
  afterEach(() => dir.cleanup());

  const fingerprintOf = (root: string, project = root) =>
    installedDependenciesFingerprint(project, root);

  it("is 'none' without any installed lockfile", async () => {
    expect(await fingerprintOf(dir.path)).toBe("none");
  });

  it("changes with the installed npm lockfile and the patches directory content", async () => {
    writeFile(dir.path, "node_modules/.package-lock.json", '{"packages":{"a":"1"}}');
    const first = await fingerprintOf(dir.path);
    expect(first).toMatch(/^[0-9a-f]{64}$/);

    writeFile(dir.path, "patches/a+1.patch", "--- a\n+++ b\n");
    const patched = await fingerprintOf(dir.path);
    expect(patched).not.toBe(first);

    writeFile(dir.path, "patches/a+1.patch", "--- a\n+++ c\n");
    expect(await fingerprintOf(dir.path)).not.toBe(patched);

    writeFile(dir.path, "node_modules/.package-lock.json", '{"packages":{"a":"2"}}');
    expect(await fingerprintOf(dir.path)).not.toBe(first);
  });

  it("is equal for two installs at different absolute paths", async () => {
    for (const root of ["one", "two/nested"]) {
      writeFile(join(dir.path, root), "node_modules/.pnpm/lock.yaml", "lockfileVersion: 9\n");
    }
    expect(await fingerprintOf(join(dir.path, "one"))).toBe(
      await fingerprintOf(join(dir.path, "two/nested")),
    );
  });

  it("looks up from the project directory to the worktree root, not beyond", async () => {
    writeFile(dir.path, "node_modules/.package-lock.json", "{}");
    const worktree = join(dir.path, "wt");
    writeFile(worktree, "packages/app/src/a.ts", "");
    expect(await fingerprintOf(worktree, join(worktree, "packages/app"))).toBe("none");

    writeFile(worktree, "node_modules/.yarn-state.yml", "x");
    expect(await fingerprintOf(worktree, join(worktree, "packages/app"))).not.toBe("none");
  });
});
