// Review 0.1.282 B2.1, not product code: counts the skipped links in a pnpm install and how many
// have another copy Node walks on to. Run under the 011-162 isolation:
//   npx tsx skipped-walks.mts <squeal worktree> <pnpm install root>
import { readFileSync } from "node:fs";
import { join } from "node:path";
const W = process.argv[2] as string;
const root = process.argv[3] as string;
const { childOf, PnpmGraph } = await import(`${W}/src/core/keys/pnpm-graph.ts`);
const { readPnpmLockfile } = await import(`${W}/src/core/keys/pnpm-lockfile.ts`);
const lockfile = readPnpmLockfile(readFileSync(join(root, "node_modules/.pnpm/lock.yaml"), "utf8"));
const modules = JSON.parse(readFileSync(join(root, "node_modules/.modules.yaml"), "utf8"));
const graph = new PnpmGraph(root, "", lockfile, modules);
const installed = (t: string | undefined) => t !== undefined && !graph.skipped.has(t);
const atRoot = (name: string) => {
  const ref = lockfile.importers.get(".")?.get(name);
  return installed(ref === undefined ? undefined : childOf(name, ref)) || installed(graph.publicHoisted.get(name));
};
let edges = 0, edgeCopies = 0, declared = 0, declaredCopies = 0;
for (const [id, edgeMap] of lockfile.snapshots) {
  if (graph.skipped.has(id)) continue;
  for (const [name, ref] of edgeMap) {
    if (!graph.skipped.has(childOf(name, ref))) continue;
    edges++;
    if (installed(graph.privateHoisted.get(name)) || atRoot(name)) edgeCopies++;
  }
}
for (const [importer, names] of lockfile.importers) {
  for (const [name, ref] of names) {
    if (!graph.skipped.has(childOf(name, ref))) continue;
    declared++;
    if (importer !== "." && atRoot(name)) declaredCopies++;
  }
}
const publicSkipped = [...graph.publicHoisted.values()].filter((id) => graph.skipped.has(id)).length;
const privateSkipped = [...graph.privateHoisted.values()].filter((id) => graph.skipped.has(id)).length;
console.log(JSON.stringify({ skipped: graph.skipped.size, skippedEdges: edges, edgesWithAnotherCopy: edgeCopies, skippedDeclared: declared, declaredWithAnotherCopy: declaredCopies, hoistsOfSkipped: publicSkipped + privateSkipped, stale: (await import(`${W}/src/core/keys/pnpm-install.ts`)).stalePnpmLockfile(root, graph) }));
