// Throwaway probe (row 025-14). Start cost of reading and compiling the hook
// bundles of several releases: `node <parse-only copy>` (phases.mjs `parse`:
// the bundle's builtins imported, its body behind an `if` that never holds)
// against an empty module, runs interleaved, with and without Node's compile
// cache (a warm cache per copy). Prints p50/p95 and p50 over empty per hook.
// Usage: node parse-size.mjs <runs> <hook,hook> <label=parseDir>...   (empty= first)
import { spawnSync } from "node:child_process";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [runs, hooks, ...dirs] = process.argv.slice(2);
const sets = dirs.map((d) => d.split("="));
const cache = mkdtempSync(join(tmpdir(), "parse-size-cc-"));
const q = (xs, p) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * p) - 1];
for (const withCache of [false, true]) {
  console.log(`\n${withCache ? "with" : "without"} compile cache, node ${process.version}`);
  for (const hook of hooks.split(",")) {
    const ms = Object.fromEntries(sets.map(([l]) => [l, []]));
    for (let r = 0; r < Number(runs) + 1; r++) {
      for (const [label, dir] of sets) {
        const env = { PATH: process.env.PATH, ...(withCache ? { NODE_COMPILE_CACHE: join(cache, label) } : {}) };
        const t = performance.now();
        spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", join(dir, `${hook}.mjs`)], { env });
        if (r > 0) ms[label].push(performance.now() - t); // run 0 warms the cache
      }
    }
    const base = q(ms[sets[0][0]], 0.5);
    for (const [label, dir] of sets) {
      const kb = Math.round(statSync(join(dir, `${hook}.mjs`)).size / 1024);
      console.log(`  ${hook.padEnd(20)} ${label.padEnd(14)} ${String(kb).padStart(4)} KB  ${q(ms[label], 0.5).toFixed(1)}/${q(ms[label], 0.95).toFixed(1)}  +${(q(ms[label], 0.5) - base).toFixed(1)}`);
    }
  }
}
