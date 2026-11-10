// Throwaway probe setup file for research/child-coverage.md (Q5). Not product code.
// Sets NODE_V8_COVERAGE inside the Vitest worker after it started, one
// directory per test file, as a `coverage.children: true` provider would:
// the worker writes nothing, and every process a test spawns writes its
// coverage there and sees the variable. The test code sees it too.
import { mkdirSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.env.PROBE_CHILD_RAW;
if (root === undefined) throw new Error("PROBE_CHILD_RAW unset");
const file = (globalThis as { __vitest_worker__?: { filepath?: string } }).__vitest_worker__?.filepath;
const dir = join(root, relative(process.cwd(), file ?? "unknown").replaceAll("/", "__"));
mkdirSync(dir, { recursive: true });
process.env.NODE_V8_COVERAGE = dir;
