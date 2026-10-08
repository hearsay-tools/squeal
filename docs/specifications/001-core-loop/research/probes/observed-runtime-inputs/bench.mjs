// THROWAWAY: per-call overhead of the recorder's fs wrappers. Run with and without --require observe.cjs.
import { readFileSync, statSync, existsSync } from 'node:fs';
const f = new URL('./bench.mjs', import.meta.url).pathname;
const N = 200000;
for (const [name, fn] of [['readFileSync', () => readFileSync(f)], ['statSync', () => statSync(f)], ['existsSync(missing)', () => existsSync(f + '.x')]]) {
  for (let i = 0; i < 2000; i++) fn();
  const t = performance.now(); for (let i = 0; i < N; i++) fn();
  console.log(`${name}: ${((performance.now() - t) * 1000 / N).toFixed(2)} us/call`);
}
