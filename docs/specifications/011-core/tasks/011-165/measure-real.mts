// 011-165 to 011-167 check on real data, not product code: `../011-162/probes/measure-pnpm.mts`
// with the real code in place of the prototype. Run from the Squeal worktree root:
//   npx tsx docs/specifications/011-core/tasks/011-165/measure-real.mts <rootA> <rootB>
// Two clones of one pnpm repository at equal project files with different installs. Each tree's
// closures come from Squeal's own Vitest adapter over its own install. Keys: today's (the whole
// fingerprint: `installedDependencies` without its graph) and the code's (`dependencyKeys` over
// `installedDependencies` as it is). R3: whether each file's key under today's pnpm definition is
// among the keys a lookup reads as one under the code (`formerPnpm`).
import { loadavg } from "node:os";
import {
  dependencyKeys,
  type InstalledDependencies,
  installedDependencies,
  PackageScans,
} from "../../../../../src/core/keys/index.js";
import type { RunnerClosure, RunnerEnvironment } from "../../../../../src/core/types/index.js";
import { createVitestAdapter } from "../../../../../src/runners/vitest/index.js";

const [rootA, rootB] = process.argv.slice(2);
if (rootA === undefined || rootB === undefined) throw new Error("usage: measure-real.mts <rootA> <rootB>");

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

async function keys(tree: Tree) {
  const t0 = performance.now();
  const installed = await installedDependencies(tree.root, tree.root, new PackageScans());
  const readMs = Math.round(performance.now() - t0);
  const whole: InstalledDependencies = { ...installed, graph: null, former: null, formerPnpm: null };
  const today = new Map<string, string>();
  const code = new Map<string, string>();
  const readable = new Map<string, boolean>();
  const own = new Set<string>();
  const t1 = performance.now();
  const byProject = new Map(
    tree.environments.map((env) => [
      env.project,
      { now: dependencyKeys(whole, env.packages), next: dependencyKeys(installed, env.packages) },
    ]),
  );
  for (const closure of tree.closures) {
    const entry = byProject.get(closure.testFile.project);
    if (entry === undefined) throw new Error(`no environment for ${closure.testFile.project}`);
    const id = idOf(closure);
    const todayKey = `${entry.now.environment}\0${entry.now.of(closure.packages)}`;
    const segment = entry.next.of(closure.packages);
    today.set(id, todayKey);
    code.set(id, `${entry.next.environment}\0${segment}`);
    if (segment !== "" && !segment.startsWith("whole:")) own.add(id);
    // A lookup that misses reads the current key's own pnpm former, or finds the key itself.
    const pnpm = entry.next.formerPnpm;
    const former = pnpm == null ? null : `${pnpm.environment}\0${pnpm.of(closure.packages)}`;
    readable.set(id, code.get(id) === todayKey || former === todayKey);
  }
  return {
    installed,
    today,
    code,
    own,
    readable,
    ms: { read: readMs, key: Math.round(performance.now() - t1) },
  };
}

const load = () => loadavg().map((n) => n.toFixed(1)).join(" ");
const loadBefore = load();
const [a, b] = [await walk(rootA), await walk(rootB)];
const loadAfterWalk = load();
const [ka, kb] = [await keys(a), await keys(b)];
const both = [...ka.code.keys()].filter((id) => kb.code.has(id));
const kept = (keyed: (k: typeof ka) => Map<string, string>) =>
  both.filter((id) => keyed(ka).get(id) === keyed(kb).get(id));
const keptCode = kept((k) => k.code);
const ownChanged = both.filter((id) => ka.own.has(id) && ka.code.get(id) !== kb.code.get(id));
console.log(
  JSON.stringify(
    {
      rootA,
      rootB,
      load: { before: loadBefore, afterWalk: loadAfterWalk, end: load() },
      walkMs: [a.walkMs, b.walkMs],
      testFiles: [a.closures.length, b.closures.length],
      graph: [ka.installed.graph !== null, kb.installed.graph !== null],
      note: [ka.installed.note, kb.installed.note],
      fingerprintEqual: ka.installed.fingerprint === kb.installed.fingerprint,
      ownSegment: [ka.own.size, kb.own.size],
      keptToday: kept((k) => k.today).length,
      keptCode: keptCode.length,
      keptOwnSegment: keptCode.filter((id) => ka.own.has(id)).length,
      reKeyedOwnSegment: ownChanged,
      todayReadableAsOne: [
        [...ka.readable.values()].filter(Boolean).length,
        [...kb.readable.values()].filter(Boolean).length,
      ],
      ms: [ka.ms, kb.ms],
    },
    null,
    2,
  ),
);
