import type { RelativePath } from "../types/common.js";
import type { FileHash, TestFileRef } from "../types/keys.js";
import type { KnownState } from "../types/state.js";
import type { NotDeterminedTestFile } from "../types/status.js";
import type { TestFileKeyRecord } from "../types/store-records.js";
import { type CommitTestCounts, NOT_DETERMINED_KEPT, THROUGH_KEPT } from "./report.js";
import type { StoredBlobs } from "./stored.js";

/**
 * What one worktree's daemon knows when `HEAD` moves: the hashes its keys
 * were made of, its test files' closures and their states. The scheduler
 * gives its own (`scheduler/head-move.ts`); tests give a fake.
 */
export interface CommitView {
  /** The hash the keys were made of: a blob, `null` for no file, `undefined` when not tracked. */
  hashOf(path: RelativePath): FileHash | null | undefined;
  /** Every path `hashOf` tracks. */
  paths(): Iterable<RelativePath>;
  /** The closure paths of a test file's current key; `undefined` when not known. */
  closure(testFile: TestFileRef): readonly RelativePath[] | undefined;
  /** True when a change to `path` can move an environment hash, which every key holds. */
  isEnvironmentInput(path: RelativePath): boolean;
  /** The paths git ignores among `paths`. */
  ignoredAmong(paths: readonly RelativePath[]): Promise<ReadonlySet<RelativePath>>;
  /** The worktree's test files, their keys and pending phases. */
  testFiles(): readonly TestFileKeyRecord[];
  /** The worktree's known states. */
  states(): readonly KnownState[];
  /** True when Squeal stored a closure for `testFile` (`test_files`, the repository's): it was a test file. */
  knownTestFile(testFile: TestFileRef): boolean;
  /** True when the working tree has a file, or anything else, at `path`. */
  onDisk(path: RelativePath): Promise<boolean>;
  /**
   * Row 019-37: the blob git would store for the bytes each path's key was
   * made of, given by their hash in `hashes` (`storedBlobs`). Only a path
   * git converts whose working-tree file is still those bytes is in the
   * answer (review 0.1.401); row 019-39: with the files git did not answer.
   */
  storedBlobs(hashes: ReadonlyMap<RelativePath, FileHash>): Promise<StoredBlobs>;
}

/** `differingPaths`'s answer. */
export interface Differences {
  /** The paths whose working-tree file is not the commit's. */
  readonly differing: Set<RelativePath>;
  /**
   * Row 019-39 (review 0.1.402 B2): those of `differing` git did not answer
   * for (`storedBlobs`): each may be the commit's file or not.
   */
  readonly unanswered: ReadonlySet<RelativePath>;
}

/**
 * The paths whose file in the working tree, as the keys hashed it, is not
 * the commit's: a different blob, a file only one side has. A path the
 * commit does not hold that git ignores is no difference: the commit says
 * nothing of it, and its checkout keeps the file on disk. A path the view
 * does not track is left out; a closure holding one has no key.
 *
 * Row 019-37 (lessons P11): a file both sides hold whose bytes git converts
 * (`eol`, `filter`, `core.autocrlf`) hashes on disk to another blob than the
 * commit's, though it is the commit's file. The paths both sides hold at
 * different blobs are asked of git with the hashes the keys were made of
 * (`storedBlobs`); one whose key's bytes git stores as the committed blob
 * is no difference. Review 0.1.401: the bytes the key was made of decide,
 * never a later read of the file. A tree that is the commit's asks nothing.
 * Row 019-39: a path git did not answer for stays a difference, and is
 * `unanswered`.
 */
export async function differingPaths(
  view: Pick<CommitView, "hashOf" | "paths" | "ignoredAmong" | "storedBlobs">,
  committed: ReadonlyMap<RelativePath, FileHash>,
): Promise<Differences> {
  const differing = new Set<RelativePath>();
  const absent: RelativePath[] = [];
  const both = new Map<RelativePath, FileHash>();
  const consider = (path: RelativePath) => {
    const hash = view.hashOf(path);
    if (hash === undefined || differing.has(path)) return;
    const blob = committed.get(path) ?? null;
    if (hash === blob) return;
    differing.add(path);
    if (blob === null) absent.push(path);
    else if (hash !== null) both.set(path, hash);
  };
  for (const path of view.paths()) consider(path);
  for (const path of committed.keys()) consider(path);
  if (absent.length > 0) for (const path of await view.ignoredAmong(absent)) differing.delete(path);
  if (both.size === 0) return { differing, unanswered: new Set() };
  const { blobs, unanswered } = await view.storedBlobs(both);
  for (const [path, stored] of blobs) {
    if (stored === committed.get(path)) differing.delete(path);
  }
  return { differing, unanswered };
}

