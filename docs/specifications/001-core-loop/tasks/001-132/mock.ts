// Task 001-132 evidence driver, not product code: done-when (2) on a `cezar`
// clone through the real scheduler, store and Vitest adapter, with no `inputs`.
// Usage: npx tsx mock.ts <clone> [observe: on|off]
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { readHead } from "../../../../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../../../../src/core/fs/index.js";
import { createFsHasher } from "../../../../../src/core/hash/index.js";
import { statCandidates } from "../../../../../src/core/revision/index.js";
import { createScheduler } from "../../../../../src/core/scheduler/index.js";
import { createStateSink } from "../../../../../src/core/state/index.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../../../../src/core/store/index.js";
import { DEFAULT_POLICY, type Policy, type RunReport, type TestFileRef } from "../../../../../src/core/types/index.js";
import { createVitestAdapter } from "../../../../../src/runners/vitest/index.js";

const [clone, observe = "on"] = process.argv.slice(2);
if (!clone) throw new Error("usage: <clone> [on|off]");
const main = realpathSync(clone);
const commonDir = join(main, ".git");
const PARITY: TestFileRef = { project: "server", path: "packages/cezar/src/core/runner-shutdown-parity.test.ts" };
const MOCK = "packages/cezar/scripts/mock-cursor-print.mjs";
const policy: Policy = {
  ...DEFAULT_POLICY,
  baseline: { onStart: "lookup-only" },
  observe: { runtimeInputs: observe === "on" },
};
const store = openStore(commonDir, { busyTimeoutMs: 10_000 });
if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
const t0 = performance.now();
const log = (text: string) => console.log(`${((performance.now() - t0) / 1000).toFixed(1)}s ${text}`);

async function open(root: string) {
  const runs: { files: readonly TestFileRef[]; report: RunReport; runId: string }[] = [];
  const adapter = await createVitestAdapter({ root, observe: () => policy.observe.runtimeInputs });
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
      runs.push({ files, report, runId: options.runId });
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
    policy,
    squealVersion: "0.1.34+001-132",
    runsDir: storePaths(commonDir).runsDir,
    head: () => readHead(root),
    onError: (error) => log(`scheduler error: ${error.message}`),
  });
  const hasher = createFsHasher(root, "sha1");
  const key = () =>
    store.testFileKeys.list(worktreeId).find((r) => r.testFile.path === PARITY.path && r.testFile.project === PARITY.project)?.key ?? null;
  const state = () =>
    store.knownStates
      .list(worktreeId)
      .filter((s) => s.check.testPath === PARITY.path)
      .map((s) => `${s.outcome}/${s.validity}/${s.origin?.runId?.slice(0, 8) ?? "-"}`);
  return {
    root,
    runs,
    scheduler,
    key,
    state,
    async edit(path: string, line: string) {
      appendFileSync(join(root, path), line);
      await scheduler.handleBatch({ trigger: "watch", paths: await statCandidates([path], hasher) });
    },
    async close() {
      await scheduler.close();
      await adapter.close();
    },
  };
}

const ran = (runs: { files: readonly TestFileRef[] }[], from = 0) =>
  runs.slice(from).flatMap((r) => r.files.map((f) => f.path.replace(/^packages\/cezar\//, "")));

const a = await open(main);
await a.scheduler.start();
await a.scheduler.idle();
log(`main started (lookup-only): ${a.runs.length} runs, parity key ${a.key()?.slice(0, 12)}`);

// The first run of the parity test: an edit of the test file itself queues it.
await a.edit(PARITY.path, "\n");
await a.scheduler.idle();
const closure = store.testFiles.get(PARITY)?.closure.paths ?? [];
log(`first run: ran ${JSON.stringify(ran(a.runs))}; closure holds the mock: ${closure.includes(MOCK)}`);
log(`  observed scripts: ${closure.filter((p) => p.includes("/scripts/")).join(", ")}`);
const firstRun = a.runs.at(-1)?.runId.slice(0, 8);
log(`  parity key ${a.key()?.slice(0, 12)}, states ${JSON.stringify([...new Set(a.state())])}`);

// Done-when (2): the mock edit re-keys it and runs it at the next tier.
const before = a.key();
const from = a.runs.length;
await a.edit(MOCK, "// 001-132 edit\n");
log(`mock edited: parity key ${before?.slice(0, 12)} -> ${a.key()?.slice(0, 12)}`);
await a.scheduler.idle();
log(`after the mock edit: ran ${JSON.stringify(ran(a.runs, from))} in ${a.runs.length - from} tier(s)`);
const secondRun = a.runs.at(-1)?.runId.slice(0, 8);
log(`  states ${JSON.stringify([...new Set(a.state())])} (first run ${firstRun}, mock-edit run ${secondRun})`);

// A second worktree with the old mock: it must not inherit the mock-edit run's result.
const wt = join(main, "..", `wt-old-mock-${observe}`);
execFileSync("git", ["worktree", "add", "-q", "--detach", wt, "HEAD"], { cwd: main });
execFileSync("cp", ["-al", join(main, "node_modules"), join(wt, "node_modules")]);
for (const pkg of ["cezar", "web", "contract", "api-client"]) {
  const from = join(main, "packages", pkg, "node_modules");
  if (existsSync(from)) execFileSync("cp", ["-al", from, join(wt, "packages", pkg, "node_modules")]);
}
// The parity test file carries main's first-run edit, so the keys can differ only by the mock.
appendFileSync(join(wt, PARITY.path), "\n");
const b = await open(realpathSync(wt));
await b.scheduler.start();
await b.scheduler.idle();
log(`old-mock worktree: parity key ${b.key()?.slice(0, 12)}, states ${JSON.stringify([...new Set(b.state())])}, ran ${JSON.stringify(ran(b.runs))}`);
log(`  mock in worktree equals main's: ${readFileSync(join(wt, MOCK), "utf8") === readFileSync(join(main, MOCK), "utf8")}`);
await b.close();
await a.close();
store.close();
