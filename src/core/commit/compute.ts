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

/**
 * D5 step 2: each listed test file once. Its key is the committed one when
 * no path of its closure differs (`differing`) and no environment input
 * does; then its current result is the commit's: its current failing checks
 * count as failures, a queued or running file as running, a file with
 * neither as unknown. Otherwise it is not determined for this commit, and
 * Squeal runs nothing on the committed tree (open question 4). A file with
 * no key, or no known closure, is unknown.
 */
export function testCounts(
  view: Pick<CommitView, "closure" | "isEnvironmentInput" | "testFiles" | "states">,
  differing: ReadonlySet<RelativePath>,
): CommitTestCounts {
  const environment = [...differing].some((path) => view.isEnvironmentInput(path));
  const byFile = new Map<string, KnownState[]>();
  for (const state of view.states()) {
    const id = fileId(state.check.project, state.check.testPath);
    byFile.set(id, [...(byFile.get(id) ?? []), state]);
  }
  const counts = { files: 0, failures: 0, notDetermined: 0, running: 0, unknown: 0 };
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
    } else if (record.pending !== null) {
      counts.running += 1;
    } else {
      counts.unknown += 1;
    }
  }
  return counts;
}
