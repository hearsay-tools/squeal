import { readObjectFormat } from "../hash/git-index.js";
import { assembleClosure, isClosurePath } from "../keys/closure.js";
import { observedMetaKey, readSharedEntries } from "../keys/observed.js";
import { testFileId } from "../keys/reverse-index.js";
import { projectEnvironments, worktreeEnvironment } from "../store/environments.js";
import type { KeyParts } from "../store/transfer-bundle.js";
import { commitSegments, keyOver, NO_PARTS } from "../store/transfer-rekey.js";
import type { AbsolutePath, ProjectName, RelativePath, WorktreeId } from "../types/common.js";
import type { CheckKey, EnvironmentHash, FileHash, TestFileRef } from "../types/keys.js";
import type { PolicyInputs } from "../types/policy.js";
import type { Store } from "../types/store.js";
import { type EnvironmentAt, type EnvironmentStep, environmentAt } from "./at-environment.js";
import { readLockfileSides } from "./at-environment-lockfile.js";
import { type Coverage, targetCoverage } from "./at-keys-coverage.js";
import { untrackedInputs } from "./at-keys-untracked.js";
import { committedBlobs } from "./tree.js";

/*
 * Spec 023 D2: each listed test file's key at a commit, computed, never
 * looked up by label, with no checkout: this worktree's closure list (the
 * stored list plus the shared observed entries, as 018 D11's re-key takes
 * it) over the commit's blobs (`commitSegments`, `keyOver`), under the
 * project's environment hash at the commit (`environmentAt`). D11's
 * closure rule: the list must be the one this worktree's daemon keys the
 * file with, so the file's current key must come out of it over this
 * worktree's file hashes with its environment hash and key parts; else the
 * file is not determined (closure). That proves the list here, not at the
 * commit: review of wave 1 B1 adds `targetCoverage`, which must find the
 * list covering the commit's run (its changed files' imports there, its
 * declared inputs, no run-time reads or key parts beside a change), else
 * not determined (closure) too. A closure path git does not hold here
 * leaves it not determined too (D2.4). D5.1's sides use the same function
 * over a mixed blob set (`mixedBlobs`).
 */

/** Why a file's key at the commit is not determined. */
export type NotDetermined =
  | { readonly reason: "closure"; readonly detail: string }
  | { readonly reason: "environment"; readonly detail: string }
  | { readonly reason: "untracked input"; readonly path: RelativePath };

/** One test file's key at the commit, or why it is not determined. */
export type KeyAt =
  | {
      readonly key: CheckKey;
      readonly environment: EnvironmentHash;
      /** The D2.2 step that gave the environment hash. */
      readonly step: EnvironmentStep;
    }
  | { readonly notDetermined: NotDetermined };

/** What `keysOver` reads beside the store. */
export interface KeysOverInput {
  readonly worktreeId: WorktreeId;
  /** The files to key; their current keys are this worktree's rows. */
  readonly files: readonly TestFileRef[];
  /** The blob of each file at the commit, or of a side (`mixedBlobs`). */
  readonly blobs: ReadonlyMap<RelativePath, FileHash>;
  /** Each project's environment at the commit (`environmentAt`). */
  readonly environment: (project: ProjectName) => EnvironmentAt;
  /** This worktree's closure list of each file, by `testFileId` (`localClosures`). */
  readonly closures: ReadonlyMap<string, LocalClosure>;
  /** This worktree's file hashes, as its keys hold them (`file_hashes`). */
  readonly here: ReadonlyMap<RelativePath, FileHash>;
  /** Whether a list covers the target run (`targetCoverage`, review of wave 1 B1). */
  readonly coverage: Coverage;
  /** Closure paths whose content here comes from a file git does not hold (`untrackedInputs`). */
  readonly untracked: ReadonlySet<RelativePath>;
  /** The key's two segments a store does not keep; absent or `null`, both empty (whole-fingerprint mode). */
  readonly parts?: (file: TestFileRef) => KeyParts | null;
}

