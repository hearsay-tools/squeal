import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { currentFile, runtimeRoot, SCHEMA, sha256, versionsDir, writeAtomic } from "./layout.js";
import {
  checkBytes,
  RUNTIME_MANIFEST,
  RuntimeError,
  type RuntimeManifest,
  samePayload,
  verifyTree,
} from "./manifest.js";

/*
 * Spec 002 D8 and D9, `tasks/wave-4-contract.md`: publication retains a
 * whole, validated runtime tree as `<PLUGIN_DATA>/versions/<version>/` by one
 * rename, and may then move `runtime/current.json`. Later wiring calls it
 * after its own artifact validation; it owns no lock or backoff.
 */

export interface RuntimeRef {
  /** The retained root, `<data>/versions/<version>`. */
  readonly root: string;
  readonly version: string;
}

export interface PublishOptions {
  /** A complete runtime tree: a staged artifact, or the fixed plugin's seed. */
  readonly sourceRoot: string;
  /** Codex's `PLUGIN_DATA`. */
  readonly data: string;
  /** Make the published runtime the one new sessions select. */
  readonly select?: boolean;
  /** The Node version hooks run; this process's by default. */
  readonly node?: string;
}

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const unwritable = (data: string, error: unknown) =>
  new RuntimeError(
    "unwritable-data",
    `Squeal cannot write its runtime store under ${data}: ${errorText(error)}`,
  );

/**
 * Validates `sourceRoot` whole and retains it as `<data>/versions/<version>`:
 * staged under a private name, every byte hashed as it is copied, then renamed
 * into place, so a root that exists is complete. A valid root of the same
 * payload already there is kept; one of another payload claiming the version
 * is a `version-conflict`; an invalid one, such as a copy before runtime
 * manifests, is replaced. With `select`, `runtime/current.json` then names
 * the version. Throws a `RuntimeError`.
 */
export function publishRuntime(options: PublishOptions): RuntimeRef {
  const { sourceRoot, data, select = false, node = process.versions.node } = options;
  const source = verifyTree(sourceRoot, node);
  const { version } = source.manifest;
  const root = runtimeRoot(data, version);
  if (held(root, source.manifest, node) !== "same") {
    let staged: string;
    try {
      mkdirSync(versionsDir(data), { recursive: true });
      staged = join(versionsDir(data), `.${version}.${process.pid}.tmp`);
      rmSync(staged, { recursive: true, force: true });
    } catch (error) {
      throw unwritable(data, error);
    }
    try {
      stage(sourceRoot, source, staged, data);
      place(staged, root, source.manifest, node, data);
    } finally {
      rmSync(staged, { recursive: true, force: true });
    }
  }
  if (select) selectCurrent(data, version);
  return { root, version };
}

/** Copies the listed files of `sourceRoot` into `staged`, hashing what it writes. */
function stage(
  sourceRoot: string,
  source: { manifest: RuntimeManifest; text: string; files: string[] },
  staged: string,
  data: string,
): void {
  const write = (path: string, bytes: Buffer | string, mode: number) => {
    try {
      mkdirSync(dirname(join(staged, path)), { recursive: true });
      writeFileSync(join(staged, path), bytes, { flag: "wx" });
      chmodSync(join(staged, path), mode);
    } catch (error) {
      throw unwritable(data, error);
    }
  };
  for (const path of source.files) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(sourceRoot, path));
    } catch (error) {
      throw new RuntimeError("invalid-runtime", `${sourceRoot}: ${path}: ${errorText(error)}`);
    }
    checkBytes(sourceRoot, source.manifest, path, sha256(bytes));
    write(path, bytes, source.manifest.files[path]?.mode ?? 0o644);
  }
  write(RUNTIME_MANIFEST, source.text, 0o644);
}

/** Renames `staged` to `root`; on a collision keeps the same payload or replaces an invalid tree. */
function place(
  staged: string,
  root: string,
  manifest: RuntimeManifest,
  node: string,
  data: string,
): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(staged, root);
      return;
    } catch (error) {
      if (attempt > 0 || !existsSync(root)) throw unwritable(data, error);
    }
    // Another publisher placed this version first, or an invalid tree sits there.
    if (held(root, manifest, node) === "same") return;
    removeTree(root);
  }
}

/**
 * What `root` holds for a publication of `manifest`: nothing, the same
 * payload verified byte for byte, or an invalid tree. Throws a
 * `version-conflict` for a valid tree of another payload.
 */
function held(
  root: string,
  manifest: RuntimeManifest,
  node: string,
): "absent" | "same" | "invalid" {
  if (!existsSync(root)) return "absent";
  let tree: ReturnType<typeof verifyTree>;
  try {
    tree = verifyTree(root, node);
    for (const path of tree.files) {
      checkBytes(root, tree.manifest, path, sha256(readFileSync(join(root, path))));
    }
  } catch {
    return "invalid";
  }
  if (samePayload(tree.manifest, manifest)) return "same";
  throw new RuntimeError(
    "version-conflict",
    `${root} already holds a different Squeal runtime ${manifest.version}; a runtime of another payload cannot claim that version.`,
  );
}

/** Renames `root` out of `versions/`, so no reader finds half of it, and removes it. */
function removeTree(root: string): void {
  const doomed = join(dirname(root), `.${basename(root)}.${process.pid}.gone`);
  try {
    renameSync(root, doomed);
  } catch {
    return;
  }
  rmSync(doomed, { recursive: true, force: true });
}

export function selectCurrent(data: string, version: string): void {
  try {
    writeAtomic(currentFile(data), `${JSON.stringify({ schema: SCHEMA, version })}\n`);
  } catch (error) {
    throw unwritable(data, error);
  }
}
