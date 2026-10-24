// Throwaway probe setup file (015 R3), used only in the /tmp scratch copy.
// Points NODE_V8_COVERAGE at one directory per test file, after the Vitest
// worker started, so the worker writes nothing and only the children it
// spawns (and theirs) write raw V8 coverage, attributed to this test file.
import { join, relative } from "node:path";
import { beforeAll, expect } from "vitest";

const ROOT = process.env.R3_CHILD_RAW;
if (ROOT === undefined) throw new Error("R3_CHILD_RAW unset");

function dirFor(file: string): string {
  return join(ROOT, relative(process.cwd(), file).replaceAll("/", "__"));
}

// Set at import too: a child spawned at module top level still gets attributed.
const state = (globalThis as { __vitest_worker__?: { filepath?: string } }).__vitest_worker__;
if (state?.filepath) process.env.NODE_V8_COVERAGE = dirFor(state.filepath);

// Vitest 5 passes the suite second; the first argument must destructure.
beforeAll(({}, suite) => {
  const file = (suite as { file?: { filepath?: string }; filepath?: string }).file?.filepath ??
    (suite as { filepath?: string }).filepath ?? expect.getState().testPath;
  if (file) process.env.NODE_V8_COVERAGE = dirFor(file);
});
