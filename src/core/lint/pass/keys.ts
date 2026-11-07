import { createHash } from "node:crypto";
import { extname } from "node:path";
import { checkKey } from "../../keys/check-key.js";
import { createInputMatcher } from "../../keys/glob.js";
import type { RelativePath } from "../../types/common.js";
import type { CheckKey, FileHash } from "../../types/keys.js";
import type { Policy } from "../../types/policy.js";
import type { LintFileInputs, LintSnapshot } from "./provider.js";

/** Bumped when what a lint key holds changes, so an old key never reads as a new one. */
const LINT_KEY = "squeal-lint-key/4";

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

/** The config files and their closure: the files every key reads beside the file itself. */
function configInputs(basis: KeyBasis): RelativePath[] {
  const { declaration, closure } = basis.snapshot;
  return sortedUnique([...declaration.configFiles, ...closure]);
}

/**
 * Row 019-21 (review 0.1.396 B2): what every key holds beside the file's
 * own bytes and computed config, as a commit can compare it. Each config
 * file and closure file with the blob the keys read, `null` for no file;
 * whether the keys hold the install fingerprint. The rest of a key (the
 * tool, versions, keyed variables) is the machine's, not a commit's. While
 * every blob here and the file's own are the commit's, the computed config
 * is the commit's too, and so is the key.
 */
export interface KeyInputs {
  readonly files: readonly (readonly [RelativePath, FileHash | null])[];
  readonly installed: boolean;
}

/** The `KeyInputs` of `basis` at `blobOf`: the ones `lintKey` and `environmentOf` hash. */
export function keyInputs(basis: KeyBasis, blobOf: BlobOf): KeyInputs {
  return {
    files: configInputs(basis).map((path) => [path, blobOf(path)] as const),
    installed: basis.snapshot.packages.length > 0,
  };
}

/**
 * D7 step 2: the cursor's environment. When it moves, every included file
 * is keyed again with no transition: the config files and their closure
 * (with their blobs), the declaration, the packages, the keyed variables and
 * `lint.include` and `lint.exclude`.
 */
export function environmentOf(basis: KeyBasis, lint: Policy["lint"], blobOf: BlobOf): string {
  return sha256(
    JSON.stringify([
      LINT_KEY,
      ...shared(basis),
      basis.snapshot.declaration.configFiles,
      keyInputs(basis, blobOf).files,
      lint.include,
      lint.exclude,
    ]),
  );
}

/** D5 as amended for review 0.1.348 B1: the extensions whose listed files' blobs a segment holds. */
export const MODULE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".json",
]);

/** What D5's program segment is built from. */
export interface SegmentInputs {
  /** The worktree's whole listing, whatever the policy and ESLint's ignores say. */
  readonly listing: readonly { readonly path: RelativePath; readonly hash: FileHash }[];
  /** The provider's program, with the files its imports resolve to (D5). */
  readonly program: readonly RelativePath[];
  /** The extensions ESLint lints beside `MODULE_EXTENSIONS`. */
  readonly extensions: ReadonlySet<string>;
  /** 011 C11's install fingerprint: the packages, TypeScript among them. */
  readonly installed: string;
  /** A program file outside the listing, at its bytes on disk (`Unlisted`); `null` when none is there. */
  readonly outside: BlobOf;
}

/** Whether a segment holds a listed file's blob: one with a module extension or one ESLint lints. */
export function holdsBlob(path: RelativePath, extensions: ReadonlySet<string>): boolean {
  const ext = extname(path);
  return MODULE_EXTENSIONS.has(ext) || extensions.has(ext);
}

/** A package's file: the install fingerprint holds its bytes (D5). */
export function underModules(path: RelativePath): boolean {
  return path.startsWith("node_modules/") || path.includes("/node_modules/");
}

/**
 * D5: one segment for the whole program, built once per pass: the sorted
 * paths of the whole listing with the blob of each module file, then the
 * path and blob of each program file outside it, then the install
 * fingerprint. A package's file has no blob here: the fingerprint holds it.
 * Never a closure of the program per file (`lint-seams.md` Q3).
 */
export function programSegment(inputs: SegmentInputs): string {
  const listed = new Set<RelativePath>();
  const lines: string[] = [];
  const listing = [...inputs.listing].sort((a, b) => (a.path < b.path ? -1 : 1));
  for (const { path, hash } of listing) {
    listed.add(path);
    lines.push(`${path}\0${holdsBlob(path, inputs.extensions) ? hash : ""}`);
  }
  for (const path of sortedUnique(inputs.program)) {
    if (listed.has(path)) continue;
    const blob = underModules(path) ? "package" : (inputs.outside(path) ?? "-");
    lines.push(`${path}\0${blob}`);
  }
  return sha256([LINT_KEY, "program", inputs.installed, ...lines].join("\n"));
}

/**
 * D5: a file's key, `checkKey` over a lint environment: the file's blob,
 * the blobs of the config files and their closure, the file's computed
 * config, the shared parts, and for a whole-program file the program
 * segment. ESLint's closure already holds each config file it loaded;
 * oxlint's leaves its configs to `configFiles` (D11: each folder's config
 * and the root's inputs), whose bytes no computed config holds.
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
    paths: sortedUnique([path, ...configInputs(basis)]),
    complete: true,
    method: "static imports plus declared inputs" as const,
  };
  return checkKey(environment, closure, blobOf, inputs.wholeProgram ? `program:${segment}` : "");
}

/**
 * D1: the files the pass may offer the provider; ESLint's own config
 * decides which of them it lints (`inputs`). Never a file git ignores or
 * one under `node_modules`.
 */
export function offeredSet(ignored: readonly RelativePath[]): (path: RelativePath) => boolean {
  const never = new Set(ignored);
  return (path) => !never.has(path) && !underModules(path);
}

/**
 * D1: the files Squeal checks, `lint.include` and `lint.exclude` over the
 * offered ones. They select checks and results only: the program segment
 * holds every listed file (D5, review 0.1.348 B1).
 */
export function selectedSet(lint: Policy["lint"]): (path: RelativePath) => boolean {
  const include = createInputMatcher(lint.include);
  const exclude = createInputMatcher(lint.exclude);
  return (path) => include(path) && !exclude(path);
}
