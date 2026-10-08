// Task 001-134 evidence driver, not product code: the cost of review wave
// 12d B1's fix on a `cezar` clone. One daemon start through the real
// scheduler, store and Vitest adapter, policy defaults with observed inputs
// on and no `inputs`: which files ran more than once, and the paths their
// first run read that the stat cache did not hold before it (not listed by
// git, not ignored), as `ObservedGrowth.firstSeen` finds them.
// Usage, with the orchestrator's variables removed and cwd in the clone, since
// cezar's mock agents write to CEZ_HANDOFF_FILE, CEZ_TODOS_FILE and the cwd:
//   (cd <clone> && env $(env | grep -oE '^CEZ_[A-Z_]+' | sed 's/^/-u /') tsx first-seen.ts <clone> <out.json>)
import { execFileSync } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { readHead } from "../../../../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../../../../src/core/fs/index.js";
import { createScheduler } from "../../../../../src/core/scheduler/index.js";
import { createStateSink } from "../../../../../src/core/state/index.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../../../../src/core/store/index.js";
import { DEFAULT_POLICY, type RunReport, type TestFileRef } from "../../../../../src/core/types/index.js";
import { createVitestAdapter } from "../../../../../src/runners/vitest/index.js";

const [clone, out] = process.argv.slice(2);
if (!clone || !out) throw new Error("usage: <clone> <out.json>");
const root = realpathSync(clone);
const store = openStore(join(root, ".git"), { busyTimeoutMs: 10_000 });
if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
const t0 = performance.now();
const log = (text: string) => console.log(`${((performance.now() - t0) / 1000).toFixed(1)}s ${text}`);
const git = (args: string[]) => execFileSync("git", args, { cwd: root, maxBuffer: 1 << 28 }).toString();
const listed = new Set(git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0"));

const runs: { files: readonly TestFileRef[]; report: RunReport }[] = [];
const adapter = await createVitestAdapter({ root, observe: () => true });
const runner = {
  ...adapter,
  name: adapter.name,
  adapterVersion: adapter.adapterVersion,
  invalidate: adapter.invalidate.bind(adapter),
  affected: adapter.affected.bind(adapter),
  closure: adapter.closure.bind(adapter),
  enumerate: adapter.enumerate.bind(adapter),
  testFiles: adapter.testFiles.bind(adapter),
  environment: adapter.environment.bind(adapter),
  close: adapter.close.bind(adapter),
  run: async (files: readonly TestFileRef[], options: Parameters<typeof adapter.run>[1]) => {
    const report = await adapter.run(files, options);
    runs.push({ files, report });
    if (runs.length % 10 === 0) log(`${runs.length} tiers`);
    return report;
  },
};
const worktreeId = worktreeIdFor(root);
const scheduler = createScheduler({
  root,
  worktreeId,
  store,
  runner,
  sink: createStateSink(store),
  // No tier timeout, as 001-132's `ab.ts`: a timed-out tier's files end unknown and observe nothing.
  policy: {
    ...DEFAULT_POLICY,
    observe: { runtimeInputs: true },
    runner: { ...DEFAULT_POLICY.runner, timeoutMs: null },
  },
  squealVersion: "0.1.35+001-134",
  runsDir: storePaths(join(root, ".git")).runsDir,
  head: () => readHead(root),
  onError: (error) => log(`scheduler error: ${error.message}`),
});
const loadBefore = loadavg()[0];
await scheduler.start();
await scheduler.idle();
log(`idle after ${runs.length} tiers`);

const id = (f: TestFileRef) => `${f.project}:${f.path}`;
const byFile = new Map<string, { runs: number; durations: number[]; firstObserved: string[] | null }>();
for (const { files, report } of runs) {
  const durations = new Map((report.fileDurations ?? []).map((d) => [id(d.testFile), d.durationMs]));
  const observed = new Map((report.observed ?? []).map((o) => [id(o.testFile), o.paths]));
  for (const file of files) {
    const entry = byFile.get(id(file)) ?? { runs: 0, durations: [], firstObserved: null };
    entry.runs += 1;
    entry.durations.push(durations.get(id(file)) ?? 0);
    if (entry.firstObserved === null) entry.firstObserved = [...(observed.get(id(file)) ?? [])];
    byFile.set(id(file), entry);
  }
}
const unlisted = new Set<string>();
for (const entry of byFile.values()) for (const p of entry.firstObserved ?? []) if (!listed.has(p)) unlisted.add(p);
const ignored = new Set(
  unlisted.size === 0
    ? []
    : execFileSync("git", ["check-ignore", "-z", "--stdin"], { cwd: root, input: [...unlisted].join("\0") + "\0" })
        .toString()
        .split("\0")
        .filter(Boolean),
);
const firstSeenOf = (paths: string[] | null) => (paths ?? []).filter((p) => !listed.has(p) && !ignored.has(p));
const files = [...byFile].map(([file, e]) => ({ file, ...e, firstSeen: firstSeenOf(e.firstObserved) }));
const rerun = files.filter((f) => f.runs > 1);
const withFirstSeen = files.filter((f) => f.firstSeen.length > 0);
const summary = {
  files: files.length,
  tiers: runs.length,
  wallMs: Math.round(performance.now() - t0),
  loadBefore,
  loadAfter: loadavg()[0],
  ranMoreThanOnce: rerun.length,
  runsHistogram: Object.fromEntries(
    [...new Set(files.map((f) => f.runs))].sort().map((n) => [n, files.filter((f) => f.runs === n).length]),
  ),
  withFirstSeen: withFirstSeen.length,
  rerunWithFirstSeen: rerun.filter((f) => f.firstSeen.length > 0).length,
  rerunWithout: rerun.filter((f) => f.firstSeen.length === 0).map((f) => f.file),
  firstRunMsOfRerun: rerun.reduce((a, f) => a + (f.durations[0] ?? 0), 0),
  allFirstRunsMs: files.reduce((a, f) => a + (f.durations[0] ?? 0), 0),
  distinctFirstSeen: new Set(withFirstSeen.flatMap((f) => f.firstSeen)).size,
  unknownFiles: store.knownStates.list(worktreeId).filter((s) => s.outcome === "unknown").length,
};
writeFileSync(out, JSON.stringify({ summary, rerun, withFirstSeen }, null, 1));
console.log(JSON.stringify(summary, null, 1));
await scheduler.close();
await adapter.close();
store.close();
