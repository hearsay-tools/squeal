import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA, VERSION } from "./layout.js";

/*
 * Spec 002 D9 and `tasks/wave-4-contract.md` "Runtime manifest and staged
 * artifact": a runtime root's identity is its `runtime.json`, never the fixed
 * plugin's manifest. Publication validates the whole tree (`verifyTree`); a
 * hook reads identity and required entries only (`checkRoot`).
 */

export const RUNTIME_MANIFEST = "runtime.json";
export const PLUGIN_MANIFEST = ".codex-plugin/plugin.json";
/** The side-effect-free dispatch entry the adapter imports in-process. */
export const RUNTIME_ENTRY = "dist/runtime.mjs";

/** The ten hook entries, by the names `plugins/codex/hooks/hooks.json` gives them. */
export const RUNTIME_HOOKS = [
  "session-start",
  "user-prompt-submit",
  "pre-tool-use",
  "post-tool-use",
  "stop",
  "stop-slow",
  "subagent-start",
  "subagent-stop",
  "interrupt",
  "session-end",
] as const;

/** What every runtime root holds besides `runtime.json`. */
export const REQUIRED_ENTRIES: readonly string[] = [
  PLUGIN_MANIFEST,
  RUNTIME_ENTRY,
  "dist/cli/squeal.mjs",
  ...RUNTIME_HOOKS.map((name) => `dist/${name}.mjs`),
  "skills/squeal/SKILL.md",
  "bin/squeal-launcher",
];

const MODES: ReadonlySet<number> = new Set([0o644, 0o755]);
const SHA256 = /^[0-9a-f]{64}$/;
/** `major.minor.patch`, as row 002-30's artifact validation requires. */
const NODE_FLOOR = /^\d+\.\d+\.\d+$/;
const LAUNCHER = "bin/squeal-launcher";

export interface RuntimeFile {
  readonly sha256: string;
  readonly mode: number;
}

export interface RuntimeManifest {
  readonly schema: 1;
  readonly version: string;
  readonly nodeFloor: string;
  readonly files: Readonly<Record<string, RuntimeFile>>;
}

export type RuntimeErrorKind =
  | "invalid-runtime"
  | "version-conflict"
  | "unsupported-node"
  | "missing-pinned-runtime"
  | "invalid-pin"
  | "no-runtime"
  | "unwritable-data";

/** A runtime that cannot be published or selected, with what to do about it. */
export class RuntimeError extends Error {
  constructor(
    readonly kind: RuntimeErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

const invalid = (root: string, detail: string) =>
  new RuntimeError("invalid-runtime", `${root} is no valid Squeal runtime: ${detail}`);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether Node `node` (`process.versions.node`) is at least `floor`. */
export function meetsFloor(node: string, floor: string): boolean {
  const have = node.split(".").map(Number);
  const need = floor.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const a = have[i] ?? 0;
    const b = need[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

/**
 * A relative path of regular-file inventory: `/` separators, no empty, `.`
 * or `..` segment, no backslash, not absolute, not `runtime.json` itself.
 */
export function isInventoryPath(path: string): boolean {
  if (path === RUNTIME_MANIFEST || path.includes("\\") || path.startsWith("/")) return false;
  return path.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

/** Parses `runtime.json` text of `root`; throws `invalid-runtime` for any other shape. */
export function parseManifest(root: string, text: string): RuntimeManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw invalid(root, `${RUNTIME_MANIFEST} is not JSON`);
  }
  if (!isObject(value) || value.schema !== SCHEMA) {
    throw invalid(root, `${RUNTIME_MANIFEST} has no supported schema`);
  }
  const { version, nodeFloor, files } = value;
  if (typeof version !== "string" || !VERSION.test(version)) {
    throw invalid(root, `${RUNTIME_MANIFEST} names no plain version`);
  }
  if (typeof nodeFloor !== "string" || !NODE_FLOOR.test(nodeFloor)) {
    throw invalid(root, `${RUNTIME_MANIFEST} names no supported Node floor`);
  }
  const inventory = parseInventory(root, files);
  for (const required of REQUIRED_ENTRIES) {
    if (inventory[required] === undefined) throw invalid(root, `${required} is missing`);
  }
  if (inventory[LAUNCHER]?.mode !== 0o755) throw invalid(root, `${LAUNCHER} must have mode 0755`);
  const manifest: RuntimeManifest = { schema: SCHEMA, version, nodeFloor, files: inventory };
  // One spelling, which also refuses the duplicate keys `JSON.parse` merges (row 002-30).
  if (serializeManifest(manifest) !== text) {
    throw invalid(root, `${RUNTIME_MANIFEST} is not in its canonical form`);
  }
  return manifest;
}

/** The `files` of `runtime.json`: safe paths, each with a SHA-256 and an allowed mode. */
function parseInventory(root: string, files: unknown): Record<string, RuntimeFile> {
  if (!isObject(files)) throw invalid(root, `${RUNTIME_MANIFEST} has no file inventory`);
  const inventory: Record<string, RuntimeFile> = {};
  for (const [path, entry] of Object.entries(files)) {
    if (!isInventoryPath(path)) {
      throw invalid(root, `unsafe inventory path ${JSON.stringify(path)}`);
    }
    if (!isObject(entry) || typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256)) {
      throw invalid(root, `${path} has no SHA-256`);
    }
    if (typeof entry.mode !== "number" || !MODES.has(entry.mode)) {
      throw invalid(root, `${path} has a mode other than 0644 or 0755`);
    }
    inventory[path] = { sha256: entry.sha256, mode: entry.mode };
  }
  return inventory;
}

/**
 * `runtime.json`'s one spelling, the rule of row 002-30's
 * `serializeRuntimeManifest`: keys `schema`, `version`, `nodeFloor`, `files`
 * in that order, files sorted by path, each `{ sha256, mode }`, 2-space JSON
 * and a final newline. A copy, since the adapter ships frozen.
 */
export function serializeManifest(manifest: RuntimeManifest): string {
  const files: Record<string, RuntimeFile> = {};
  for (const path of Object.keys(manifest.files).sort()) {
    const entry = manifest.files[path] as RuntimeFile;
    files[path] = { sha256: entry.sha256, mode: entry.mode };
  }
  const { schema, version, nodeFloor } = manifest;
  return `${JSON.stringify({ schema, version, nodeFloor, files }, null, 2)}\n`;
}

/** The version `root`'s plugin manifest names, after checking it is Squeal's. */
function pluginVersion(root: string): string {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(root, PLUGIN_MANIFEST), "utf8"));
  } catch {
    throw invalid(root, `${PLUGIN_MANIFEST} is missing or not JSON`);
  }
  if (!isObject(value) || value.name !== "squeal" || typeof value.version !== "string") {
    throw invalid(root, `${PLUGIN_MANIFEST} does not name squeal and a version`);
  }
  return value.version;
}

