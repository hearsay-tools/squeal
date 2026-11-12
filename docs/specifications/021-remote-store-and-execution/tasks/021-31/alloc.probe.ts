import { Session } from "node:inspector/promises";
import { getHeapStatistics } from "node:v8";
import { expect, it } from "vitest";
import { StepCache } from "../../../../../src/core/code/crap/cache.js";
import { WT } from "../../../../../test/state/helpers.js";
import { coverageRig, sourceOf } from "../../../../../test/code/crap/rig.js";

/*
 * Row 021-31: what one coverage step allocates after one stored record, on
 * a fixture of SOURCES sources and TESTS test files, each loading CLOSURE
 * of them. Throwaway: run with `vitest.probe.config.ts` (see notes.md).
 * V8's sampling heap profiler, collected objects included, sums the bytes
 * sampled in the steps only; storing the records is outside the window.
 */

const SOURCES = Number(process.env.SOURCES ?? 600);
const TESTS = Number(process.env.TESTS ?? 400);
const CLOSURE = Number(process.env.CLOSURE ?? 150);
/** Sources every test file loads, as a repository's shared core: `src/s0.ts` to `src/s<HOT-1>.ts`. */
const HOT = Number(process.env.HOT ?? 0);
const ROUNDS = Number(process.env.ROUNDS ?? 20);

/** A fixed pseudo-random sequence, so both runs have one fixture. */
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

interface Node {
  readonly selfSize: number;
  readonly callFrame: { readonly functionName: string; readonly url: string; readonly lineNumber: number };
  readonly children: readonly Node[];
}

it("measures one step's allocation after one stored record", { timeout: 600_000 }, async () => {
  const rig = coverageRig();
  const files: Record<string, string> = {};
  for (let s = 0; s < SOURCES; s++) files[`src/s${s}.ts`] = `f${s} 3 b${s}\ng${s} 1 c${s}\n`;
  await rig.edit(files);
  const blobs = new Map(rig.store.files.list(WT).map((f) => [f.path, f.blob]));
  const next = random(42);
  const closures: string[][] = [];
  for (let t = 0; t < TESTS; t++) {
    const picked = new Set<string>();
    for (let s = 0; s < HOT; s++) picked.add(`src/s${s}.ts`);
    while (picked.size < CLOSURE) picked.add(`src/s${Math.floor(next() * SOURCES)}.ts`);
    closures.push([...picked].sort());
  }
  const store = (t: number, round: number) => {
    const closure = closures[t] ?? [];
    const own = closure.slice(0, 3);
    rig.loader(`test/t${t}.test.ts`, {
      closure,
      key: `key-${t}-${round}`,
      record: own.map((p) => sourceOf(p, blobs.get(p) ?? "", 2, [1])),
    });
  };
  for (let t = 0; t < TESTS; t++) store(t, 0);
  let cache = new StepCache();
  const drain = () => {
    let steps = 0;
    for (;;) {
      steps++;
      const report = rig.step({ cache });
      if (report === null || report.more !== true) break;
    }
    cache.settle();
    return steps;
  };
  drain();
  rig.clock += 1_000;
  drain();

  const session = new Session();
  session.connect();
  let sampled = 0;
  const byFrame = new Map<string, number>();
  /** By the deepest frame in `src/`, as `apsum.mjs` attributes a bundle's. */
  const byOwner = new Map<string, number>();
  const walk = (node: Node, owner: string) => {
    const url = node.callFrame.url.replace(/^.*\/(src|test|node_modules)\//, "$1/");
    const at = `${node.callFrame.functionName || "(anonymous)"} ${url}:${node.callFrame.lineNumber + 1}`;
    const own = url.startsWith("src/") ? at : owner;
    if (node.selfSize > 0) {
      byFrame.set(at, (byFrame.get(at) ?? 0) + node.selfSize);
      byOwner.set(own, (byOwner.get(own) ?? 0) + node.selfSize);
      sampled += node.selfSize;
    }
    for (const child of node.children) walk(child, own);
  };
  let steps = 0;
  for (let round = 1; round <= ROUNDS; round++) {
    store((round * 37) % TESTS, round);
    rig.clock += 1_000;
    // What the writer's `onStored` does through the code pass's `soon`.
    cache.invalidate();
    await session.post("HeapProfiler.startSampling", {
      samplingInterval: 512,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    steps += drain();
    const { profile } = await session.post("HeapProfiler.stopSampling");
    walk(profile.head as unknown as Node, "(outside src)");
  }
  // What the cache keeps between chains: the heap in use after a GC, with it and without it.
  const used = async () => {
    await session.post("HeapProfiler.collectGarbage");
    return getHeapStatistics().used_heap_size;
  };
  const kept = await used();
  cache = new StepCache();
  const retained = kept - (await used());
  session.disconnect();
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  const mib = (n: number) => (n / 1024 / 1024).toFixed(2);
  console.log(
    `fixture: ${SOURCES} sources, ${TESTS} test files, ${CLOSURE} closure paths each, ${HOT} of them shared by all; ${ROUNDS} rounds, ${steps} steps`,
  );
  console.log(`kept by the step cache between chains: ${mib(retained)} MiB`);
  console.log(`sampled allocation: ${mib(sampled)} MiB in all, ${mib(sampled / ROUNDS)} MiB per round`);
  console.log("by frame:");
  for (const [at, bytes] of top(byFrame)) console.log(`${mib(bytes / ROUNDS).padStart(7)} MiB/round  ${at}`);
  console.log("by the deepest src/ frame:");
  for (const [at, bytes] of top(byOwner)) console.log(`${mib(bytes / ROUNDS).padStart(7)} MiB/round  ${at}`);
  expect(rig.states("crap").length).toBeGreaterThan(0);
});
