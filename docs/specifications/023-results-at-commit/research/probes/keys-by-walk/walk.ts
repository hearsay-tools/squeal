// Throwaway probe (research 023-15, keys-by-walk). Not product code; do not import it.
//
// Keys test files of one checkout as the gate's keyer does (`openDaemonKeying`, row 020-51):
// fresh runner closures over a scratch store, so no stored closure list is reused. Times each
// phase and looks each key up in a store copy. Run with this worktree's tsx:
//
//   ROOT=<checkout> STORE_DIR=<dir holding squeal/store.sqlite (a copy)> OUT=<json>
//   [FILES=<path>,<path>...]  (named test files only; default every listed file)
//   [DUMP=1]                  (also write each file's key inputs)
//   timeout 600 pnpm exec tsx walk.ts
//
// Writes only OUT and a scratch folder under $TMPDIR, which it removes.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPolicy } from "../../../../../../src/core/daemon/policy.js";
import { squealVersion } from "../../../../../../src/core/daemon/version.js";
import { worktreeIdFor } from "../../../../../../src/core/fs/git-layout.js";
import { OBSERVED_META_KEYS } from "../../../../../../src/core/keys/observed-rows.js";
import { testFileId } from "../../../../../../src/core/keys/reverse-index.js";
import { openDaemonKeys } from "../../../../../../src/core/scheduler/daemon-keys.js";
import { isStoreOpenFailure, openStore } from "../../../../../../src/core/store/open.js";
import type { AbsolutePath } from "../../../../../../src/core/types/common.js";
import type { TestFileRef } from "../../../../../../src/core/types/keys.js";
import type { RunnerAdapter, RunnerClosure } from "../../../../../../src/core/types/runner.js";
import { daemonAdapters } from "../../../../../../src/cli/code-gate-stored.js";

const root = process.env.ROOT as AbsolutePath;
const storeDir = process.env.STORE_DIR as AbsolutePath;
const out = process.env.OUT as string;
const named = process.env.FILES?.split(",").filter((p) => p !== "") ?? null;

const marks: Record<string, number> = {};
let last = performance.now();
const mark = (name: string) => {
  const now = performance.now();
  marks[name] = Math.round(now - last);
  last = now;
};
let peakRss = 0;
const sampler = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 100);
const load = () => readFileSync("/proc/loadavg", "utf8").split(" ")[0];

const temp = mkdtempSync(join(tmpdir(), "kbw-walk-")) as AbsolutePath;
const main = openStore(storeDir, { create: false });
if (isStoreOpenFailure(main)) throw new Error(`store: ${JSON.stringify(main)}`);
const scratch = openStore(temp);
if (isStoreOpenFailure(scratch)) throw new Error("scratch store");
const loadBefore = load();
const t0 = performance.now();
last = t0;

const policy = readPolicy(root);
mark("policy");
const adapters: RunnerAdapter[] = await daemonAdapters(root, policy, temp);
mark("adaptersOpen");
const environments = (await Promise.all(adapters.map((a) => a.environment()))).flat();
mark("environments");
for (const project of new Set(environments.map((e) => e.project))) {
  for (const key of OBSERVED_META_KEYS) {
    const value = main.meta.get(key(project));
    if (value !== null) scratch.meta.set(key(project), value);
  }
}
const { keys } = await openDaemonKeys({
  root,
  worktreeId: worktreeIdFor(root),
  store: scratch,
  policy,
  squealVersion: squealVersion(),
  env: process.env,
});
mark("bootstrapHash");
await keys.setEnvironments(environments);
mark("setEnvironments");
const listed = new Map<string, { adapter: RunnerAdapter; ref: TestFileRef }>();
for (const adapter of adapters) {
  for (const ref of await adapter.testFiles()) listed.set(testFileId(ref), { adapter, ref });
}
mark("list");
const chosen = [...listed.values()].filter(({ ref }) => named === null || named.includes(ref.path));
const closures = new Map<string, RunnerClosure>();
let failed = 0;
for (const { adapter, ref } of chosen) {
  const closure = await adapter.closure(ref).catch(() => null);
  if (closure === null) {
    failed++;
    continue;
  }
  closures.set(testFileId(ref), closure);
}
mark("walk");
for (const closure of closures.values()) keys.setClosure(closure);
await keys.trackUntracked();
const keyed = new Map<string, string>();
for (const { ref } of chosen) {
  const key = closures.has(testFileId(ref)) ? keys.index.key(ref) : null;
  if (key !== null) keyed.set(`${ref.project}\t${ref.path}`, key);
}
mark("key");
let hits = 0;
for (const key of keyed.values()) if (main.results.byKey(key as never, 0).length > 0) hits++;
mark("lookup");
const totalMs = Math.round(performance.now() - t0);
clearInterval(sampler);
const result = {
  root,
  head: (await import("node:child_process")).execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  listed: listed.size,
  chosen: chosen.length,
  keyed: keyed.size,
  closureFailed: failed,
  hits,
  closurePaths: [...closures.values()].reduce((n, c) => n + c.paths.length, 0),
  marksMs: marks,
  totalMs,
  peakRssMb: Math.round(peakRss / 2 ** 20),
  loadBefore,
  loadAfter: load(),
  keys: Object.fromEntries(keyed),
  // With DUMP=1: every path each key reads here (closure with listings, observed and declared
  // inputs, the project's environment files, its lockfile), as the stability check lists them.
  ...(process.env.DUMP === "1"
    ? {
        inputs: Object.fromEntries(
          chosen.map(({ ref }) => [`${ref.project}\t${ref.path}`, keys.stabilityPaths(ref).sort()]),
        ),
      }
    : {}),
};
writeFileSync(out, JSON.stringify(result, null, 1));
const { keys: _k, inputs: _i, ...summary } = result as typeof result & { inputs?: unknown };
console.log(JSON.stringify(summary));
await Promise.allSettled(adapters.map((a) => a.close()));
scratch.close();
main.close();
rmSync(temp, { recursive: true, force: true });
process.exit(0);
