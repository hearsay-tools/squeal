import {
  chmodSync,
  closeSync,
  fchmodSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { type DecodeRuntimeOptions, decodeRuntimeArtifact, type RuntimeFile } from "./artifact.js";
import { RuntimeReleaseError } from "./errors.js";
import type { RuntimeManifest } from "./manifest.js";
import { sha256Of, validateRuntimeTree } from "./tree.js";

/*
 * Row 002-30 (spec 002 D8): a validated artifact is written into a fresh
 * private directory `<stagingDir>/squeal-runtime-XXXXXX/` (0700) as
 * `runtime/`, each file created exclusively with its exact mode, then the
 * whole staged tree is validated again from disk. Nothing is written before
 * the artifact passed every in-memory check, nothing outside the fresh
 * directory is written but `stagingDir` itself, and any failure removes the
 * fresh directory. Publication and selection are later wiring (W1's
 * `publishRuntime`); this module never touches `versions/` or `runtime/`.
 */

export interface StagedRuntime {
  /** The staged runtime root, complete and validated; not yet published. */
  readonly root: string;
  readonly version: string;
  readonly manifest: RuntimeManifest;
  /** SHA-256 of the artifact bytes it came from. */
  readonly sha256: string;
  /** Removes the private staging directory; safe to call more than once. */
  readonly cleanup: () => void;
}

export interface StageRuntimeArtifactOptions extends DecodeRuntimeOptions {
  readonly artifact: Uint8Array;
  /** The SHA-256 the artifact bytes must have, from the release descriptor. */
  readonly sha256?: string;
  /** The parent of the private staging directory; created when missing. */
  readonly stagingDir: string;
}

const DIRECTORY_MODE = 0o755;

function writeFiles(root: string, files: readonly RuntimeFile[]): void {
  const made = new Set<string>();
  const ensureDir = (dir: string): void => {
    if (dir === root || made.has(dir)) return;
    ensureDir(dirname(dir));
    mkdirSync(dir, { mode: DIRECTORY_MODE });
    chmodSync(dir, DIRECTORY_MODE);
    made.add(dir);
  };
  for (const file of files) {
    const full = join(root, file.path);
    ensureDir(dirname(full));
    const fd = openSync(full, "wx", file.mode);
    try {
      writeSync(fd, file.bytes);
      fchmodSync(fd, file.mode);
    } finally {
      closeSync(fd);
    }
  }
}

/**
 * Checks `artifact` against `sha256`, decodes and validates it in memory
 * (`decodeRuntimeArtifact`), then stages and revalidates it. Throws a
 * `RuntimeReleaseError`; on any failure no staging directory remains.
 */
export function stageRuntimeArtifact(options: StageRuntimeArtifactOptions): StagedRuntime {
  const sha256 = sha256Of(options.artifact);
  if (options.sha256 !== undefined && options.sha256 !== sha256)
    throw new RuntimeReleaseError(
      "integrity",
      `artifact sha256 ${sha256} does not match the release's ${options.sha256}`,
    );
  const decoded = decodeRuntimeArtifact(options.artifact, options);

  let staging: string;
  try {
    mkdirSync(options.stagingDir, { recursive: true, mode: 0o700 });
    staging = mkdtempSync(join(options.stagingDir, "squeal-runtime-"));
  } catch (error) {
    throw new RuntimeReleaseError(
      "staging",
      `cannot stage in ${options.stagingDir}: ${(error as Error).message}`,
    );
  }
  const cleanup = (): void => rmSync(staging, { recursive: true, force: true });
  const root = join(staging, "runtime");
  try {
    mkdirSync(root, { mode: DIRECTORY_MODE });
    chmodSync(root, DIRECTORY_MODE);
    writeFiles(root, decoded.files);
  } catch (error) {
    cleanup();
    throw new RuntimeReleaseError("staging", `cannot write ${root}: ${(error as Error).message}`);
  }
  try {
    const manifest = validateRuntimeTree(root, {
      expectedVersion: decoded.version,
      ...(options.nodeVersion === undefined ? {} : { nodeVersion: options.nodeVersion }),
    });
    return { root, version: manifest.version, manifest, sha256, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
