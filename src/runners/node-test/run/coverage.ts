import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AbsolutePath, TestFileRef } from "../../../core/types/index.js";

/*
 * Spec 015 D8 (row 015-86): V8 coverage of a node:test file's own process.
 * The run points `NODE_V8_COVERAGE` at one directory per file, and the
 * recorder deletes it in the test file's process at startup, so a process
 * the test spawns writes none, and names that process's pid there.
 */

/** A completed file's coverage: the V8 file its own process's main thread wrote. */
export interface CoveragePayload {
  readonly testFile: TestFileRef;
  readonly payload: AbsolutePath;
}

/** Where the process of the run's file `index` writes its coverage. */
export function coverageDir(logDir: AbsolutePath, index: number): AbsolutePath {
  return join(logDir, `cov-${index}`);
}

/** The env of a covered file's run, for the recorder to delete (`recorder.cjs`). */
export function coverageEnv(dir: AbsolutePath): Record<string, string> {
  mkdirSync(dir, { recursive: true });
  return { NODE_V8_COVERAGE: dir, SQUEAL_NODE_TEST_COVERAGE: dir };
}

/** Node's name of a main thread's file: `coverage-<pid>-<time>-0.json` (thread 0). */
const MAIN_THREAD = /^coverage-(\d+)-\d+-0\.json$/;
const OWN = /^own-(\d+)$/;

/**
 * After `runNodeTest` ran `files` into `logDir`: of each covered file that
 * completed, the payload its own process wrote, the one main-thread file
 * of the one pid the recorder named. None when the directory cannot tell
 * its process's file apart (no pid named, or several files of it, as after
 * a test's `v8.takeCoverage()`). Every other file is deleted.
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
    for (const name of listed(dir)) {
      if (join(dir, name) !== payload) rmSync(join(dir, name), { force: true });
    }
    if (payload !== null) payloads.push({ testFile, payload });
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
