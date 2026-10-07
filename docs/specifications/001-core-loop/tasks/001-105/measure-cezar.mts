// Task 001-105 measurement, not product code; task 001-109 adds the opaque-package figures.
// Run from the Squeal worktree root:
//   npx tsx docs/specifications/001-core-loop/tasks/001-105/measure-cezar.mts <origin-root> <main-root> [out.json]
// <origin-root>: a `cezar` checkout of `origin/main` with a fresh `npm ci`; closures are taken from
// it once through Squeal's own Vitest adapter, so only the install varies (research F3).
// <main-root>: the main checkout, whose install is compared.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  dependencyKeys,
  type InstalledDependencies,
  InstalledGraph,
  installedDependencies,
  OPAQUE_BUILTINS,
  PackageScans,
} from "../../../../../src/core/keys/index.js";
import type { RunnerClosure, RunnerEnvironment } from "../../../../../src/core/types/index.js";
import { createVitestAdapter } from "../../../../../src/runners/vitest/index.js";

const [origin, main, out] = process.argv.slice(2);
if (origin === undefined || main === undefined) throw new Error("usage: measure-cezar.mts <origin-root> <main-root> [out.json]");

const t0 = performance.now();
const adapter = await createVitestAdapter({ root: origin });
const refs = await adapter.testFiles();
const environments = await adapter.environment();
const closures: RunnerClosure[] = [];
for (const ref of refs) closures.push(await adapter.closure(ref));
await adapter.close();
const walkMs = Math.round(performance.now() - t0);

/** The main checkout's lockfile read as-is, as research F3 did, staleness ignored. */
async function asIs(root: string): Promise<InstalledDependencies> {
  const installed = await installedDependencies(root, root);
  const content = JSON.parse(readFileSync(join(root, "node_modules/.package-lock.json"), "utf8"));
  return { ...installed, note: null, graph: new InstalledGraph(root, "", content.packages) };
}

type Keyed = Map<string, string>;
const WHOLE = /^whole:/;
function keysOf(installed: InstalledDependencies): { keys: Keyed; ms: number; whole: Set<string> } {
  const t = performance.now();
  const byProject = new Map(
    environments.map((env: RunnerEnvironment) => [env.project, dependencyKeys(installed, env.packages)]),
  );
  const keys: Keyed = new Map();
  const whole = new Set<string>();
  for (const closure of closures) {
    const dk = byProject.get(closure.testFile.project);
    if (dk === undefined) throw new Error(`no environment for ${closure.testFile.project}`);
    const id = `${closure.testFile.project}:${closure.testFile.path}`;
    const segment = dk.of(closure.packages);
    if (WHOLE.test(segment) || segment === "") whole.add(id);
    keys.set(id, `${dk.environment}\0${segment}`);
  }
  return { keys, ms: performance.now() - t, whole };
}

const spawns = new Set(
  closures
    .filter((c) => c.packages?.builtins.some((b) => OPAQUE_BUILTINS.has(b)))
    .map((c) => `${c.testFile.project}:${c.testFile.path}`),
);
const childProcess = new Set(
  closures
    .filter((c) => c.packages?.builtins.includes("child_process"))
    .map((c) => `${c.testFile.project}:${c.testFile.path}`),
);

const tRead = performance.now();
const scans = new PackageScans();
const originInstall = await installedDependencies(origin, origin, scans);
const readMs = Math.round(performance.now() - tRead);
const mainInstall = await installedDependencies(main, main);
// First keying with an empty scan cache: what a daemon start pays (task 001-109).
const originKeys = keysOf(originInstall);
const firstScans = { scanned: scans.scanned, ms: Math.round(scans.scanMs) };
// Second pass on a fresh read with the daemon's warm scan cache: the cost a revision pays.
const cold = keysOf(await installedDependencies(origin, origin, scans));

/** Every installed package of the origin lockfile scanned once, cold: the worst case. */
function scanAll(): { packages: number; opaque: number; ms: number } {
  const all = new PackageScans();
  const listed = JSON.parse(readFileSync(join(origin, "node_modules/.package-lock.json"), "utf8"));
  let opaque = 0;
  let packages = 0;
  const t = performance.now();
  for (const [location, entry] of Object.entries(listed.packages as Record<string, { version?: string; integrity?: string; link?: boolean }>)) {
    if (!location.includes("node_modules/") || entry.link === true) continue;
    packages += 1;
    if (all.opaque(`${location}@${entry.version}#${entry.integrity}`, join(origin, location))) opaque += 1;
  }
  return { packages, opaque, ms: Math.round(performance.now() - t) };
}

function compare(other: InstalledDependencies) {
  const { keys } = keysOf(other);
  const kept = [...keys].filter(([id, key]) => originKeys.keys.get(id) === key).map(([id]) => id);
  return {
    kept: kept.length,
    keptWhole: kept.filter((id) => originKeys.whole.has(id)).length,
    keptReachingChildProcess: kept.filter((id) => childProcess.has(id)).length,
    keptReachingOpaque: kept.filter((id) => spawns.has(id)).length,
    stale: other.note,
    sample: kept.slice(0, 5),
  };
}

const report = {
  testFiles: closures.length,
  projects: environments.map((e) => e.project),
  reachChildProcess: childProcess.size,
  reachOpaque: spawns.size,
  noPackagesReported: closures.filter((c) => c.packages === undefined).length,
  walkMs,
  lockfileReadMs: readMs,
  keyingMs: { firstWithScans: Math.round(originKeys.ms), coldGraphWarmScans: Math.round(cold.ms) },
  firstScans,
  wholeFingerprint: originKeys.whole.size,
  wholeByProject: Object.fromEntries(
    environments.map((e) => [
      e.project,
      {
        files: closures.filter((c) => c.testFile.project === e.project).length,
        whole: [...originKeys.whole].filter((id) => id.startsWith(`${e.project}:`)).length,
        environmentWhole: originKeys.keys.get([...originKeys.keys.keys()].find((id) => id.startsWith(`${e.project}:`)) ?? "")?.endsWith("\0") ?? null,
      },
    ]),
  ),
  reachUnnamedLoad: closures.filter((c) => c.packages?.builtins.includes("module")).length,
  scanAll: scanAll(),
  mainLiteral: compare(mainInstall),
  mainAsIs: compare(await asIs(main)),
  originAgain: compare(await installedDependencies(origin, origin)),
};
console.log(JSON.stringify(report, null, 2));
if (out !== undefined) writeFileSync(out, JSON.stringify({ report, closures, environments }, null, 1));
