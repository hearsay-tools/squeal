// Task 011-22, done-when 9: cezar's 2026-10-19 catch-up replayed on the slice's own selection.
// The slice's scheduler, a scratch repository and store in a temporary directory and a fake runner
// whose 795 fast files report the times `research/probes/catch-up/results/cezar-733.json` recorded
// (740 Vitest, 55 node:test) select the tiers of a 12-source change at once; the timeline is then
// modelled as `replay-733.mjs` does: a Vitest tier takes its makespan over min(grant, 23) workers
// plus 0.5 s, one tier after another; node:test runs one file per slot, 4 slots.
// Run: npx tsx docs/specifications/011-core/tasks/011-22/replay-slice.ts <cezar-733.json>
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readHead } from "../../../../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../../../../src/core/fs/index.js";
import { createFsHasher } from "../../../../../src/core/hash/index.js";
import { statCandidates } from "../../../../../src/core/revision/index.js";
import { createScheduler } from "../../../../../src/core/scheduler/index.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../../../../src/core/store/index.js";
import {
  DEFAULT_POLICY,
  type RunnerAdapter,
  type RunOptions,
  type RunReport,
  type TestFileRef,
} from "../../../../../src/core/types/index.js";
import { RecordingSink } from "../../../../../test/scheduler/recording-sink.js";

interface Recorded {
  readonly lane: string;
  readonly files: readonly { readonly id: string; readonly s: number }[];
}
const runs = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8")) as Recorded[];
const files = new Map<string, { ref: TestFileRef; s: number; lane: string }>();
for (const run of runs) {
  if (run.lane === "slow") continue;
  for (const f of run.files) {
    const [project = "", path = ""] = f.id.split("\0");
    // As `replay-733.mjs`: a file run twice takes its later run's time and lane.
    files.set(f.id, { ref: { project, path }, s: f.s, lane: run.lane });
  }
}
const SOURCES = Array.from({ length: 12 }, (_, i) => `catch-up/s${String(i).padStart(2, "0")}.ts`);
const all = [...files.values()];
const importOf = new Map(all.map((f, i) => [f.ref.path, SOURCES[i % SOURCES.length] ?? ""]));
const byId = new Map(all.map((f) => [`${f.ref.project}\0${f.ref.path}`, f]));
const idOf = (ref: TestFileRef) => `${ref.project}\0${ref.path}`;

interface Run {
  readonly lane: string;
  readonly files: readonly TestFileRef[];
  readonly workers: number | undefined;
}
const selected: Run[] = [];
const runner: RunnerAdapter = {
  name: "replay",
  adapterVersion: "1",
  lane: (ref) => byId.get(idOf(ref))?.lane ?? "vitest",
  tierWidth: (ref, grant) => (byId.get(idOf(ref))?.lane === "node:test" ? 4 : Math.min(grant, 23)),
  besideBacklog: (ref) => byId.get(idOf(ref))?.lane === "node:test",
  backlogSlot: (ref) => (byId.get(idOf(ref))?.lane === "node:test" ? 1 : null),
  invalidate: async () => ({ recreatedProjects: [] }),
  affected: async () => ({ direct: [], transitive: [] }),
  closure: async (testFile) => ({ testFile, paths: [testFile.path, importOf.get(testFile.path) ?? ""] }),
  enumerate: async () => [],
  testFiles: async () => all.map((f) => f.ref),
  environment: async () =>
    [...new Set(all.map((f) => f.ref.project))].map((project) => ({
      project,
      runnerName: "replay",
      runnerVersion: "1",
      adapterVersion: "1",
      resolvedConfig: "{}",
      files: [],
    })),
  close: async () => {},
  async run(refs: readonly TestFileRef[], options: RunOptions): Promise<RunReport> {
    selected.push({ lane: options.lane ?? "", files: [...refs], workers: options.workers });
    return {
      end: "completed",
      durationMs: 1,
      completedFiles: refs,
      results: refs.map((ref) => ({
        check: { kind: "test" as const, project: ref.project, testPath: ref.path, fullName: "runs" },
        outcome: "pass" as const,
        durationMs: (byId.get(idOf(ref))?.s ?? 0) * 1000,
        location: null,
        errors: [],
      })),
      fileErrors: [],
      failure: null,
    };
  },
};

