import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { type EnvironmentAtInput, environmentAt } from "../../src/core/commit/at-environment.js";
import {
  installedLockText,
  installedPart,
  type LockfileSides,
  readLockfileSides,
  runnerPins,
} from "../../src/core/commit/at-environment-lockfile.js";
import { committedBlobs } from "../../src/core/commit/tree.js";
import type { EnvironmentDescriptor } from "../../src/core/keys/environment-descriptor.js";
import type { StoredEnvironment } from "../../src/core/store/environments.js";
import { git } from "../hash/git-repo.js";

/*
 * Spec 023 D2.2 (row 023-03): one project's environment hash at a commit
 * from git objects and stored descriptors. Step 1 (equal runner files and
 * lockfile), step 2 (a stored environment with the commit's installed part,
 * refused for a project with a config-only difference), step 3 (derived from
 * this worktree's inputs), step 4 (not determined), and npm stopping at
 * step 1.
 */

/** A pnpm 12 committed lockfile: the manager's document, then the install's. */
function lock(vitest: string, extra = "left-pad@1.3.0"): string {
  const [name, version] = extra.split("@") as [string, string];
  const installed = [
    "lockfileVersion: '9.0'",
    "",
    "settings:",
    "  autoInstallPeers: true",
    "  excludeLinksFromLockfile: false",
    "",
    "importers:",
    "",
    "  .:",
    "    devDependencies:",
    `      ${name}:`,
    `        specifier: ^${version}`,
    `        version: ${version}`,
    "      vitest:",
    `        specifier: ^${vitest}`,
    `        version: ${vitest}(@types/node@22.0.0)`,
    "",
    "packages:",
    "",
    `  ${name}@${version}:`,
    `    resolution: {integrity: sha512-${name}${version}}`,
    "",
    `  vitest@${vitest}:`,
    `    resolution: {integrity: sha512-vitest${vitest}}`,
    "",
    "snapshots:",
    "",
    `  ${name}@${version}: {}`,
    "",
    `  vitest@${vitest}(@types/node@22.0.0): {}`,
    "",
  ].join("\n");
  const manager = "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    configDependencies: {}\n";
  return `---\n${manager}---\n${installed}`;
}

const OLD = lock("5.0.3", "left-pad@1.3.0");
const NEW = lock("5.0.3", "left-pad@1.4.0");
const CONFIG = "vitest.config.ts";

function descriptor(over: Partial<EnvironmentDescriptor> = {}): EnvironmentDescriptor {
  return {
    keyFormat: 30,
    project: "",
    runnerName: "vitest",
    runnerVersion: "5.0.3",
    adapterVersion: "7",
    nodeVersion: "v26.13.0",
    platform: "linux",
    arch: "x64",
    installedDependencies: installedPart(NEW) ?? "",
    env: { names: [], hash: "env" },
    config: { root: "c1" },
    files: [[CONFIG, "config-1"]],
    ci: false,
    ...over,
  };
}

function stored(hash: string, over: Partial<EnvironmentDescriptor> = {}): StoredEnvironment {
  return { project: "", hash, descriptor: descriptor(over), recordedAt: 0 };
}

function sides(here: string, there: string): LockfileSides {
  return {
    path: "pnpm-lock.yaml",
    manager: "pnpm",
    here: `blob-${here.length}-${here === NEW ? "new" : "old"}`,
    there: `blob-${there.length}-${there === NEW ? "new" : "old"}`,
    hereText: here,
    thereText: there,
  };
}

/** This worktree at `NEW`'s lockfile, its environment `here`. */
function input(over: Partial<EnvironmentAtInput>): EnvironmentAtInput {
  const here = stored("here");
  return {
    here,
    stored: [here],
    blobs: new Map([[CONFIG, "config-1"]]),
    lockfile: sides(NEW, NEW),
    ...over,
  };
}

describe("installed part from the committed lockfile (D2.2 step 2)", () => {
  it("reads pnpm 12's second document and the runner it pins", () => {
    expect(installedLockText(OLD)).toMatch(/^lockfileVersion: '9.0'\n\nsettings:/);
    expect(installedLockText("lockfileVersion: '9.0'\n")).toBeNull();
    expect(installedPart(OLD)).not.toBe(installedPart(NEW));
    expect(runnerPins(OLD, "vitest")).toEqual(["5.0.3"]);
    expect(runnerPins(OLD, "node:test")).toEqual([]);
  });
});

