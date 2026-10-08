// Throwaway. Closures (spec 001 D3, D4) of this repository's test files from
// Squeal's own Vitest adapter, in the copy, plus affected() for sample edits:
//   cd $SCRATCH/squeal && npx tsx <this> $SCRATCH/squeal > out.json
import { createVitestAdapter } from "../../../../../../src/runners/vitest/index.js";

const root = process.argv[2];
const adapter = await createVitestAdapter({ root: root as never, note: (t) => console.error("note:", t) });
const files = await adapter.testFiles();
const out: Record<string, unknown> = {};
let all = 0;
for (const ref of files) {
  const c = await adapter.closure(ref);
  all += 1;
  const p = c.paths;
  const isE2e = ref.path.startsWith("test/e2e/");
  out[ref.path] = {
    paths: p.length,
    src: p.filter((x) => x.startsWith("src/")).length,
    plugins: p.filter((x) => x.startsWith("plugins/")).length,
    test: p.filter((x) => x.startsWith("test/")).length,
    ...(isE2e ? { list: p } : {}),
  };
}
const affected: Record<string, unknown> = {};
for (const changed of [
  "src/core/scheduler/batch.ts",
  "src/harness/claude-code/build.ts",
  "src/runners/node-test/graph/resolver.ts",
  "plugins/claude-code/dist/session-start.mjs",
  "test/e2e/harness.ts",
]) {
  const a = await adapter.affected([changed as never]);
  const e2e = (xs: readonly { path: string }[]) => xs.filter((x) => x.path.startsWith("test/e2e/")).map((x) => x.path);
  affected[changed] = { direct: a.direct.length, transitive: a.transitive.length, e2eDirect: e2e(a.direct), e2eTransitive: e2e(a.transitive) };
}
console.log(JSON.stringify({ testFiles: all, affected, files: out }, null, 1));
await adapter.close();
