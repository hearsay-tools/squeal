// 011-162 measurement, not product code (brief question 7). Run from the Squeal worktree root:
//   npx tsx docs/specifications/011-core/tasks/011-162/probes/measure-pnpm.mts <rootA> <rootB> [out.json]
// Two clones of one pnpm repository at equal project files with different installs. Each tree's
// closures come from Squeal's own Vitest adapter over its own install, so a package entry Vite
// resolved names that install's `.pnpm` folder. Keys: today's (the whole fingerprint) and the
// design's (`pnpm-graph.mjs` as `InstalledDependencies.graph`, the core's `dependencyKeys`).
import { writeFileSync } from "node:fs";
import {
  dependencyKeys,
  installedDependencies,
  OPAQUE_BUILTINS,
  PackageScans,
} from "../../../../../../src/core/keys/index.js";
import type { RunnerClosure, RunnerEnvironment } from "../../../../../../src/core/types/index.js";
import { createVitestAdapter } from "../../../../../../src/runners/vitest/index.js";
// @ts-expect-error a probe module without types
import { PnpmGraph, readInstall, staleLock } from "./pnpm-graph.mjs";

const [rootA, rootB, out] = process.argv.slice(2);
if (rootA === undefined || rootB === undefined) throw new Error("usage: measure-pnpm.mts <rootA> <rootB> [out.json]");

interface Tree {
  root: string;
  environments: RunnerEnvironment[];
  closures: RunnerClosure[];
  walkMs: number;
}

async function walk(root: string): Promise<Tree> {
  const t0 = performance.now();
  const adapter = await createVitestAdapter({ root });
  const refs = await adapter.testFiles();
  const environments = await adapter.environment();
  const closures: RunnerClosure[] = [];
  for (const ref of refs) closures.push(await adapter.closure(ref));
  await adapter.close();
  return { root, environments, closures, walkMs: Math.round(performance.now() - t0) };
}

const idOf = (c: RunnerClosure) => `${c.testFile.project}:${c.testFile.path}`;
const SPAWNS = ["child_process", "worker_threads", "cluster"];

async function keys(tree: Tree, edges: boolean) {
  const scans = new PackageScans();
  const t0 = performance.now();
  const installed = await installedDependencies(tree.root, tree.root, scans);
  const install = readInstall(tree.root);
  const readMs = performance.now() - t0;
  const t1 = performance.now();
  const stale = install.reason === undefined ? staleLock(tree.root, install) : install.reason;
  const trustMs = performance.now() - t1;
  const graph = stale === null ? new PnpmGraph(tree.root, "", install, scans, { edges }) : null;
  const t2 = performance.now();
  const today = new Map<string, string>();
  const design = new Map<string, string>();
  const why = new Map<string, string>();
  const envScoped: Record<string, boolean> = {};
  const byProject = new Map(
    tree.environments.map((env) => [
      env.project,
      {
        now: dependencyKeys(installed, env.packages),
        next: dependencyKeys({ ...installed, graph }, env.packages),
        env,
      },
    ]),
  );
  for (const [project, { next }] of byProject) envScoped[project] = next.environment !== installed.fingerprint;
  for (const closure of tree.closures) {
    const entry = byProject.get(closure.testFile.project);
    if (entry === undefined) throw new Error(`no environment for ${closure.testFile.project}`);
    const id = idOf(closure);
    today.set(id, `${entry.now.environment}\0${entry.now.of(closure.packages)}`);
    const segment = entry.next.of(closure.packages);
    design.set(id, `${entry.next.environment}\0${segment}`);
    const runner = new Set<string>(graph?.identities(entry.env.packages?.runner ?? []) ?? []);
    why.set(id, reason(closure, segment, envScoped[closure.testFile.project] ?? false, graph, runner));
  }
  const keyMs = performance.now() - t2;
  return {
    installed,
    stale,
    orphans: install.orphans ?? null,
    today,
    design,
    why,
    envScoped,
    graph,
    ms: { read: Math.round(readMs), parse: Math.round(install.parseMs ?? 0), trust: Math.round(trustMs), key: Math.round(keyMs), scans: Math.round(scans.scanMs), scanned: scans.scanned },
  };
}

