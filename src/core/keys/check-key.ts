import { createHash } from "node:crypto";
import type {
  CheckKey,
  Closure,
  EnvironmentHash,
  FileHash,
  RelativePath,
  TestFileRef,
} from "../types/index.js";
import { KEY_FORMAT_VERSION } from "./key-format.js";

/** Bumped when the encoding below changes, so old keys can never collide with new ones. */
const KEY_ENCODING = "squeal-check-key/2";

/** Stood for a closure path with no file before task 011-158 (`absentSegment`). Not hex, so no hash can equal it. */
const MISSING = "-";

/** The last format whose keys held `absentSegment`; a raise above it ends their read (task 011-158). */
const ABSENT_LAST_FORMAT = 20;

/**
 * Content key of a test file.
 *
 * Spec 001 D3: "**Check key**, per test file: `sha256(envHash, projectName,
 * relative test path, sorted (path, fileHash) over the closure)`."
 * `closure.paths` is already sorted and unique (`assembleClosure`). A path
 * with no file enters no segment (task 011-158): a path only another branch
 * has, which the shared closure list or observed set names, keys nothing, so
 * equal content keys equal. A delete still changes the key, since the path's
 * segment leaves it, and an add, since it enters.
 * `dependencies` is the test file's installed-dependency segment (task
 * 001-105, `DependencyKeys.of`), empty when the environment hash holds them.
 */
export function checkKey(
  envHash: EnvironmentHash,
  closure: Closure,
  hashOf: (path: RelativePath) => FileHash | null,
  dependencies = "",
): CheckKey {
  const segments = closure.paths.map((path) => encodeSegment(path, hashOf(path)));
  return keyFromSegments(envHash, closure.testFile, segments, dependencies);
}

/**
 * One closure entry as it enters the key. Paths and hashes are NUL-terminated;
 * neither can contain NUL, so the encoding is unambiguous.
 *
 * The result is a flat string. A concatenated string stays a rope in V8, and
 * joining 300 ropes per key is about 20 times slower than joining flat
 * strings; the round trip through a buffer flattens it once.
 */
export function encodeSegment(path: RelativePath, hash: FileHash | null): string {
  if (hash === null) return "";
  return Buffer.from(`${path}\0${hash}\0`).toString();
}

/**
 * The segment a path with no file had before task 011-158, `path\0-\0`.
 * Every key C3 reads as one holds it (`KeyIndex.keysReadAsOne`).
 */
export function absentSegment(path: RelativePath): string {
  return Buffer.from(`${path}\0${MISSING}\0`).toString();
}

/**
 * Task 011-158 (011 C3): a project's current environment hash under the key
 * definition before 011-158, read as one. `KeyIndex.keysReadAsOne` keys
 * every entry read as one with `absentSegment`, since every format and
 * definition read as one predates 011-158; this adds the current format's.
 * None above `ABSENT_LAST_FORMAT`: a raise empties every read.
 */
export function absentReadAsOne(
  environment: EnvironmentHash,
  format = KEY_FORMAT_VERSION,
): { readonly environment: EnvironmentHash }[] {
  return format <= ABSENT_LAST_FORMAT ? [{ environment }] : [];
}

/** The key over pre-encoded segments, in closure order. `KeyIndex` reuses segments across closures. */
export function keyFromSegments(
  envHash: EnvironmentHash,
  testFile: TestFileRef,
  segments: readonly string[],
  dependencies = "",
): CheckKey {
  return createHash("sha256")
    .update(JSON.stringify([KEY_ENCODING, envHash, testFile.project, testFile.path, dependencies]))
    .update("\0")
    .update(segments.join(""))
    .digest("hex");
}