const fileId = (project: string, path: RelativePath) => `${project}\0${path}`;

/** True when one of `differing` can move an environment hash, which every test key holds. */
export function environmentDiffers(
  view: Pick<CommitView, "isEnvironmentInput">,
  differing: ReadonlySet<RelativePath>,
): boolean {
  return [...differing].some((path) => view.isEnvironmentInput(path));
}

/**
 * Review 0.1.396 S3: the test files the commit holds that the working tree
 * deleted, which no listing names any more. A committed path no listed
 * test file has, with no file in the working tree, that Squeal has known as
 * a test file of one of the listed projects (`knownTestFile`). A path the
 * stat cache holds at another blob is a file there: not deleted. Only a
 * known test file is looked for on disk.
 */
export async function deletedTestFiles(
  view: Pick<CommitView, "hashOf" | "testFiles" | "knownTestFile" | "onDisk">,
  committed: ReadonlyMap<RelativePath, FileHash>,
): Promise<TestFileRef[]> {
  const records = view.testFiles();
  const listed = new Set(records.map((r) => r.testFile.path));
  const projects = [...new Set(records.map((r) => r.testFile.project))];
  const deleted: TestFileRef[] = [];
  for (const path of committed.keys()) {
    if (listed.has(path)) continue;
    const hash = view.hashOf(path);
    if (typeof hash === "string") continue;
    const project = projects.find((p) => view.knownTestFile({ project: p, path }));
    if (project === undefined) continue;
    if (hash === undefined && (await view.onDisk(path))) continue;
    deleted.push({ project, path });
  }
  return deleted;
}

/** What a report's test tally reads beside the view. */
export interface TallySide {
  /** The paths whose working-tree file is not the commit's (`differingPaths`). */
  readonly differing: ReadonlySet<RelativePath>;
  /**
   * The paths of `differing` the commit does not hold: untracked files. A
   * file not determined only through them is not one of unstaged changes.
   */
  readonly untracked?: ReadonlySet<RelativePath>;
  /**
   * Row 019-39: the paths of `differing` git did not answer for
   * (`differingPaths`). A file not determined through them, and through no
   * other path the commit holds, is not one of unstaged changes either.
   */
  readonly unanswered?: ReadonlySet<RelativePath>;
  /** The commit's test files the working tree deleted (`deletedTestFiles`, S3). */
  readonly deleted?: readonly TestFileRef[];
  /** A commit asked for the file at its key (row 019-22): it runs for this commit. */
  readonly asked?: (record: TestFileKeyRecord) => boolean;
  /** The file waits for a commit no commit asked it for (row 019-22): it runs for no one. */
  readonly held?: (record: TestFileKeyRecord) => boolean;
}

/** `testTally`'s counts only. */
export function testCounts(
  view: Pick<CommitView, "closure" | "isEnvironmentInput" | "testFiles" | "states">,
  side: TallySide,
): CommitTestCounts {
  return testTally(view, side).counts;
}

/** The counts of one report's test files, and those it counts as running. */
export interface TestTally {
  readonly counts: CommitTestCounts;
  readonly running: readonly TestFileKeyRecord[];
}

/**
 * D5 step 2: each listed test file once. Its key is the committed one when
 * no path of its closure differs (`differing`) and no environment input
 * does; then its current result is the commit's: its current failing checks
 * count as failures, a file a commit asked for (`asked`) and queued or
 * running as running, a file with neither as unknown. Otherwise it is not
 * determined for this commit, and Squeal runs nothing on the committed tree
 * (open question 4); `untracked` counts those of them that differ only
 * through files the commit does not hold. A file with no key, or no known
 * closure, is unknown. Each of the commit's test files the working tree
 * deleted is not determined too. Row 019-28 (lessons P1): a queued file no
 * commit asked for is not the commit's work: it runs at its own moment and
 * the report leaves it out, unless it waits for a commit no commit asked it
 * for (`held`): then it runs for no one and is unknown. Row 019-37 (lessons
 * P11): the first `NOT_DETERMINED_KEPT` files not determined are named with
 * the paths that make them so (`notDeterminedFiles`). Row 019-39 (review
 * 0.1.402 B2): `unanswered` counts those not determined through a path git
 * did not answer for and through no path staged differently (`apartBy`);
 * each named file marks the paths git did not answer for.
 */