function reason(
  closure: RunnerClosure,
  segment: string,
  scoped: boolean,
  graph: InstanceType<typeof PnpmGraph> | null,
  runner: Set<string>,
): string {
  if (graph === null) return "no graph (whole fingerprint)";
  if (!scoped) return "environment whole";
  const packages = closure.packages;
  if (packages === undefined) return "(5) no packages reported";
  if (packages.builtins.some((b) => SPAWNS.includes(b))) return "(1) child_process, worker_threads or cluster";
  if (packages.builtins.includes("module")) return "(1)-(3) module, a hand-made resolution or an unnamed file";
  if (segment.startsWith("whole:")) {
    const opaque = graph
      .identities(packages.imports)
      .filter((identity: string) => !runner.has(identity) && graph.opaque([identity]))
      .map((identity: string) => identity.replace(/#.*$/, ""));
    return `(4) opaque: ${[...new Set(opaque)].sort().join(", ")}`;
  }
  return "own segment";
}

const uptime = async () => (await import("node:os")).loadavg().map((n) => n.toFixed(1)).join(" ");
const loadBefore = await uptime();
const [a, b] = [await walk(rootA), await walk(rootB)];
const loadAfterWalk = await uptime();
const edges = process.env.EDGES !== "0";
const [ka, kb] = [await keys(a, edges), await keys(b, edges)];

const ids = [...ka.design.keys()];
const onlyA = ids.filter((id) => !kb.design.has(id));
const both = ids.filter((id) => kb.design.has(id));
const keptToday = both.filter((id) => ka.today.get(id) === kb.today.get(id));
const keptDesign = both.filter((id) => ka.design.get(id) === kb.design.get(id));
const tally = (set: string[], keyed: Map<string, string>) => {
  const counts: Record<string, number> = {};
  for (const id of set) {
    const label = keyed.get(id) ?? "?";
    const short = label.startsWith("(4)") ? "(4) opaque package" : label;
    counts[short] = (counts[short] ?? 0) + 1;
  }
  return counts;
};
const opaqueNames: Record<string, number> = {};
for (const id of both) {
  const label = ka.why.get(id) ?? "";
  if (!label.startsWith("(4)")) continue;
  for (const name of label.slice("(4) opaque: ".length).split(", ")) opaqueNames[name] = (opaqueNames[name] ?? 0) + 1;
}
const ownChanged = both.filter((id) => ka.why.get(id) === "own segment" && ka.design.get(id) !== kb.design.get(id));

const report = {
  rootA,
  rootB,
  edgesInIdentity: edges,
  load: { before: loadBefore, afterWalk: loadAfterWalk, end: await uptime() },
  walkMs: [a.walkMs, b.walkMs],
  testFiles: [a.closures.length, b.closures.length],
  onlyInA: onlyA.length,
  fingerprintEqual: ka.installed.fingerprint === kb.installed.fingerprint,
  stale: [ka.stale, kb.stale],
  orphanFolders: [ka.orphans, kb.orphans],
  environmentScoped: [ka.envScoped, kb.envScoped],
  keptToday: keptToday.length,
  keptDesign: keptDesign.length,
  byCaseA: tally(both, ka.why),
  keptByCase: tally(keptDesign, ka.why),
  reKeyedOwnSegment: ownChanged.length,
  reKeyedOwnSegmentSample: ownChanged.slice(0, 8),
  opaquePackagesByFiles: Object.fromEntries(Object.entries(opaqueNames).sort((x, y) => y[1] - x[1])),
  unknownFolders: [ka.graph?.unknown ?? null, kb.graph?.unknown ?? null],
  ms: [ka.ms, kb.ms],
};
console.log(JSON.stringify(report, null, 2));
if (out !== undefined) {
  writeFileSync(out, JSON.stringify({ report, why: Object.fromEntries(ka.why), closures: a.closures, environments: a.environments }, null, 1));
}
