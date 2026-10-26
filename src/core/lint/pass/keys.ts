import { createHash } from "node:crypto";
import { checkKey, encodeSegment } from "../../keys/check-key.js";
import { createInputMatcher } from "../../keys/glob.js";
import type { CheckKey, FileHash, Policy, RelativePath } from "../../types/index.js";
import type { LintFileInputs, LintSnapshot } from "./provider.js";

/** Bumped when what a lint key holds changes, so an old key never reads as a new one. */
const LINT_KEY = "squeal-lint-key/1";

/** The blob at a path now; `null` when no file is there. */
export type BlobOf = (path: RelativePath) => FileHash | null;

/** Spec 017 D5: what every file's key holds beside its own config and bytes. */
export interface KeyBasis {
  readonly snapshot: LintSnapshot;
  /** 011 C11's whole install fingerprint: in a key only when the config loaded a package. */
  readonly installed: string;
  readonly nodeMajor: number;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function sortedUnique(paths: Iterable<RelativePath>): RelativePath[] {
  return [...new Set(paths)].sort();
}

/** The parts every file shares: tool, versions, packages and keyed variables. */
function shared(basis: KeyBasis): unknown[] {
  const { declaration, packages, env } = basis.snapshot;
  return [
    declaration.tool,
    declaration.toolVersion,
    declaration.providerVersion,
    basis.nodeMajor,
    packages.length > 0 ? basis.installed : null,
    Object.entries(env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ];
}

/**
 * D7 step 2: the cursor's environment. When it moves, every included file
 * is keyed again with no transition: the config files and their closure
 * (with their blobs), the declaration, the packages, the keyed variables and
 * `lint.include` and `lint.exclude`.
 */
export function environmentOf(basis: KeyBasis, lint: Policy["lint"], blobOf: BlobOf): string {
  const { declaration, closure } = basis.snapshot;
  const files = sortedUnique([...declaration.configFiles, ...closure]);
  return sha256(
    JSON.stringify([
      LINT_KEY,
      ...shared(basis),
      declaration.configFiles,
      files.map((path) => [path, blobOf(path)]),
      lint.include,
      lint.exclude,
    ]),
  );
}

/**
 * D5: one segment for the whole program, the sorted path and blob of each
 * of its files, built once per pass; `""` with no program. Never a closure
 * of the program per file (`lint-seams.md` Q3).
 */
export function programSegment(program: readonly RelativePath[], blobOf: BlobOf): string {
  if (program.length === 0) return "";
  const segments = sortedUnique(program).map((path) => encodeSegment(path, blobOf(path)));
  return sha256(`${LINT_KEY}\0program\0${segments.join("")}`);
}

/**
 * D5: a file's key, `checkKey` over a lint environment: the file's blob,
 * the config closure's blobs, the file's computed config, the shared parts,
 * and for a whole-program file the program segment.
 */
export function lintKey(
  path: RelativePath,
  inputs: LintFileInputs,
  basis: KeyBasis,
  blobOf: BlobOf,
  segment: string,
): CheckKey {
  const environment = sha256(JSON.stringify([LINT_KEY, ...shared(basis), inputs.config]));
  const closure = {
    testFile: { project: basis.snapshot.declaration.tool, path },
    paths: sortedUnique([path, ...basis.snapshot.closure]),
    complete: true,
    method: "static imports plus declared inputs" as const,
  };
  return checkKey(environment, closure, blobOf, inputs.wholeProgram ? `program:${segment}` : "");
}

/**
 * D1: the files the pass offers the provider. ESLint's own config decides
 * which of them it lints (`inputs`); `lint.include` and `lint.exclude`
 * narrow them. Never a file git ignores or one under `node_modules`.
 */
export function includedSet(
  lint: Policy["lint"],
  ignored: readonly RelativePath[],
): (path: RelativePath) => boolean {
  const include = createInputMatcher(lint.include);
  const exclude = createInputMatcher(lint.exclude);
  const never = new Set(ignored);
  return (path) => {
    if (never.has(path)) return false;
    if (path.startsWith("node_modules/") || path.includes("/node_modules/")) return false;
    return include(path) && !exclude(path);
  };
}
