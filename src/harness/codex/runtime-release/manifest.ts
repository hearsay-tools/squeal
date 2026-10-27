import { RuntimeReleaseError } from "./errors.js";

/*
 * Row 002-30, wave-4-contract.md "Runtime manifest": `runtime.json` lists
 * every other file of a runtime root with its SHA-256 and mode. This module
 * holds the pure rules: paths, modes, versions, the Node floor, the
 * required entries and the one canonical serialization. A manifest must be
 * byte-identical to its canonical form, so duplicate keys, which JSON.parse
 * would merge silently, and any second spelling are rejected.
 */

export const RUNTIME_MANIFEST = "runtime.json";
export const RUNTIME_SCHEMA = 1;
/** The only file modes a runtime may carry. */
export const RUNTIME_MODES: readonly number[] = [0o644, 0o755];

/** The ten hook entries of `plugins/codex/hooks/hooks.json`, as `dist/<name>.mjs`. */
export const HOOK_ENTRIES: readonly string[] = [
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
];

export const PLUGIN_MANIFEST = ".codex-plugin/plugin.json";
export const LAUNCHER = "bin/squeal-launcher";

/** Files every runtime root must list; the launcher must also be 0755. */
export const REQUIRED_ENTRIES: readonly string[] = [
  PLUGIN_MANIFEST,
  "dist/runtime.mjs",
  "dist/cli/squeal.mjs",
  LAUNCHER,
  "skills/squeal/SKILL.md",
  ...HOOK_ENTRIES.map((hook) => `dist/${hook}.mjs`),
];

export interface RuntimeFileEntry {
  readonly sha256: string;
  readonly mode: number;
}

export interface RuntimeManifest {
  readonly schema: 1;
  readonly version: string;
  /** The oldest Node the runtime runs on, `major.minor.patch`. */
  readonly nodeFloor: string;
  /** Every published file but `runtime.json`, keyed by relative path. */
  readonly files: Readonly<Record<string, RuntimeFileEntry>>;
}

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const FLOOR = /^(\d+)\.(\d+)\.(\d+)$/;
const SEGMENT = /^[A-Za-z0-9._@+-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_PATH = 1024;
const MAX_SEGMENT = 255;

const invalid = (message: string): RuntimeReleaseError =>
  new RuntimeReleaseError("runtime", message);

/** True for a version that is safe as one path component, `1.2.3[-pre]`. */
export function isRuntimeVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION.test(value);
}

/**
 * Throws unless `path` is a relative `/`-separated path of portable
 * segments: no absolute path, no `.` or `..`, no backslash, no empty
 * segment, no control or non-ASCII character.
 */
export function checkRuntimePath(path: string): void {
  const segments = path.split("/");
  const ok =
    path.length > 0 &&
    path.length <= MAX_PATH &&
    segments.every((s) => s !== "." && s !== ".." && s.length <= MAX_SEGMENT && SEGMENT.test(s));
  if (!ok) throw invalid(`unsafe runtime path ${JSON.stringify(path)}`);
}

/**
 * Throws when two paths collide: equal ignoring case, or one is a parent
 * directory of another. `paths` need not be sorted.
 */
export function checkPathSet(paths: readonly string[]): void {
  const folded = new Set<string>();
  for (const path of paths) {
    const key = path.toLowerCase();
    if (folded.has(key)) throw invalid(`duplicate runtime path ${JSON.stringify(path)}`);
    folded.add(key);
  }
  for (const path of paths) {
    const segments = path.toLowerCase().split("/");
    for (let i = 1; i < segments.length; i++) {
      const parent = segments.slice(0, i).join("/");
      if (folded.has(parent))
        throw invalid(`runtime path ${JSON.stringify(path)} lies under file ${parent}`);
    }
  }
}

/** Throws unless `mode` is 0644 or 0755. */
export function checkRuntimeMode(path: string, mode: unknown): asserts mode is number {
  if (typeof mode !== "number" || !RUNTIME_MODES.includes(mode))
    throw invalid(`runtime file ${path} has mode ${String(mode)}, not 0644 or 0755`);
}

const numbers = (version: string): number[] =>
  (version.match(/^v?(\d+)\.(\d+)\.(\d+)/)?.slice(1) ?? []).map(Number);

