import { createHash } from "node:crypto";
import { readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compare } from "../../src/core/fs/index.js";
import { KEY_FORMAT_VERSION, KEY_SOURCES_HASHES } from "../../src/core/keys/index.js";
import { tempDir, writeFile } from "../hash/git-repo.js";

const ROOT = join(import.meta.dirname, "../..");

/**
 * The sources that decide what a key names or what result is stored under it
 * (task 001-199): key building and file hashing; every runner adapter, for
 * closures, environments, results and the stale-transform guards; the
 * scheduler's declared inputs, environment-growth gate and observed-input
 * growth; the composite runner, which merges observed inputs and reports;
 * and the policy parsers for `inputs` and `slow.include`. A directory covers
 * every file below it, a new one included. `src/core/slow/inherit.ts` is out:
 * it decides at lookup time, never what a key holds.
 */
const KEY_SOURCES: readonly string[] = [
  "src/core/keys",
  "src/core/hash",
  "src/runners",
  "src/core/scheduler/keying.ts",
  "src/core/scheduler/environment-growth.ts",
  "src/core/scheduler/observed.ts",
  "src/core/daemon/composite-runner.ts",
  "src/core/daemon/policy.ts",
  "src/core/daemon/policy-slow.ts",
  "src/core/daemon/policy-node-test.ts",
];

/** The file holding the pin, left out so pinning a hash does not change it. */
const PIN = "src/core/keys/key-format.ts";

function filesBelow(root: string, path: string): string[] {
  if (!statSync(join(root, path)).isDirectory()) return [path];
  return readdirSync(join(root, path), { recursive: true, encoding: "utf8" })
    .map((entry) => `${path}/${entry.split("\\").join("/")}`)
    .filter((entry) => statSync(join(root, entry)).isFile());
}

/** Paths and contents, line endings normalized so a CRLF checkout hashes alike. */
function keySourcesHash(root = ROOT): string {
  const files = [...new Set(KEY_SOURCES.flatMap((path) => filesBelow(root, path)))]
    .filter((path) => path !== PIN)
    .sort(compare);
  const hash = createHash("sha256");
  for (const path of files) {
    const text = readFileSync(join(root, path), "utf8").replaceAll("\r\n", "\n");
    hash.update(`${path}\0${Buffer.byteLength(text)}\0`).update(text);
  }
  return hash.digest("hex");
}

describe("KEY_FORMAT_VERSION", () => {
  it("is bumped whenever the key-relevant sources change", () => {
    const current = keySourcesHash();
    expect(
      KEY_SOURCES_HASHES[KEY_FORMAT_VERSION],
      `the key-relevant sources changed: bump KEY_FORMAT_VERSION in ${PIN} ` +
        `and pin "${current}" under the new version in KEY_SOURCES_HASHES`,
    ).toBe(current);
  });

  it("pins one distinct hash per version, 1 to the current one", () => {
    const versions = Object.keys(KEY_SOURCES_HASHES).map(Number);
    expect(versions).toEqual(Array.from({ length: KEY_FORMAT_VERSION }, (_, i) => i + 1));
    expect(new Set(Object.values(KEY_SOURCES_HASHES)).size).toBe(versions.length);
  });
});

describe("the key-relevant sources' hash", () => {
  let dir: ReturnType<typeof tempDir>;
  beforeEach(() => {
    dir = tempDir();
    for (const path of KEY_SOURCES) {
      if (path.endsWith(".ts")) writeFile(dir.path, path, "export {};\n");
      else writeFile(dir.path, `${path}/a.ts`, "export {};\n");
    }
    writeFile(dir.path, PIN, "export const KEY_FORMAT_VERSION = 1;\n");
  });
  afterEach(() => dir.cleanup());

  it("changes with a new covered file, a covered file's content and a rename", () => {
    const before = keySourcesHash(dir.path);
    writeFile(dir.path, "src/runners/vitest/results.ts", "export const a = 1;\n");
    const added = keySourcesHash(dir.path);
    expect(added).not.toBe(before);
    writeFile(dir.path, "src/core/scheduler/keying.ts", "export const b = 1;\n");
    const edited = keySourcesHash(dir.path);
    expect(edited).not.toBe(added);
    renameSync(join(dir.path, "src/core/keys/a.ts"), join(dir.path, "src/core/keys/b.ts"));
    expect(keySourcesHash(dir.path)).not.toBe(edited);
  });

  it("ignores the pin, files outside the list and line endings", () => {
    const before = keySourcesHash(dir.path);
    writeFile(dir.path, PIN, "export const KEY_FORMAT_VERSION = 2;\n");
    writeFile(dir.path, "src/core/slow/inherit.ts", "export const c = 1;\n");
    writeFile(dir.path, "src/core/hash/a.ts", "export {};\r\n");
    expect(keySourcesHash(dir.path)).toBe(before);
  });
});
