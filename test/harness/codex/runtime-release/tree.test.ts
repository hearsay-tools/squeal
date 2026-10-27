import { chmodSync, linkSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRuntimeManifest,
  LAUNCHER,
  parseRuntimeManifest,
  validateRuntimeTree,
} from "../../../../src/harness/codex/runtime-release/index.js";
import { failure, NODE_FLOOR, put, runtimeTree, writeManifest } from "./fixture.js";

/*
 * Row 002-30 (wave-4-contract.md "Runtime manifest"): a runtime tree on
 * disk is exactly its canonical `runtime.json`: no link, no unlisted or
 * changed file, and modes by their execute bit.
 */

const V = "0.1.900";

describe("createRuntimeManifest", () => {
  it("lists every file but runtime.json with modes normalized from the umask", () => {
    const root = runtimeTree(V);
    chmodSync(join(root, "dist/stop.mjs"), 0o664);
    chmodSync(join(root, "dist/cli/squeal.mjs"), 0o775);
    const manifest = createRuntimeManifest({ root, version: V, nodeFloor: NODE_FLOOR });
    expect(manifest.files["dist/stop.mjs"]?.mode).toBe(0o644);
    expect(manifest.files["dist/cli/squeal.mjs"]?.mode).toBe(0o755);
    expect(manifest.files["runtime.json"]).toBeUndefined();
    writeManifest(root, V);
    expect(validateRuntimeTree(root).version).toBe(V);
  });

  it.each([
    [
      "a symlink",
      (root: string) => symlinkSync("/etc/passwd", join(root, "dist/link.mjs")),
      "symlink",
    ],
    [
      "a hard link",
      (root: string) => linkSync(join(root, "dist/stop.mjs"), join(root, "dist/hard.mjs")),
      "hard link",
    ],
    ["a directory symlink", (root: string) => symlinkSync("/", join(root, "skills/up")), "symlink"],
    [
      "a name with a space",
      (root: string) => put(root, "dist/a b.mjs", "x"),
      "unsafe runtime path",
    ],
  ])("refuses %s", (_name, make, text) => {
    const root = runtimeTree(V);
    make(root);
    const error = failure(() => createRuntimeManifest({ root, version: V, nodeFloor: NODE_FLOOR }));
    expect(error.message).toContain(text);
    expect(failure(() => validateRuntimeTree(root)).message).toContain(text);
  });

  it("refuses an unsafe version or a missing required entry", () => {
    const root = runtimeTree(V);
    expect(
      failure(() => createRuntimeManifest({ root, version: "../x", nodeFloor: NODE_FLOOR })).code,
    ).toBe("runtime");
    rmSync(join(root, "dist/runtime.mjs"));
    expect(
      failure(() => createRuntimeManifest({ root, version: V, nodeFloor: NODE_FLOOR })).message,
    ).toContain("lacks dist/runtime.mjs");
    const plain = runtimeTree(V);
    chmodSync(join(plain, LAUNCHER), 0o644);
    expect(
      failure(() => createRuntimeManifest({ root: plain, version: V, nodeFloor: NODE_FLOOR }))
        .message,
    ).toContain("bin/squeal-launcher must have mode 0755");
  });
});

describe("validateRuntimeTree", () => {
  it.each([
    [
      "an unlisted file",
      (root: string) => put(root, "dist/extra.mjs", "x"),
      "is not in runtime.json",
    ],
    [
      "a changed byte",
      (root: string) => put(root, "dist/stop.mjs", "changed"),
      "does not match its sha256",
    ],
    [
      "a lost execute bit",
      (root: string) => chmodSync(join(root, LAUNCHER), 0o644),
      "has mode 644",
    ],
    [
      "a removed file",
      (root: string) => writeFileSync(join(root, "runtime.json"), withExtra(root)),
      "is listed but missing",
    ],
  ])("refuses %s", (_name, make, text) => {
    const root = runtimeTree(V);
    make(root);
    expect(failure(() => validateRuntimeTree(root)).message).toContain(text);
  });

  it("refuses a runtime of another version than expected", () => {
    const error = failure(() => validateRuntimeTree(runtimeTree(V), { expectedVersion: "0.2.0" }));
    expect(error.message).toContain("is 0.1.900, expected 0.2.0");
  });
});

/** `root`'s manifest with one more listed file that does not exist. */
function withExtra(root: string): string {
  const text = readFileSync(join(root, "runtime.json"), "utf8");
  const manifest = JSON.parse(text);
  manifest.files["dist/ghost.mjs"] = { sha256: "0".repeat(64), mode: 0o644 };
  const files = Object.fromEntries(
    Object.entries(manifest.files).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  return `${JSON.stringify({ ...manifest, files }, null, 2)}\n`;
}

describe("parseRuntimeManifest", () => {
  const text = (): string => readFileSync(join(runtimeTree(V), "runtime.json"), "utf8");

  it("accepts the canonical text", () => {
    expect(parseRuntimeManifest(text()).version).toBe(V);
  });

  it.each([
    [
      "a duplicate key",
      (t: string) =>
        t.replace('"files": {', '"files": {\n    "dist/stop.mjs": {"sha256": "", "mode": 420},'),
      "canonical",
    ],
    ["other spacing", (t: string) => JSON.stringify(JSON.parse(t)), "canonical"],
    [
      "uppercase hex",
      (t: string) =>
        t.replace(
          /"sha256": "([0-9a-f]{64})"/,
          (_m, h: string) => `"sha256": "${h.toUpperCase()}"`,
        ),
      "invalid sha256",
    ],
    [
      "itself listed",
      (t: string) =>
        t.replace(
          '"files": {',
          '"files": {\n    "runtime.json": {\n      "sha256": "x",\n      "mode": 420\n    },',
        ),
      "must not list itself",
    ],
    ["schema 2", (t: string) => t.replace('"schema": 1', '"schema": 2'), "unsupported schema 2"],
    [
      "an extra key",
      (t: string) => t.replace('"schema": 1,', '"schema": 1,\n  "signed": true,'),
      "exactly schema",
    ],
    [
      "an extra entry key",
      (t: string) => t.replace('"mode": 420', '"mode": 420, "link": "x"'),
      "exactly sha256 and mode",
    ],
    ["not JSON", (t: string) => t.slice(0, 20), "not JSON"],
  ])("refuses %s", (_name, edit, message) => {
    expect(failure(() => parseRuntimeManifest(edit(text()))).message).toContain(message);
  });
});