/** Throws `node` unless `nodeVersion` is at least `floor`. */
export function checkNodeFloor(floor: string, nodeVersion: string): void {
  const need = numbers(floor);
  const have = numbers(nodeVersion);
  for (let i = 0; i < 3; i++) {
    const a = have[i] ?? 0;
    const b = need[i] ?? 0;
    if (a > b) return;
    if (a < b)
      throw new RuntimeReleaseError(
        "node",
        `the runtime needs Node ${floor} or newer; this is Node ${nodeVersion}`,
      );
  }
}

/** The one serialization of a manifest: fixed key order, files sorted, 2-space JSON. */
export function serializeRuntimeManifest(manifest: RuntimeManifest): string {
  const files: Record<string, RuntimeFileEntry> = {};
  for (const path of Object.keys(manifest.files).sort()) {
    const entry = manifest.files[path] as RuntimeFileEntry;
    files[path] = { sha256: entry.sha256, mode: entry.mode };
  }
  const { schema, version, nodeFloor } = manifest;
  return `${JSON.stringify({ schema, version, nodeFloor, files }, null, 2)}\n`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/**
 * Parses and validates `text` as a canonical `runtime.json`: schema 1, a
 * safe version, a `major.minor.patch` Node floor, safe colliding-free paths
 * with lowercase SHA-256 and an allowed mode, every required entry, a 0755
 * launcher, and the text equal to `serializeRuntimeManifest` of the result.
 */
export function parseRuntimeManifest(text: string): RuntimeManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw invalid(`${RUNTIME_MANIFEST} is not JSON: ${(error as Error).message}`);
  }
  if (!isObject(value) || !hasKeys(value, ["schema", "version", "nodeFloor", "files"]))
    throw invalid(`${RUNTIME_MANIFEST} must hold exactly schema, version, nodeFloor and files`);
  if (value.schema !== RUNTIME_SCHEMA)
    throw invalid(`${RUNTIME_MANIFEST} has unsupported schema ${JSON.stringify(value.schema)}`);
  if (!isRuntimeVersion(value.version))
    throw invalid(`${RUNTIME_MANIFEST} has invalid version ${JSON.stringify(value.version)}`);
  if (typeof value.nodeFloor !== "string" || !FLOOR.test(value.nodeFloor))
    throw invalid(
      `${RUNTIME_MANIFEST} has unsupported Node floor ${JSON.stringify(value.nodeFloor)}`,
    );
  if (!isObject(value.files)) throw invalid(`${RUNTIME_MANIFEST} files must be an object`);
  const files: Record<string, RuntimeFileEntry> = {};
  for (const [path, entry] of Object.entries(value.files)) {
    checkRuntimePath(path);
    if (path === RUNTIME_MANIFEST) throw invalid(`${RUNTIME_MANIFEST} must not list itself`);
    if (!isObject(entry) || !hasKeys(entry, ["sha256", "mode"]))
      throw invalid(`${RUNTIME_MANIFEST} entry ${path} must hold exactly sha256 and mode`);
    if (typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256))
      throw invalid(`${RUNTIME_MANIFEST} entry ${path} has an invalid sha256`);
    checkRuntimeMode(path, entry.mode);
    files[path] = { sha256: entry.sha256, mode: entry.mode };
  }
  checkPathSet(Object.keys(files));
  for (const path of REQUIRED_ENTRIES)
    if (files[path] === undefined) throw invalid(`runtime ${value.version} lacks ${path}`);
  if (files[LAUNCHER]?.mode !== 0o755) throw invalid(`${LAUNCHER} must have mode 0755`);
  const manifest: RuntimeManifest = {
    schema: RUNTIME_SCHEMA,
    version: value.version,
    nodeFloor: value.nodeFloor,
    files,
  };
  if (serializeRuntimeManifest(manifest) !== text)
    throw invalid(
      `${RUNTIME_MANIFEST} is not in canonical form (duplicate keys, order or spacing)`,
    );
  return manifest;
}

/**
 * Throws unless `text`, the bytes of `.codex-plugin/plugin.json`, names the
 * plugin `squeal` at `version`, so the runtime's own manifest cannot
 * disagree with `runtime.json`.
 */
export function checkPluginManifest(text: string, version: string): void {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw invalid(`${PLUGIN_MANIFEST} is not JSON`);
  }
  if (!isObject(value) || value.name !== "squeal" || value.version !== version)
    throw invalid(`${PLUGIN_MANIFEST} must name squeal at version ${version}`);
}