/** Each file's key at the commit, by `testFileId`. */
export function keysOver(store: Store, input: KeysOverInput): Map<string, KeyAt> {
  const { worktreeId, files } = input;
  const current = new Map(
    store.testFileKeys.list(worktreeId, files).map((r) => [testFileId(r.testFile), r.key]),
  );
  const here = commitSegments(input.here);
  const at = commitSegments(input.blobs);
  const environments = new Map<ProjectName, EnvironmentAt>();
  const hereHashes = new Map<ProjectName, EnvironmentHash | null>();
  const once = <T>(cache: Map<ProjectName, T>, project: ProjectName, read: () => T): T => {
    if (!cache.has(project)) cache.set(project, read());
    return cache.get(project) as T;
  };
  const out = new Map<string, KeyAt>();
  for (const file of files) {
    const ref: TestFileRef = { project: file.project, path: file.path };
    const id = testFileId(ref);
    const keyed = keyOf(ref, input, {
      key: current.get(id) ?? null,
      hereHash: once(hereHashes, ref.project, () => {
        return worktreeEnvironment(store, worktreeId, ref.project)?.hash ?? null;
      }),
      here,
      at,
      environment: () => once(environments, ref.project, () => input.environment(ref.project)),
    });
    out.set(id, keyed);
  }
  return out;
}

/** What `keyOf` reads of this worktree and the commit for one file. */
interface FileView {
  /** The file's current key here. */
  readonly key: CheckKey | null;
  /** This worktree's environment hash of the file's project. */
  readonly hereHash: EnvironmentHash | null;
  /** Each path's segment here and at the commit (`commitSegments`). */
  readonly here: (path: RelativePath) => string;
  readonly at: (path: RelativePath) => string;
  readonly environment: () => EnvironmentAt;
}

/**
 * One file's key at the commit, in D2's order: closure list, untracked
 * inputs, D11's proof here, the list's coverage at the target, environment.
 */
function keyOf(ref: TestFileRef, input: KeysOverInput, view: FileView): KeyAt {
  const local = input.closures.get(testFileId(ref));
  if (local === undefined) return closureMissing("no stored closure list");
  const closure = local.paths;
  const untracked = closure.find((path) => input.untracked.has(path));
  if (untracked !== undefined) {
    return { notDetermined: { reason: "untracked input", path: untracked } };
  }
  const parts = input.parts?.(ref) ?? NO_PARTS;
  if (view.hereHash === null || view.key === null) {
    return closureMissing("this worktree has no key of the file");
  }
  if (keyOver(view.hereHash, ref, closure, view.here, parts) !== view.key) {
    return closureMissing("the stored list does not give this worktree's key");
  }
  const gap = input.coverage(ref, closure, { parts, observed: local.observed });
  if (gap !== null) return closureMissing(gap);
  const environment = view.environment();
  if ("notDetermined" in environment) {
    return { notDetermined: { reason: "environment", detail: environment.notDetermined } };
  }
  const { hash, step } = environment;
  return { key: keyOver(hash, ref, closure, view.at, parts), environment: hash, step };
}

/** One file's closure list here, and whether its runs observed reads beyond its static list. */
export interface LocalClosure {
  readonly paths: readonly RelativePath[];
  readonly observed: boolean;
}

/**
 * Each file's closure list as 018 D11's re-key takes this worktree's: the
 * stored list plus the shared observed entries (`assembleClosure`), by
 * `testFileId`; none for a file with no stored list.
 */
export function localClosures(
  store: Store,
  files: readonly TestFileRef[],
): Map<string, LocalClosure> {
  const observed = new Map<ProjectName, Record<string, RelativePath[]>>();
  const out = new Map<string, LocalClosure>();
  for (const file of files) {
    const ref: TestFileRef = { project: file.project, path: file.path };
    const stored = store.testFiles.get(ref)?.closure.paths;
    if (stored === undefined) continue;
    let entries = observed.get(ref.project);
    if (entries === undefined) {
      entries = readSharedEntries(store, observedMetaKey(ref.project));
      observed.set(ref.project, entries);
    }
    const extra = (entries[ref.path] ?? []).filter(isClosurePath);
    const paths = assembleClosure({ testFile: ref, paths: stored }, [], extra).paths;
    out.set(testFileId(ref), { paths, observed: extra.length > 0 });
  }
  return out;
}

function closureMissing(detail: string): KeyAt {
  return { notDetermined: { reason: "closure", detail } };
}