describe("environmentAt (spec 023 D2.2)", () => {
  it("step 1: equal runner files and lockfile give this worktree's hash", () => {
    expect(environmentAt(input({}))).toEqual({ hash: "here", step: 1 });
  });

  it("step 2: a lockfile-only change gives the stored environment's hash", () => {
    const old = stored("old", { installedDependencies: installedPart(OLD) ?? "" });
    const other = stored("other-node", {
      installedDependencies: installedPart(OLD) ?? "",
      nodeVersion: "v24.22.1",
    });
    const at = environmentAt(
      input({ stored: [stored("here"), old, other], lockfile: sides(NEW, OLD) }),
    );
    expect(at).toEqual({ hash: "old", step: 2 });
  });

  it("step 2: two stored matches are not determined", () => {
    const a = stored("a", { installedDependencies: installedPart(OLD) ?? "" });
    const b = stored("b", {
      installedDependencies: installedPart(OLD) ?? "",
      runnerVersion: "5.0.2",
    });
    const at = environmentAt(input({ stored: [stored("here"), a, b], lockfile: sides(NEW, OLD) }));
    expect(at).toEqual({ notDetermined: "more than one stored environment matches" });
  });

  it("refuses a project with a config-only difference: not determined (environment)", () => {
    // The commit's config file differs, and one stored environment matches it.
    const blobs = new Map([[CONFIG, "config-0"]]);
    const old = stored("old", {
      installedDependencies: installedPart(OLD) ?? "",
      files: [[CONFIG, "config-0"]],
    });
    expect(
      environmentAt(input({ stored: [stored("here"), old], blobs, lockfile: sides(NEW, OLD) })),
    ).toEqual({ hash: "old", step: 2 });
    // The same inputs as `here` under another hash: the config reads more than its files.
    const other = stored("here-ci", { config: { root: "c2" } });
    const at = environmentAt(
      input({ stored: [stored("here"), other, old], blobs, lockfile: sides(NEW, OLD) }),
    );
    expect(at).toEqual({ notDetermined: "runner files differ" });
  });

  it("step 3: only the lockfile differs, never recorded, derived from this worktree's inputs", () => {
    const rehash = (installed: string) => `derived:${installed}`;
    const at = environmentAt(input({ lockfile: sides(NEW, OLD), rehash }));
    expect(at).toEqual({ hash: `derived:${installedPart(OLD)}`, step: 3 });
    expect(environmentAt(input({ lockfile: sides(NEW, OLD) }))).toEqual({
      notDetermined: "the lockfile differs",
    });
    const bumped = lock("5.0.4", "left-pad@1.4.0");
    expect(environmentAt(input({ lockfile: sides(NEW, bumped), rehash }))).toEqual({
      notDetermined: "the lockfile changes the runner",
    });
  });

  it("step 3 needs this worktree installed from its own lockfile", () => {
    const stale = stored("here", { installedDependencies: "stale-folders" });
    const at = environmentAt(
      input({ here: stale, stored: [stale], lockfile: sides(NEW, OLD), rehash: () => "x" }),
    );
    expect(at).toEqual({
      notDetermined: "this worktree's install is not its lockfile's whole fingerprint",
    });
  });

  it("npm and Yarn lockfiles stop at step 1", () => {
    const npm: LockfileSides = {
      path: "package-lock.json",
      manager: "other",
      here: "a",
      there: "a",
      hereText: null,
      thereText: null,
    };
    expect(environmentAt(input({ lockfile: npm }))).toEqual({ hash: "here", step: 1 });
    expect(environmentAt(input({ lockfile: { ...npm, there: "b" } }))).toEqual({
      notDetermined: "the lockfile differs",
    });
  });

  it("is not determined without this worktree's environment", () => {
    expect(environmentAt(input({ here: null }))).toEqual({
      notDetermined: "no environment recorded for this worktree",
    });
  });
});

describe("the committed lockfile through git (D2.2, row 023-03 done-when b)", () => {
  it("a lockfile-only change gives the stored environment's hash", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-at-environment-")));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "packages/web"), { recursive: true });
    writeFileSync(join(root, CONFIG), "export default {};\n");
    writeFileSync(join(root, "pnpm-lock.yaml"), OLD);
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-qm", "old lockfile"]);
    const first = git(root, ["rev-parse", "HEAD"]).trim();
    writeFileSync(join(root, "pnpm-lock.yaml"), NEW);
    git(root, ["commit", "-qam", "new lockfile"]);

    const blobs = await committedBlobs(root, first);
    // A project folder below the root finds the root's lockfile.
    const lockfile = await readLockfileSides(root, "packages/web", blobs, "sha1");
    expect(lockfile).toMatchObject({ path: "pnpm-lock.yaml", manager: "pnpm" });
    expect(lockfile.here).not.toBe(lockfile.there);
    expect(lockfile.thereText).toBe(OLD);
    expect(lockfile.hereText).toBe(NEW);

    const config = blobs.get(CONFIG) ?? null;
    const here = stored("here", { files: [[CONFIG, config]] });
    const old = stored("old", {
      installedDependencies: installedPart(OLD) ?? "",
      files: [[CONFIG, config]],
    });
    expect(environmentAt({ here, stored: [here, old], blobs, lockfile })).toEqual({
      hash: "old",
      step: 2,
    });
    const atHead = await committedBlobs(root, "HEAD");
    const same = await readLockfileSides(root, "", atHead, "sha1");
    expect(environmentAt({ here, stored: [here, old], blobs: atHead, lockfile: same })).toEqual({
      hash: "here",
      step: 1,
    });
  });
});
