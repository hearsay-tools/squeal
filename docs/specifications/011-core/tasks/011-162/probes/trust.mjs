// 011-162 probe, not product code (brief question 3): section 3's rule over installs, read-only.
//   node trust.mjs <install-root>...
import { performance } from "node:perf_hooks";
import { readInstall, staleLock } from "./pnpm-graph.mjs";

for (const root of process.argv.slice(2)) {
  const t0 = performance.now();
  const install = readInstall(root);
  const t1 = performance.now();
  const stale = install.reason ?? staleLock(root, install);
  const t2 = performance.now();
  console.log(
    JSON.stringify({
      root,
      stale,
      orphans: install.orphans ?? null,
      readMs: Math.round(t1 - t0),
      ruleMs: Math.round(t2 - t1),
    }),
  );
}
