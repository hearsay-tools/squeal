// Throwaway, row 005-110. R2 of 011-385: what one cheap read of the listed counts costs on a COPY
// (read only): (a) the listed test files, one count; (b) the key rows; (c) known states and key rows
// with `countNotCurrent` (the "X of Y test files are current" counts); each N times, fresh connection.
// Env: SRC, COMMON (copy), ROOT (real worktree, for its id), N.
import { loadavg } from "node:os";
import { pathToFileURL } from "node:url";
const { SRC, COMMON, ROOT } = process.env as Record<string, string>;
if (!COMMON.includes("/t/cd01ba62/")) throw new Error("scratch only");
const N = Number(process.env.N ?? 10);
const imp = (p: string) => import(pathToFileURL(`${SRC}/src/${p}`).href);
const { openStore } = await imp("core/store/open.ts");
const { worktreeIdFor } = await imp("core/fs/git-layout.ts");
const { countNotCurrent } = await imp("core/state/file-class.ts");
const { connectionOf } = await imp("core/store/store.ts");
const id = worktreeIdFor(ROOT);
const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const out: Record<string, number[]> = { open: [], count: [], keys: [], statesKeysCounts: [] };
let listed = 0, current = 0;
for (let i = 0; i < N; i++) {
  let t = performance.now();
  const store = openStore(COMMON, { create: false, busyTimeoutMs: 1000 });
  out.open.push(performance.now() - t);
  t = performance.now();
  listed = Number((connectionOf(store).get("SELECT count(*) AS n FROM test_file_keys WHERE worktree_id = ?", id) as any).n);
  out.count.push(performance.now() - t);
  t = performance.now(); const keys = store.testFileKeys.list(id); out.keys.push(performance.now() - t);
  t = performance.now();
  const states = store.knownStates.list(id);
  current = countNotCurrent(states, store.testFileKeys.list(id)).testFileCounts.current;
  out.statesKeysCounts.push(performance.now() - t);
  store.close(); void keys;
}
console.log(JSON.stringify({ repo: COMMON.split("/").pop(), listed, current, load1: loadavg()[0], ...Object.fromEntries(Object.entries(out).map(([k, v]) => [k + "MedMs", +med(v).toFixed(1)])) }));
