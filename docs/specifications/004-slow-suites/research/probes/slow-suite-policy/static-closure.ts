// Throwaway. Static closures (spec 003 D3) of cezarion's test:package files,
// computed by Squeal's own graph builder in the copy:
//   cd $SCRATCH/squeal && npx tsx <this> $SCRATCH/cezar > out.json
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createNodeTestGraph } from "../../../../../../src/runners/node-test/graph/index.js";

const root = process.argv[2];
const cwd = join(root, "packages/cezar");
const files = readdirSync(join(cwd, "test/e2e"))
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => `packages/cezar/test/e2e/${f}`);
const t0 = performance.now();
const graph = await createNodeTestGraph({
  root: root as never,
  cwd: cwd as never,
  argv: ["--import", "../../scripts/test-git-env.mjs", "--import", "tsx"],
  testFiles: files as never,
});
const built = performance.now() - t0;
const out: Record<string, unknown> = {};
for (const f of files) {
  const c = graph.closure(f as never);
  out[f] = {
    paths: c.paths.length,
    src: c.paths.filter((p) => p.startsWith("packages/cezar/src/")).length,
    dist: c.paths.filter((p) => p.includes("/dist/")).length,
    complete: c.complete,
    incomplete: c.incomplete,
    list: c.paths,
  };
}
console.log(JSON.stringify({ buildMs: Math.round(built), preloads: graph.preloads().paths, notes: graph.notes(), files: out }, null, 1));
