// Review 0.1.282 B2, not product code: the cost of the links the pnpm trust rule now checks. Run
// from the Squeal worktree root:
//   npx tsx docs/specifications/011-core/tasks/011-165/time-trust.mts [install root]
// Without a root it writes a synthetic install the size of cezar's (640 snapshots, 1,600 edges,
// 540 private hoists) under a temporary directory and removes it. Prints the median of 30 runs
// of the whole trust check and of the added `lstat` calls alone, with the one-minute load.
import { lstatSync, readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { childOf, PnpmGraph } from "../../../../../src/core/keys/pnpm-graph.js";
import { stalePnpmLockfile } from "../../../../../src/core/keys/pnpm-install.js";
import { PNPM_LOCKFILE, readPnpmLockfile } from "../../../../../src/core/keys/pnpm-lockfile.js";
import { tempDir } from "../../../../../test/hash/git-repo.js";
import { type PnpmFixture, writePnpmInstall } from "../../../../../test/keys/install.js";

const RUNS = 30;

function synthetic(root: string): void {
  const id = (i: number) => `pkg${i}@1.0.0`;
  const snapshots: Record<string, { dependencies: Record<string, string> }> = {};
  for (let i = 0; i < 640; i++) {
    const edges = i % 2 === 0 ? [1, 2, 3] : [1, 2];
    snapshots[id(i)] = {
      dependencies: Object.fromEntries(edges.map((d) => [`pkg${(i + d) % 640}`, "1.0.0"])),
    };
  }
  const declared = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`pkg${i}`, "1.0.0"]));
  const hoisted = Object.fromEntries(
    Array.from({ length: 540 }, (_, i) => [id(i + 40), { [`pkg${i + 40}`]: "private" }]),
  );
  const fixture: PnpmFixture = {
    importers: { ".": declared },
    snapshots,
    modules: { hoistedDependencies: hoisted },
  };
  writePnpmInstall(root, fixture);
}

function graphOf(root: string): PnpmGraph {
  const lockfile = readPnpmLockfile(readFileSync(join(root, PNPM_LOCKFILE), "utf8"));
  if (lockfile === null) throw new Error(`${root}: lock.yaml does not read`);
  const modules = JSON.parse(readFileSync(join(root, "node_modules/.modules.yaml"), "utf8"));
  return new PnpmGraph(root, "", lockfile, modules);
}

/** The paths review 0.1.282 B2 added: each edge beside a package folder and each hoisted name. */
function addedPaths(graph: PnpmGraph): string[] {
  const paths: string[] = [];
  for (const [id, folder] of graph.folders) {
    if (graph.skipped.has(id)) continue;
    for (const [name, ref] of graph.lockfile.snapshots.get(id) ?? []) {
      if (!graph.skipped.has(childOf(name, ref)))
        paths.push(`node_modules/.pnpm/${folder}/node_modules/${name}`);
    }
  }
  for (const [at, hoisted] of [
    ["node_modules", graph.publicHoisted],
    ["node_modules/.pnpm/node_modules", graph.privateHoisted],
  ] as const) {
    for (const [alias, id] of hoisted) if (!graph.skipped.has(id)) paths.push(`${at}/${alias}`);
  }
  return paths;
}

function median(run: () => void): number {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    run();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return Math.round((times[RUNS >> 1] ?? 0) * 100) / 100;
}

function measure(root: string, label: string) {
  const graph = graphOf(root);
  const added = addedPaths(graph);
  const load = loadavg()[0]?.toFixed(1);
  const trust = median(() => stalePnpmLockfile(root, graph));
  const lstats = median(() => {
    for (const path of added) lstatSync(join(root, path), { throwIfNoEntry: false });
  });
  return {
    label,
    snapshots: graph.folders.size,
    addedLstats: added.length,
    stale: stalePnpmLockfile(root, graph),
    medianMs: { trustCheck: trust, addedLstats: lstats },
    load: { before: load, after: loadavg()[0]?.toFixed(1) },
  };
}

const root = process.argv[2];
if (root !== undefined) console.log(JSON.stringify(measure(root, root), null, 2));
else {
  const dir = tempDir();
  try {
    synthetic(dir.path);
    console.log(JSON.stringify(measure(dir.path, "synthetic"), null, 2));
  } finally {
    dir.cleanup();
  }
}
