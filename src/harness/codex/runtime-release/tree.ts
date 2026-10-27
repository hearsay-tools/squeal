import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RuntimeReleaseError } from "./errors.js";
import {
  checkNodeFloor,
  checkPathSet,
  checkPluginManifest,
  checkRuntimePath,
  isRuntimeVersion,
  PLUGIN_MANIFEST,
  parseRuntimeManifest,
  RUNTIME_MANIFEST,
  RUNTIME_SCHEMA,
  type RuntimeFileEntry,
  type RuntimeManifest,
  serializeRuntimeManifest,
} from "./manifest.js";

/*
 * Row 002-30: a runtime root on disk, read as the manifest's rules require.
 * The walk refuses symlinks, hard links and anything but regular files and
 * directories, so neither a manifest nor a staged tree can reach outside
 * its root. Modes are compared by their execute bit: a checkout under
 * umask 002 holds 0664 and 0775 for the manifest's 0644 and 0755.
 */

const invalid = (message: string): RuntimeReleaseError =>
  new RuntimeReleaseError("runtime", message);

export const sha256Of = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** The manifest mode of an on-disk mode: 0755 with any execute bit, else 0644. */
export const runtimeModeOf = (mode: number): number => (mode & 0o111 ? 0o755 : 0o644);

/** A regular file below a runtime root. */
interface TreeFile {
  readonly path: string;
  readonly full: string;
  readonly mode: number;
}

/** Every regular file below `root` but its top-level `runtime.json`, sorted by path. */
function walk(root: string): TreeFile[] {
  const top = lstatSync(root, { throwIfNoEntry: false });
  if (top === undefined || !top.isDirectory())
    throw invalid(`runtime root ${root} is not a directory`);
  const files: TreeFile[] = [];
  const visit = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = prefix === "" ? name : `${prefix}/${name}`;
      const full = join(dir, name);
      const stat = lstatSync(full);
      checkRuntimePath(path);
      if (stat.isDirectory()) visit(full, path);
      else if (stat.isSymbolicLink()) throw invalid(`runtime path ${path} is a symlink`);
      else if (!stat.isFile()) throw invalid(`runtime path ${path} is not a regular file`);
      else if (stat.nlink !== 1) throw invalid(`runtime file ${path} is a hard link`);
      else if (path !== RUNTIME_MANIFEST)
        files.push({ path, full, mode: runtimeModeOf(stat.mode) });
    }
  };
  visit(root, "");
  checkPathSet(files.map((file) => file.path));
  return files;
}

export interface CreateRuntimeManifestOptions {
  readonly root: string;
  readonly version: string;
  readonly nodeFloor: string;
}

/**
 * The manifest of every file below `root` (an existing `runtime.json`
 * excluded), with modes normalized to 0644 or 0755. Throws on an unsafe or
 * missing entry; it does not write `runtime.json`, the caller does with
 * `serializeRuntimeManifest`.
 */
export function createRuntimeManifest(options: CreateRuntimeManifestOptions): RuntimeManifest {
  if (!isRuntimeVersion(options.version))
    throw invalid(`invalid runtime version ${JSON.stringify(options.version)}`);
  const files: Record<string, RuntimeFileEntry> = {};
  for (const file of walk(options.root))
    files[file.path] = { sha256: sha256Of(readFileSync(file.full)), mode: file.mode };
  const manifest: RuntimeManifest = {
    schema: RUNTIME_SCHEMA,
    version: options.version,
    nodeFloor: options.nodeFloor,
    files,
  };
  // The parser holds the rules: schema, floor format, required entries, launcher mode.
  return parseRuntimeManifest(serializeRuntimeManifest(manifest));
}

export interface ValidateRuntimeTreeOptions {
  /** The version the tree must be, when the caller already knows it. */
  readonly expectedVersion?: string;
  /** The running Node, `process.versions.node` by default. */
  readonly nodeVersion?: string;
}

/**
 * Validates the whole tree at `root` against its `runtime.json`: canonical
 * manifest, the expected version, the Node floor, exactly the listed files
 * with their hashes and modes, no link or special file, and a plugin
 * manifest naming squeal at the same version. Returns the manifest.
 */
export function validateRuntimeTree(
  root: string,
  options: ValidateRuntimeTreeOptions = {},
): RuntimeManifest {
  const manifestPath = join(root, RUNTIME_MANIFEST);
  const stat = lstatSync(manifestPath, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile() || stat.nlink !== 1)
    throw invalid(`runtime root ${root} has no regular ${RUNTIME_MANIFEST}`);
  const manifest = parseRuntimeManifest(readFileSync(manifestPath, "utf8"));
  if (options.expectedVersion !== undefined && manifest.version !== options.expectedVersion)
    throw invalid(`runtime at ${root} is ${manifest.version}, expected ${options.expectedVersion}`);
  checkNodeFloor(manifest.nodeFloor, options.nodeVersion ?? process.versions.node);
  const files = walk(root);
  const listed = new Set(Object.keys(manifest.files));
  for (const file of files) {
    const entry = manifest.files[file.path];
    if (entry === undefined)
      throw invalid(`runtime file ${file.path} is not in ${RUNTIME_MANIFEST}`);
    listed.delete(file.path);
    if (entry.mode !== file.mode)
      throw invalid(
        `runtime file ${file.path} has mode ${file.mode.toString(8)}, listed ${entry.mode.toString(8)}`,
      );
    const bytes = readFileSync(file.full);
    if (sha256Of(bytes) !== entry.sha256)
      throw invalid(`runtime file ${file.path} does not match its sha256`);
    if (file.path === PLUGIN_MANIFEST)
      checkPluginManifest(bytes.toString("utf8"), manifest.version);
  }
  const missing = [...listed][0];
  if (missing !== undefined) throw invalid(`runtime file ${missing} is listed but missing`);
  return manifest;
}
