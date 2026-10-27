import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  createRuntimeManifest,
  HOOK_ENTRIES,
  RuntimeReleaseError,
  serializeRuntimeManifest,
} from "../../../../src/harness/codex/runtime-release/index.js";
import { tempDir } from "../../../store/helpers.js";

/*
 * Row 002-30: a runtime-shaped tree as wave-4-contract.md lays it out, the
 * plugin manifest, `runtime.json`, the dispatch entry, the ten hook entries,
 * the CLI, the launcher, a skill and a binary asset, in a fresh directory.
 */

export const NODE_FLOOR = "22.19.0";

/** Writes `text` at `root/path` with `mode`, making its parents. */
export function put(root: string, path: string, text: string | Buffer, mode = 0o644): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  chmodSync(file, mode);
}

/** Writes the canonical `runtime.json` of `root`'s files. */
export function writeManifest(root: string, version: string, nodeFloor = NODE_FLOOR): void {
  const manifest = createRuntimeManifest({ root, version, nodeFloor });
  put(root, "runtime.json", serializeRuntimeManifest(manifest));
}

/** A complete runtime tree of `version`, its `runtime.json` written. */
export function runtimeTree(version = "0.1.900"): string {
  const root = join(tempDir("squeal-runtime-src-"), "runtime");
  put(root, ".codex-plugin/plugin.json", `${JSON.stringify({ name: "squeal", version })}\n`);
  put(root, "dist/runtime.mjs", "export async function run() {}\n");
  for (const hook of HOOK_ENTRIES) put(root, `dist/${hook}.mjs`, `// ${hook} ${version}\n`);
  put(root, "dist/cli/squeal.mjs", "#!/usr/bin/env node\nconsole.log('squeal');\n", 0o755);
  put(root, "bin/squeal-launcher", '#!/bin/sh\nexec node "$0/../../dist/cli/squeal.mjs"\n', 0o755);
  put(root, "skills/squeal/SKILL.md", "# Squeal\n");
  put(root, "dist/code/grammar.wasm", Buffer.from(Array.from({ length: 256 }, (_, i) => i)));
  writeManifest(root, version);
  return root;
}

/** Every file below `root`: relative path to `{mode, bytes}`. */
export function snapshot(root: string): Map<string, { mode: number; bytes: string }> {
  const out = new Map<string, { mode: number; bytes: string }>();
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, path);
      else
        out.set(path, {
          mode: statSync(full).mode & 0o7777,
          bytes: readFileSync(full).toString("base64"),
        });
    }
  };
  walk(root, "");
  return out;
}

/** A file record of the artifact envelope. */
export interface Rec {
  path: string;
  mode: number;
  data: string;
  [key: string]: unknown;
}

/** The envelope of `root`'s files, built by hand so a test can corrupt it. */
export function envelopeOf(
  root: string,
  version: string,
): { schema: 1; version: string; files: Rec[] } {
  const files = [...snapshot(root)]
    .map(([path, { mode, bytes }]) => ({ path, mode: mode & 0o111 ? 0o755 : 0o644, data: bytes }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  return { schema: 1, version, files };
}

/** Gzips a JSON value as an artifact. */
export function gz(value: unknown): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(value)));
}

/** The error `fn` throws, which must be a `RuntimeReleaseError`. */
export function failure(fn: () => unknown): RuntimeReleaseError {
  try {
    fn();
  } catch (error) {
    if (error instanceof RuntimeReleaseError) return error;
    throw error;
  }
  throw new Error("expected a RuntimeReleaseError");
}

/** The error `promise` rejects with, which must be a `RuntimeReleaseError`. */
export async function rejection(promise: Promise<unknown>): Promise<RuntimeReleaseError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RuntimeReleaseError) return error;
    throw error;
  }
  throw new Error("expected a RuntimeReleaseError");
}
