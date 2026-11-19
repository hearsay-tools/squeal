// Row 021-33 probe: one daemon-style prune (main store, then code store) over a copy of a clone's stores.
// Usage: tsx probe.mts <src root> <commonDir of the copy> <label>
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [srcRoot, commonDir, label] = process.argv.slice(2);
if (!commonDir.includes("/probe/")) throw new Error("refusing: not a probe copy");
const imp = (p: string) => import(pathToFileURL(join(srcRoot, p)).href);
const { openStore, isStoreOpenFailure } = await imp("core/store/open.ts");
const { observeWrites } = await imp("core/store/connection.ts");
const { connectionOf } = await imp("core/store/store.ts");
const { storePaths } = await imp("core/store/paths.ts");
const { noneRemoved, pruneSlices } = await imp("core/store/prune.ts");
const { noCodeRemoved } = await imp("core/code/store/prune.ts");
const { pruneCodeSlicesAfter } = await imp("core/code/store/prune-main.ts");
const { SlicedPrune } = await imp("core/daemon/sliced-prune.ts");
const { DEFAULT_POLICY } = await imp("core/types/policy.ts");
const policy = { ...DEFAULT_POLICY, complexity: { ...DEFAULT_POLICY.complexity, enabled: true } };

const store = openStore(commonDir, { busyTimeoutMs: 10_000 });
if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
let phase = "main";
const holds: { phase: string; ms: number; rows: number; what?: string }[] = [];
const slices: { phase: string; ms: number }[] = [];
observeWrites((db: any) => {
  const total = () => Number(db.prepare("SELECT total_changes() AS n").get().n);
  const before = total();
  const t = performance.now();
  return () => holds.push({ phase, ms: performance.now() - t, rows: total() - before });
});
const timed = (it: Iterable<() => void>) =>
  (function* () {
    for (const slice of it)
      yield () => {
        const t = performance.now();
        const mark = holds.length;
        const before = JSON.stringify({ ...mainCounts, ...codeCounts });
        try { slice(); } finally {
          slices.push({ phase, ms: performance.now() - t });
          const after: Record<string, number> = { ...mainCounts, ...codeCounts };
          const was = JSON.parse(before);
          const what = Object.keys(after).filter((k) => after[k] !== was[k]).join("+") || "uncounted";
          for (const h of holds.slice(mark)) h.what = what;
        }
      };
  })();
const logged: string[] = [];
const mainCounts = noneRemoved();
const codeCounts = noCodeRemoved();
const driver = new SlicedPrune({ log: (l: string) => logged.push(l), pause: async () => {} });
const now = Number(process.env.PROBE_NOW ?? Date.now());
const started = performance.now();
await driver.run(() =>
  timed(pruneSlices(connectionOf(store), store.worktrees, storePaths(commonDir),
    { now, retentionDays: policy.store.retentionDays, maxSizeMb: policy.store.maxSizeMb }, mainCounts)));
const mainMs = performance.now() - started;
phase = "code";
await driver.run(() => timed(pruneCodeSlicesAfter(store, commonDir, policy, now, codeCounts)));
const totalMs = performance.now() - started;
observeWrites(null);
store.close();

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => (s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor(p * s.length))]);
  return { n: s.length, p50: +q(0.5).toFixed(1), p90: +q(0.9).toFixed(1), max: +(s.at(-1) ?? 0).toFixed(1), sum: +s.reduce((a, b) => a + b, 0).toFixed(0) };
};
const out: Record<string, unknown> = { label, logged, mainCounts, codeCounts, mainMs: Math.round(mainMs), totalMs: Math.round(totalMs) };
for (const p of ["main", "code"]) {
  const h = holds.filter((x) => x.phase === p);
  out[`${p}Holds`] = stats(h.map((x) => x.ms));
  out[`${p}ZeroRowHolds`] = stats(h.filter((x) => x.rows === 0).map((x) => x.ms));
  out[`${p}HoldsOver250`] = h.filter((x) => x.ms >= 250).map((x) => `${x.ms.toFixed(0)}ms/${x.rows}rows/${x.what}`);
  out[`${p}Top5`] = [...h].sort((a, b) => b.ms - a.ms).slice(0, 5).map((x) => `${x.ms.toFixed(0)}ms/${x.rows}rows/${x.what}`);
  out[`${p}Slices`] = stats(slices.filter((x) => x.phase === p).map((x) => x.ms));
}
console.log(JSON.stringify(out, null, 1));
