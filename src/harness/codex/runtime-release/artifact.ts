import { readFileSync } from "node:fs";
import { join } from "node:path";
import { constants, gunzipSync, gzipSync } from "node:zlib";
import { RuntimeReleaseError } from "./errors.js";
import {
  checkNodeFloor,
  checkPathSet,
  checkPluginManifest,
  checkRuntimeMode,
  checkRuntimePath,
  isRuntimeVersion,
  PLUGIN_MANIFEST,
  parseRuntimeManifest,
  RUNTIME_MANIFEST,
  type RuntimeManifest,
} from "./manifest.js";
import { sha256Of, validateRuntimeTree } from "./tree.js";

/*
 * Row 002-30, wave-4-contract.md "Runtime manifest and staged artifact": the
 * artifact is a gzip-compressed JSON envelope `{schema, version, files}`
 * whose files are `{path, mode, data}` records of base64 regular-file
 * bytes, sorted by path, `runtime.json` among them. No link or directory
 * record exists, and a record with any other key is refused. Every bound
 * is checked in memory before a byte is staged.
 */

export const ARTIFACT_SCHEMA = 1;

export interface RuntimeArtifactLimits {
  /** Compressed artifact bytes. */
  readonly maxArtifactBytes: number;
  /** Decompressed envelope bytes. */
  readonly maxEnvelopeBytes: number;
  /** File records, `runtime.json` included. */
  readonly maxFiles: number;
  /** Decoded bytes of one file. */
  readonly maxFileBytes: number;
  /** Decoded bytes of all files together. */
  readonly maxTotalBytes: number;
}

/**
 * Bounds at least 12 times the 0.1.366 Codex plugin packed as a runtime
 * (39 files, 10.6 MB decoded, largest 3.2 MB, envelope 14.1 MB, artifact
 * 3.6 MB), far below what one Node string can hold.
 */
export const DEFAULT_RUNTIME_LIMITS: RuntimeArtifactLimits = {
  maxArtifactBytes: 64 * 2 ** 20,
  maxEnvelopeBytes: 192 * 2 ** 20,
  maxFiles: 2048,
  maxFileBytes: 64 * 2 ** 20,
  maxTotalBytes: 128 * 2 ** 20,
};

/** One decoded regular file of a runtime. */
export interface RuntimeFile {
  readonly path: string;
  readonly mode: number;
  readonly bytes: Buffer;
}

/** A decoded, validated artifact: its manifest and every file, `runtime.json` included. */
export interface DecodedRuntime {
  readonly version: string;
  readonly manifest: RuntimeManifest;
  readonly files: readonly RuntimeFile[];
}

export interface PackedRuntime {
  readonly version: string;
  /** The canonical envelope JSON: the same for the same tree on any platform. */
  readonly envelope: Buffer;
  /** The gzip artifact, `squeal-codex-runtime.json.gz`. */
  readonly artifact: Buffer;
  /** SHA-256 of `artifact`, lowercase hex. */
  readonly sha256: string;
}

/** gzip's OS byte (RFC 1952): "unknown", so the header does not name the build host. */
const GZIP_OS_UNKNOWN = 255;

/**
 * Validates the tree at `root` (`validateRuntimeTree`) and packs it. The
 * envelope is canonical; the gzip bytes are fixed for one zlib build (level
 * 9, no name, zero mtime, unknown OS), so a reproducibility check across
 * machines compares `envelope`, and the descriptor binds `artifact` as
 * published.
 */
export function packRuntime(root: string, nodeVersion?: string): PackedRuntime {
  const manifest = validateRuntimeTree(root, nodeVersion === undefined ? {} : { nodeVersion });
  const paths = [RUNTIME_MANIFEST, ...Object.keys(manifest.files)].sort();
  const files = paths.map((path) => ({
    path,
    mode: manifest.files[path]?.mode ?? 0o644,
    data: readFileSync(join(root, path)).toString("base64"),
  }));
  const envelope = Buffer.from(
    JSON.stringify({ schema: ARTIFACT_SCHEMA, version: manifest.version, files }),
  );
  const artifact = gzipSync(envelope, { level: constants.Z_BEST_COMPRESSION });
  artifact[9] = GZIP_OS_UNKNOWN;
  return { version: manifest.version, envelope, artifact, sha256: sha256Of(artifact) };
}

const bad = (message: string): RuntimeReleaseError => new RuntimeReleaseError("artifact", message);
const tooLarge = (message: string): RuntimeReleaseError =>
  new RuntimeReleaseError("too-large", message);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

function inflate(artifact: Uint8Array, limits: RuntimeArtifactLimits): string {
  if (artifact.byteLength > limits.maxArtifactBytes)
    throw tooLarge(`artifact is ${artifact.byteLength} bytes, over ${limits.maxArtifactBytes}`);
  try {
    return gunzipSync(artifact, { maxOutputLength: limits.maxEnvelopeBytes }).toString("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE")
      throw tooLarge(`artifact inflates past ${limits.maxEnvelopeBytes} bytes`);
    throw bad(`artifact is not valid gzip: ${(error as Error).message}`);
  }
}

