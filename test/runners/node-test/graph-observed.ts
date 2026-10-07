import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

/**
 * The closure a run loads, for the node-test graph tests: the static closure
 * of spec 003 D3 must equal it, manifests aside.
 */

/** `package.json` and `tsconfig*.json`: read by resolution, never loaded. */
export const MANIFEST = /(^|\/)(package|tsconfig[^/]*)\.json$/;

/** A `module.registerHooks` resolve hook appending `(parent, url)` per process, as D5's recorder will. */
const RECORDER = `import { appendFileSync } from "node:fs";
import { registerHooks } from "node:module";
const out = \`\${process.env.GRAPH_TEST_EDGES}/graph-\${process.pid}.ndjson\`;
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    appendFileSync(out, JSON.stringify([context.parentURL ?? null, result.url]) + "\\n");
    return result;
  },
});
`;

/**
 * Runs one test file under the recorder, first in the loader chain, and
 * returns the worktree paths reachable from it, `node_modules` excluded.
 */
export function observedClosure(
  root: string,
  cwd: string,
  argv: readonly string[],
  file: string,
): string[] {
  const dir = mkdtempSync(join(tmpdir(), "squeal-node-test-observed-"));
  const recorder = join(dir, "recorder.mjs");
  writeFileSync(recorder, RECORDER);
  const run = spawnSync(process.execPath, ["--import", recorder, ...argv, "--test", file], {
    cwd,
    env: { ...process.env, GRAPH_TEST_EDGES: dir },
    encoding: "utf8",
  });
  expect(run.status, run.stdout + run.stderr).toBe(0);
  const edges = new Map<string, Set<string>>();
  for (const name of readdirSync(dir).filter((f) => f.startsWith("graph-"))) {
    for (const line of readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean)) {
      const [parent, url] = JSON.parse(line) as [string | null, string];
      if (parent === null || !url.startsWith("file:")) continue;
      const children = edges.get(parent) ?? new Set();
      children.add(url);
      edges.set(parent, children);
    }
  }
  const start = `file://${resolve(cwd, file)}`;
  const seen = new Set([start]);
  const stack = [start];
  for (let url = stack.pop(); url !== undefined; url = stack.pop()) {
    for (const child of edges.get(url) ?? []) {
      if (!seen.has(child)) seen.add(child) && stack.push(child);
    }
  }
  rmSync(dir, { recursive: true, force: true });
  return [...seen]
    .map((url) => relative(root, fileURLToPath(url)))
    .filter((p) => !p.startsWith("..") && !p.split("/").includes("node_modules"))
    .sort();
}