const scratch = mkdtempSync(join(tmpdir(), "squeal-011-22-replay-"));
try {
  const root = join(scratch, "repo");
  for (const path of [...all.map((f) => f.ref.path), ...SOURCES]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `// ${path}\n`);
  }
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.name=replay", "-c", "user.email=replay@example.invalid", "commit", "-qm", "replay");
  const commonDir = join(root, ".git");
  const store = openStore(commonDir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
  const worktreeId = worktreeIdFor(root);
  const scheduler = createScheduler({
    root,
    worktreeId,
    store,
    runner,
    sink: new RecordingSink(store, worktreeId),
    policy: { ...DEFAULT_POLICY, runner: { ...DEFAULT_POLICY.runner, tierSize: 4, backlogTierSize: 200 } },
    squealVersion: "0.0.0-replay",
    runsDir: storePaths(commonDir).runsDir,
    head: () => readHead(root),
    capacity: { dir: join(scratch, "pool", "squeal-uid"), hostSlots: 24 },
  });
  await scheduler.start();
  await scheduler.idle();
  const before = selected.length;
  for (const path of SOURCES) appendFileSync(join(root, path), "// the pull\n");
  const hasher = createFsHasher(root, "sha1");
  await scheduler.handleBatch({ trigger: "interval", paths: await statCandidates(SOURCES, hasher) });
  await scheduler.idle();
  await scheduler.close();
  store.close();
  report(selected.slice(before));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

/** `replay-733.mjs`'s model on the selected runs, with the load when the replay ran. */
function report(after: readonly Run[]): void {
  const s = (ref: TestFileRef) => byId.get(idOf(ref))?.s ?? 0;
  const makespan = (ds: number[], w: number) => {
    const free = Array(Math.max(1, Math.min(w, ds.length))).fill(0);
    for (const d of [...ds].sort((a, b) => b - a)) free[free.indexOf(Math.min(...free))] += d;
    return Math.max(...free);
  };
  const rows = [];
  for (const lane of ["vitest", "node:test"]) {
    const mine = after.filter((r) => r.lane === lane);
    const done: number[] = [];
    const ends: number[] = [];
    let end = 0;
    if (lane === "vitest") {
      for (const run of mine) {
        end += makespan(run.files.map(s), Math.min(run.workers ?? 4, 23)) + 0.5;
        ends.push(Math.round(end * 10) / 10);
        for (const _ of run.files) done.push(end);
      }
    } else {
      const free = [0, 0, 0, 0];
      for (const ref of mine.flatMap((r) => r.files)) {
        const i = free.indexOf(Math.min(...free));
        free[i] = (free[i] ?? 0) + s(ref) + 0.5;
        done.push(free[i] ?? 0);
      }
      end = Math.max(...free);
    }
    const at = (sec: number) => done.filter((d) => d <= sec).length;
    rows.push({
      lane,
      files: done.length,
      runs: mine.length,
      granted: mine.filter((r) => r.workers !== undefined).length,
      tierSizes: lane === "vitest" ? mine.map((r) => r.files.length).join(" ") : "1 each",
      tierEndsS: ends.join(" "),
      grants: lane === "vitest" ? mine.map((r) => r.workers ?? "-").join(" ") : "",
      endS: Math.round(end),
      meanDoneS: Math.round(done.reduce((a, d) => a + d, 0) / done.length),
      at2min: at(120),
      at5min: at(300),
      at10min: at(600),
    });
  }
  console.table(rows);
  console.log(`load ${loadavg().map((l) => l.toFixed(2)).join(" ")} on ${availableParallelism()} CPUs`);
}
