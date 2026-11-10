import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AbsolutePath } from "../../../core/types/common.js";
import type { TestFileRef } from "../../../core/types/keys.js";

/*
 * Spec 015 D8 (row 015-86): V8 coverage of a node:test file's own process.
 * The run points `NODE_V8_COVERAGE` at one directory per file, and the
 * recorder deletes it in the test file's process at startup, so a process
 * the test spawns writes none, and names that process's pid there. Spec 020
 * D12: with `coverage.children`, the recorder points it at `children/` in
 * that directory instead, where the processes and threads the test starts
 * write theirs.
 */

/**
 * Spec 015 D8, 020 D12: what a test file's run takes: `false` no coverage,
 * `true` its own process's, `"children"` that of the processes it starts too.
 */
export type Covering = boolean | "children";

/** A completed file's coverage: the V8 file its own process's main thread wrote. */
export interface CoveragePayload {
  readonly testFile: TestFileRef;
  readonly payload: AbsolutePath;
  /** Spec 020 D12: the directory its children wrote into, when they were measured. */
  readonly children?: AbsolutePath;
}

/** Where the process of the run's file `index` writes its coverage. */
export function coverageDir(logDir: AbsolutePath, index: number): AbsolutePath {
  return join(logDir, `cov-${index}`);
}

/** The env of a covered file's run, for the recorder to delete or point at `children/` (`recorder.cjs`). */
export function coverageEnv(dir: AbsolutePath, covering: Covering = true): Record<string, string> {
  mkdirSync(dir, { recursive: true });
  const env = { NODE_V8_COVERAGE: dir, SQUEAL_NODE_TEST_COVERAGE: dir };
  return covering === "children" ? { ...env, SQUEAL_NODE_TEST_CHILDREN: "1" } : env;
}

/** Node's name of a main thread's file: `coverage-<pid>-<time>-0.json` (thread 0). */
const MAIN_THREAD = /^coverage-(\d+)-\d+-0\.json$/;
const OWN = /^own-(\d+)$/;
/** Spec 020 D12: where the recorder points the variable for the processes a test starts. */
const CHILDREN = "children";

/**
 * After `runNodeTest` ran `files` into `logDir`: of each covered file that
 * completed, the payload its own process wrote, the one main-thread file
 * of the one pid the recorder named, and its `children/` directory when
 * there is one. None when the directory cannot tell its process's file
 * apart (no pid named, or several files of it, as after a test's
 * `v8.takeCoverage()`). Every other file is deleted.
 */
export function coveragePayloads(
  logDir: AbsolutePath,
  files: readonly TestFileRef[],
  completed: readonly TestFileRef[],
): CoveragePayload[] {
  const done = new Set(completed.map((f) => `${f.project}\0${f.path}`));
  const payloads: CoveragePayload[] = [];
  for (const [index, testFile] of files.entries()) {
    const dir = coverageDir(logDir, index);
    const payload = done.has(`${testFile.project}\0${testFile.path}`) ? ownPayload(dir) : null;
    const children = join(dir, CHILDREN);
    const kept = payload !== null && existsSync(children);
    for (const name of listed(dir)) {
      const path = join(dir, name);
      if (path === payload || (kept && path === children)) continue;
      rmSync(path, { force: true, recursive: name === CHILDREN });
    }
    if (payload !== null) payloads.push({ testFile, payload, ...(kept ? { children } : {}) });
  }
  return payloads;
}

function ownPayload(dir: AbsolutePath): AbsolutePath | null {
  const names = listed(dir);
  const pids = names.flatMap((name) => OWN.exec(name)?.[1] ?? []);
  if (pids.length !== 1) return null;
  const own = names.filter((name) => MAIN_THREAD.exec(name)?.[1] === pids[0]);
  return own.length === 1 && own[0] !== undefined ? join(dir, own[0]) : null;
}

/** A file the run never started made no directory. */
function listed(dir: AbsolutePath): string[] {
  return existsSync(dir) ? readdirSync(dir) : [];
}