export function testTally(
  view: Pick<CommitView, "closure" | "isEnvironmentInput" | "testFiles" | "states">,
  side: TallySide,
): TestTally {
  const { differing, untracked = new Set(), unanswered = new Set(), deleted = [] } = side;
  const { asked = () => false, held = () => false } = side;
  const environment = [...differing].filter((path) => view.isEnvironmentInput(path));
  const byFile = new Map<string, KnownState[]>();
  for (const state of view.states()) {
    const id = fileId(state.check.project, state.check.testPath);
    byFile.set(id, [...(byFile.get(id) ?? []), state]);
  }
  const counts = {
    files: deleted.length,
    failures: 0,
    notDetermined: deleted.length,
    running: 0,
    unknown: 0,
    untracked: 0,
    unanswered: 0,
  };
  const running: TestFileKeyRecord[] = [];
  const named: NotDeterminedTestFile[] = deleted.map((ref) => ({
    ...ref,
    through: [],
    deleted: true,
  }));
  for (const record of view.testFiles()) {
    counts.files += 1;
    const closure = record.key === null ? undefined : view.closure(record.testFile);
    if (closure === undefined) {
      counts.unknown += 1;
      continue;
    }
    const apart = [...new Set([...environment, ...closure.filter((path) => differing.has(path))])];
    if (apart.length > 0) {
      counts.notDetermined += 1;
      const by = apartBy(apart, untracked, unanswered);
      if (by !== "unstaged") counts[by] += 1;
      named.push(notDeterminedFile(record.testFile, apart, unanswered));
      continue;
    }
    const states = byFile.get(fileId(record.testFile.project, record.testFile.path)) ?? [];
    const current = states.filter((s) => s.validity === "current");
    if (current.length > 0) {
      counts.failures += current.filter((s) => s.outcome === "fail").length;
    } else if (record.pending === null || held(record)) {
      counts.unknown += 1;
    } else if (asked(record)) {
      counts.running += 1;
      running.push(record);
    }
  }
  return { counts: shownCounts(counts, named), running };
}

/**
 * Why a test file is not determined through `apart`: only untracked files
 * (row 019-28), a file git did not answer for and no file that differs
 * otherwise (row 019-39), or unstaged changes.
 */
function apartBy(
  apart: readonly RelativePath[],
  untracked: ReadonlySet<RelativePath>,
  unanswered: ReadonlySet<RelativePath>,
): "untracked" | "unanswered" | "unstaged" {
  if (apart.every((path) => untracked.has(path))) return "untracked";
  const differs = (path: RelativePath) => !untracked.has(path) && !unanswered.has(path);
  return apart.some(differs) ? "unstaged" : "unanswered";
}

/** The counts as a report keeps them: `untracked` and `unanswered` only when not zero, the first named files. */
function shownCounts(
  counts: Omit<CommitTestCounts, "untracked" | "unanswered" | "notDeterminedFiles"> & {
    readonly untracked: number;
    readonly unanswered: number;
  },
  named: readonly NotDeterminedTestFile[],
): CommitTestCounts {
  const { untracked, unanswered, ...rest } = counts;
  const kept = named.slice(0, NOT_DETERMINED_KEPT);
  return {
    ...rest,
    ...(untracked > 0 ? { untracked } : {}),
    ...(unanswered > 0 ? { unanswered } : {}),
    ...(kept.length > 0 ? { notDeterminedFiles: kept } : {}),
  };
}

/**
 * Row 019-37: a not-determined test file with at most `THROUGH_KEPT` of the
 * paths that make it so; row 019-39: those of them git did not answer for.
 */
function notDeterminedFile(
  testFile: TestFileRef,
  apart: readonly RelativePath[],
  unanswered: ReadonlySet<RelativePath>,
): NotDeterminedTestFile {
  const more = apart.length - THROUGH_KEPT;
  const through = apart.slice(0, THROUGH_KEPT);
  const silent = through.filter((path) => unanswered.has(path));
  return {
    project: testFile.project,
    path: testFile.path,
    through,
    ...(more > 0 ? { more } : {}),
    ...(silent.length > 0 ? { unanswered: silent } : {}),
  };
}
