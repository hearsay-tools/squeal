import { mkdirSync, readdirSync, rmSync } from "node:fs";
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

/** The env of a covered file's run, for the recorder to delete (`recorder.cjs`). */
export function coverageEnv(dir: AbsolutePath): Record<string, string> {
  mkdirSync(dir, { recursive: true });
  return { NODE_V8_COVERAGE: dir, SQUEAL_NODE_TEST_COVERAGE: dir };
}

/** Node's name of a main thread's file: `coverage-<pid>-<time>-0.json` (thread 0). */
const MAIN_THREAD = /^coverage-(\d+)-\d+-0\.json$/;
const OWN = /^own-(\d+)$/;

/**
 * Of each covered file, the payload its own process wrote when it
 * completed: the one main-thread file of the one pid the recorder named.
 * None when the file did not complete, or the directory cannot tell its
 * process's file apart (no pid named, or several files of it, as after a
 * test's `v8.takeCoverage()`). Every other file is deleted.
 */
export function coveragePayloads(
  runs: readonly {
    readonly testFile: TestFileRef;
    readonly coverage: AbsolutePath | null;
    readonly completed: boolean;
  }[],
): CoveragePayload[] {
  const payloads: CoveragePayload[] = [];
  for (const { testFile, coverage, completed } of runs) {
    if (coverage === null) continue;
    const payload = completed ? ownPayload(coverage) : null;
    for (const name of listed(coverage)) {
      if (join(coverage, name) !== payload) rmSync(join(coverage, name), { force: true });
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

function listed(dir: AbsolutePath): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