/** Decodes one `{path, mode, data}` record, checking its bounds before decoding. */
function decodeRecord(record: unknown, index: number, limits: RuntimeArtifactLimits): RuntimeFile {
  if (!isObject(record) || !exactKeys(record, ["path", "mode", "data"]))
    throw bad(
      `artifact record ${index} must hold exactly path, mode and data (regular files only)`,
    );
  const { path, mode, data } = record;
  if (typeof path !== "string") throw bad(`artifact record ${index} has no path`);
  checkRuntimePath(path);
  checkRuntimeMode(path, mode);
  if (typeof data !== "string") throw bad(`artifact record ${path} has no data`);
  if (data.length > Math.ceil(limits.maxFileBytes / 3) * 4)
    throw tooLarge(`artifact file ${path} is over ${limits.maxFileBytes} bytes`);
  const bytes = Buffer.from(data, "base64");
  if (bytes.toString("base64") !== data) throw bad(`artifact file ${path} is not canonical base64`);
  if (bytes.byteLength > limits.maxFileBytes)
    throw tooLarge(`artifact file ${path} is over ${limits.maxFileBytes} bytes`);
  return { path, mode, bytes };
}

export interface DecodeRuntimeOptions {
  readonly limits?: RuntimeArtifactLimits;
  /** The version the artifact must hold, from its release descriptor. */
  readonly expectedVersion?: string;
  /** The running Node, `process.versions.node` by default. */
  readonly nodeVersion?: string;
}

/**
 * Decodes and validates `artifact` entirely in memory: size bounds, gzip,
 * the envelope's shape and sorted unique paths, base64, the canonical
 * `runtime.json` against every record's hash and mode, the plugin
 * manifest, the expected version and the Node floor. Writes nothing.
 */
export function decodeRuntimeArtifact(
  artifact: Uint8Array,
  options: DecodeRuntimeOptions = {},
): DecodedRuntime {
  const limits = options.limits ?? DEFAULT_RUNTIME_LIMITS;
  let value: unknown;
  try {
    value = JSON.parse(inflate(artifact, limits));
  } catch (error) {
    if (error instanceof RuntimeReleaseError) throw error;
    throw bad(`artifact envelope is not JSON: ${(error as Error).message}`);
  }
  if (!isObject(value) || !exactKeys(value, ["schema", "version", "files"]))
    throw bad("artifact envelope must hold exactly schema, version and files");
  if (value.schema !== ARTIFACT_SCHEMA)
    throw bad(`artifact envelope has unsupported schema ${JSON.stringify(value.schema)}`);
  const version = value.version;
  if (!isRuntimeVersion(version))
    throw bad(`artifact has invalid version ${JSON.stringify(version)}`);
  if (options.expectedVersion !== undefined && version !== options.expectedVersion)
    throw new RuntimeReleaseError(
      "runtime",
      `artifact holds runtime ${version}, expected ${options.expectedVersion}`,
    );
  if (!Array.isArray(value.files)) throw bad("artifact files must be an array");
  if (value.files.length > limits.maxFiles)
    throw tooLarge(`artifact has ${value.files.length} files, over ${limits.maxFiles}`);

  const files: RuntimeFile[] = [];
  let total = 0;
  for (const [index, record] of value.files.entries()) {
    const file = decodeRecord(record, index, limits);
    const previous = files[files.length - 1];
    if (previous !== undefined && !(previous.path < file.path))
      throw bad(`artifact paths must be unique and sorted: ${file.path} after ${previous.path}`);
    total += file.bytes.byteLength;
    if (total > limits.maxTotalBytes)
      throw tooLarge(`artifact files exceed ${limits.maxTotalBytes} bytes`);
    files.push(file);
  }
  checkPathSet(files.map((file) => file.path));

  const manifestFile = files.find((file) => file.path === RUNTIME_MANIFEST);
  if (manifestFile === undefined || manifestFile.mode !== 0o644)
    throw new RuntimeReleaseError("runtime", `artifact has no 0644 ${RUNTIME_MANIFEST}`);
  const manifest = parseRuntimeManifest(manifestFile.bytes.toString("utf8"));
  checkContents(manifest, version, files);
  checkNodeFloor(manifest.nodeFloor, options.nodeVersion ?? process.versions.node);
  return { version, manifest, files };
}

/** Throws unless the records are exactly the manifest's files with its hashes and modes. */
function checkContents(manifest: RuntimeManifest, version: string, files: readonly RuntimeFile[]) {
  const invalid = (message: string) => new RuntimeReleaseError("runtime", message);
  if (manifest.version !== version)
    throw invalid(`${RUNTIME_MANIFEST} names ${manifest.version}, the artifact ${version}`);
  const listed = new Set(Object.keys(manifest.files));
  for (const file of files) {
    if (file.path === RUNTIME_MANIFEST) continue;
    const entry = manifest.files[file.path];
    if (entry === undefined)
      throw invalid(`artifact file ${file.path} is not in ${RUNTIME_MANIFEST}`);
    listed.delete(file.path);
    if (entry.mode !== file.mode)
      throw invalid(`artifact file ${file.path} has another mode than listed`);
    if (sha256Of(file.bytes) !== entry.sha256)
      throw invalid(`artifact file ${file.path} does not match its sha256`);
    if (file.path === PLUGIN_MANIFEST) checkPluginManifest(file.bytes.toString("utf8"), version);
  }
  const missing = [...listed][0];
  if (missing !== undefined) throw invalid(`artifact lacks listed file ${missing}`);
}
