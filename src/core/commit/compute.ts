import type {
  FileHash,
  KnownState,
  RelativePath,
  TestFileKeyRecord,
  TestFileRef,
} from "../types/index.js";
import type { CommitTestCounts } from "./report.js";

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
}

/**
 * The paths whose file in the working tree, as the keys hashed it, is not
 * the commit's: a different blob, a file only one side has. A path the
 * commit does not hold that git ignores is no difference: the commit says
 * nothing of it, and its checkout keeps the file on disk. A path the view
 * does not track is left out; a closure holding one has no key.
 */
export async function differingPaths(
  view: Pick<CommitView, "hashOf" | "paths" | "ignoredAmong">,
  committed: ReadonlyMap<RelativePath, FileHash>,
): Promise<Set<RelativePath>> {
  const differing = new Set<RelativePath>();
  const absent: RelativePath[] = [];
  const consider = (path: RelativePath) => {
    const hash = view.hashOf(path);
    if (hash === undefined || differing.has(path)) return;
    const blob = committed.get(path) ?? null;
    if (hash === blob) return;
    differing.add(path);
    if (blob === null) absent.push(path);
  };
  for (const path of view.paths()) consider(path);
  for (const path of committed.keys()) consider(path);
  if (absent.length > 0) for (const path of await view.ignoredAmong(absent)) differing.delete(path);
  return differing;
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

/** `testTally`'s counts only. */
export function testCounts(
  view: Pick<CommitView, "closure" | "isEnvironmentInput" | "testFiles" | "states">,
  differing: ReadonlySet<RelativePath>,
  deleted: readonly TestFileRef[] = [],
  held: (record: TestFileKeyRecord) => boolean = () => false,
): CommitTestCounts {
  return testTally(view, differing, deleted, held).counts;
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
 * count as failures, a queued or running file as running, a file with
 * neither as unknown. Otherwise it is not determined for this commit, and
 * Squeal runs nothing on the committed tree (open question 4). A file with
 * no key, or no known closure, is unknown. Each of the commit's test files
 * the working tree deleted (`deleted`, S3) is not determined too. A queued
 * file that waits for a commit no commit asked it for (`held`, row 019-22)
 * runs for no one: it is unknown.
 */
export function testTally(
  view: Pick<CommitView, "closure" | "isEnvironmentInput" | "testFiles" | "states">,
  differing: ReadonlySet<RelativePath>,
  deleted: readonly TestFileRef[],
  held: (record: TestFileKeyRecord) => boolean,
): TestTally {
  const environment = environmentDiffers(view, differing);
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
  };
  const running: TestFileKeyRecord[] = [];
  for (const record of view.testFiles()) {
    counts.files += 1;
    const closure = record.key === null ? undefined : view.closure(record.testFile);
    if (closure === undefined) {
      counts.unknown += 1;
      continue;
    }
    if (environment || closure.some((path) => differing.has(path))) {
      counts.notDetermined += 1;
      continue;
    }
    const states = byFile.get(fileId(record.testFile.project, record.testFile.path)) ?? [];
    const current = states.filter((s) => s.validity === "current");
    if (current.length > 0) {
      counts.failures += current.filter((s) => s.outcome === "fail").length;
    } else if (record.pending !== null && !held(record)) {
      counts.running += 1;
      running.push(record);
    } else {
      counts.unknown += 1;
    }
  }
  return { counts, running };
}
