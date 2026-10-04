import { createHash } from "node:crypto";
import type {
  CheckKey,
  Closure,
  EnvironmentHash,
  FileHash,
  RelativePath,
  TestFileRef,
} from "../types/index.js";

/** Bumped when the encoding below changes, so old keys can never collide with new ones. */
const KEY_ENCODING = "squeal-check-key/1";

/** Stands for a closure path with no file. Not hex, so no hash can equal it. */
const MISSING = "-";

/**
 * Content key of a test file.
 *
 * Spec 001 D3: "**Check key**, per test file: `sha256(envHash, projectName,
 * relative test path, sorted (path, fileHash) over the closure)`."
 * `closure.paths` is already sorted and unique (`assembleClosure`). A path
 * whose file is gone hashes as missing, so a delete changes the key.
 */
export function checkKey(
  envHash: EnvironmentHash,
  closure: Closure,
  hashOf: (path: RelativePath) => FileHash | null,
): CheckKey {
  const segments = closure.paths.map((path) => encodeSegment(path, hashOf(path)));
  return keyFromSegments(envHash, closure.testFile, segments);
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
  return Buffer.from(`${path}\0${hash ?? MISSING}\0`).toString();
}

/** The key over pre-encoded segments, in closure order. `KeyIndex` reuses segments across closures. */
export function keyFromSegments(
  envHash: EnvironmentHash,
  testFile: TestFileRef,
  segments: readonly string[],
): CheckKey {
  return createHash("sha256")
    .update(JSON.stringify([KEY_ENCODING, envHash, testFile.project, testFile.path]))
    .update("\0")
    .update(segments.join(""))
    .digest("hex");
}