/**
 * Spec 023 D5.1: a side's blobs: each of `testPaths` as `tests` holds it
 * (absent when it does not), every other path as `code` holds it.
 */
export function mixedBlobs(
  code: ReadonlyMap<RelativePath, FileHash>,
  tests: ReadonlyMap<RelativePath, FileHash>,
  testPaths: Iterable<RelativePath>,
): Map<RelativePath, FileHash> {
  const out = new Map(code);
  for (const path of testPaths) {
    const blob = tests.get(path);
    if (blob === undefined) out.delete(path);
    else out.set(path, blob);
  }
  return out;
}

/** What `keysAtBlobs` reads beside the blobs. */
export interface KeysAtInput {
  readonly root: AbsolutePath;
  readonly store: Store;
  readonly worktreeId: WorktreeId;
  /** The files to key; absent, every file this worktree lists. */
  readonly files?: readonly TestFileRef[];
  /** Policy `inputs`: the target's declared inputs must be in each list. */
  readonly inputs: PolicyInputs;
  /** `KeysOverInput.parts`. */
  readonly parts?: (file: TestFileRef) => KeyParts | null;
  /** Each project's folder, where its lockfile is looked for first; absent, the worktree root. */
  readonly projectDir?: (project: ProjectName) => RelativePath;
  /** Step 3's `EnvironmentAtInput.rehash`, by project; absent, step 3 is not taken. */
  readonly rehash?: (project: ProjectName, installed: string) => EnvironmentHash;
}

/** Each listed file's key at `commit` (D2), by `testFileId`. */
export async function keysAtCommit(
  input: KeysAtInput & { readonly commit: string },
): Promise<Map<string, KeyAt>> {
  return keysAtBlobs(input, await committedBlobs(input.root, input.commit));
}

/**
 * Each listed file's key at a side of D5.1: the test-side paths
 * (`testPaths`) at commit `tests`, the rest at commit `code`.
 */
export async function sideKeys(
  input: KeysAtInput & {
    readonly code: string;
    readonly tests: string;
    readonly testPaths: Iterable<RelativePath>;
  },
): Promise<Map<string, KeyAt>> {
  const [code, tests] = await Promise.all([
    committedBlobs(input.root, input.code),
    committedBlobs(input.root, input.tests),
  ]);
  return keysAtBlobs(input, mixedBlobs(code, tests, input.testPaths));
}

/** Each listed file's key over `blobs`, its environment and untracked inputs read here. */
export async function keysAtBlobs(
  input: KeysAtInput,
  blobs: ReadonlyMap<RelativePath, FileHash>,
): Promise<Map<string, KeyAt>> {
  const { root, store, worktreeId } = input;
  const files = input.files ?? store.testFileKeys.list(worktreeId).map((record) => record.testFile);
  const closures = localClosures(store, files);
  const paths = [...closures.values()].flatMap((closure) => closure.paths);
  const untracked = await untrackedInputs(root, paths);
  const here = new Map(store.fileHashes.list(worktreeId).map((r) => [r.path, r.hash]));
  const coverage = await targetCoverage({ root, blobs, here, paths, inputs: input.inputs });
  const format = await readObjectFormat(root);
  const projects = [...new Set(files.map((file) => file.project))];
  const environments = new Map<ProjectName, EnvironmentAt>();
  for (const project of projects) {
    const dir = input.projectDir?.(project) ?? "";
    const lockfile = await readLockfileSides(root, dir, blobs, format);
    const { rehash } = input;
    environments.set(
      project,
      environmentAt({
        here: worktreeEnvironment(store, worktreeId, project),
        stored: projectEnvironments(store, project),
        blobs,
        lockfile,
        ...(rehash === undefined ? {} : { rehash: (installed) => rehash(project, installed) }),
      }),
    );
  }
  const environment = (project: ProjectName): EnvironmentAt =>
    environments.get(project) ?? { notDetermined: "no project" };
  const parts = input.parts;
  return keysOver(store, {
    worktreeId,
    files,
    blobs,
    environment,
    closures,
    here,
    coverage,
    untracked,
    ...(parts === undefined ? {} : { parts }),
  });
}