/** `runtime.json` of `root`, read and parsed: its text too, for exact comparison. */
export function readManifest(root: string): { manifest: RuntimeManifest; text: string } {
  let text: string;
  try {
    text = readFileSync(join(root, RUNTIME_MANIFEST), "utf8");
  } catch {
    throw invalid(root, `${RUNTIME_MANIFEST} is missing`);
  }
  return { manifest: parseManifest(root, text), text };
}

/**
 * A hook's check of `root`: its runtime and plugin manifests both name
 * `expected` (or agree, when `expected` is `null`), Node `node` meets its
 * floor, and every required entry is a regular file. Reads no bundle bytes.
 * Returns the manifest; throws a `RuntimeError` naming what failed.
 */
export function checkRoot(root: string, expected: string | null, node: string): RuntimeManifest {
  const { manifest } = readManifest(root);
  const named = pluginVersion(root);
  if (named !== manifest.version) {
    throw invalid(
      root,
      `${PLUGIN_MANIFEST} names ${named}, ${RUNTIME_MANIFEST} ${manifest.version}`,
    );
  }
  if (expected !== null && manifest.version !== expected) {
    throw invalid(root, `it holds runtime ${manifest.version}, not ${expected}`);
  }
  if (!meetsFloor(node, manifest.nodeFloor)) {
    throw new RuntimeError(
      "unsupported-node",
      `Squeal runtime ${manifest.version} needs Node ${manifest.nodeFloor} or later; this hook runs Node ${node}.`,
    );
  }
  for (const entry of REQUIRED_ENTRIES) {
    if (!isRegularFile(join(root, entry))) throw invalid(root, `${entry} is missing`);
  }
  return manifest;
}

function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Every regular file under `root` by relative `/` path. Throws for a symlink,
 * a hard-linked file, or any other entry type: publication copies no tree it
 * cannot read as plain, independent files.
 */
export function listTree(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(path, rel);
      else if (!stat.isFile()) throw invalid(root, `${rel} is not a regular file or directory`);
      else if (stat.nlink > 1) throw invalid(root, `${rel} is hard-linked`);
      else files.push(rel);
    }
  };
  walk(root, "");
  return files;
}

/**
 * Publication's check of a whole tree: identity, every listed file and no
 * other, plain files only. Bytes are checked by the caller, which hashes what
 * it copies (`store.ts`), or by `verifyBytes`.
 */
export function verifyTree(
  root: string,
  node: string,
): { manifest: RuntimeManifest; text: string; files: string[] } {
  const { manifest, text } = readManifest(root);
  checkRoot(root, manifest.version, node);
  const files = listTree(root).filter((f) => f !== RUNTIME_MANIFEST);
  const listed = Object.keys(manifest.files);
  const extra = files.find((f) => manifest.files[f] === undefined);
  if (extra !== undefined) throw invalid(root, `${extra} is not in ${RUNTIME_MANIFEST}`);
  const missing = listed.find((f) => !files.includes(f));
  if (missing !== undefined) throw invalid(root, `${missing} is missing`);
  return { manifest, text, files };
}

/** The SHA-256 `sha` of `path`'s bytes against its inventory entry; throws when it differs. */
export function checkBytes(root: string, manifest: RuntimeManifest, path: string, sha: string) {
  if (manifest.files[path]?.sha256 !== sha)
    throw invalid(root, `${path} does not match its SHA-256`);
}

/** Whether two manifests describe the same payload. */
export function samePayload(a: RuntimeManifest, b: RuntimeManifest): boolean {
  const keys = Object.keys(a.files).sort();
  if (a.version !== b.version || a.nodeFloor !== b.nodeFloor) return false;
  if (keys.join("\n") !== Object.keys(b.files).sort().join("\n")) return false;
  return keys.every(
    (k) => a.files[k]?.sha256 === b.files[k]?.sha256 && a.files[k]?.mode === b.files[k]?.mode,
  );
}
