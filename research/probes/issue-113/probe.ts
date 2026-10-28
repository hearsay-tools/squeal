// Throwaway bounded research probe. No product files are changed.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { readHead } from "../../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import { createScheduler } from "../../../src/core/scheduler/index.js";
import { createStateSink } from "../../../src/core/state/index.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../../src/core/store/index.js";
import {
  DEFAULT_POLICY,
  type RunnerAdapter,
  type RunReport,
} from "../../../src/core/types/index.js";

const runtime = ".runtime/descriptor.json";
const files = ["test/a.test.ts", "test/b.test.ts"].map((path) => ({ project: "", path }));
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function probe(rewrite: boolean, slow: boolean, scoped: boolean) {
  const load = loadavg()[0];
  const cpuCount = cpus().length;
  console.log(
    JSON.stringify({
      phase: "load-gate",
      rewrite,
      slow,
      scoped,
      time: new Date().toISOString(),
      load,
      cpuCount,
      node: process.version,
    }),
  );
  if (load > cpuCount) {
    console.log("not reproduced, because one-minute host load exceeds CPU count");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "squeal-issue-113-"));
  mkdirSync(join(root, "test"));
  mkdirSync(join(root, ".runtime"));
  for (const file of files) writeFileSync(join(root, file.path), "// synthetic passing test\n");
  writeFileSync(join(root, ".gitignore"), ".runtime/\n");
  writeFileSync(join(root, runtime), "0\n");
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init", "-q");
  git("add", ".");
  git(
    "-c",
    "user.name=Probe",
    "-c",
    "user.email=probe@example.invalid",
    "commit",
    "-qm",
    "fixture",
  );
  const common = join(root, ".git");
  const store = openStore(common);
  if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
  const worktreeId = worktreeIdFor(root);
  store.worktrees.upsert({
    id: worktreeId,
    root,
    commonDir: common,
    isMain: true,
    registeredAt: Date.now(),
    daemon: null,
  });
  const runs: { paths: string[]; runId: string; bytes: string }[] = [];
  const runner: RunnerAdapter = {
    name: "fake",
    adapterVersion: "1",
    invalidate: async () => ({ recreatedProjects: [] }),
    affected: async () => ({ direct: [], transitive: [] }),
    closure: async (testFile) => ({ testFile, paths: [testFile.path] }),
    enumerate: async () => [],
    testFiles: async () => files,
    environment: async () => [
      {
        project: "",
        runnerName: "fake",
        runnerVersion: "1",
        adapterVersion: "1",
        resolvedConfig: "{}",
        files: [],
      },
    ],
    close: async () => {},
    run: async (selected, options): Promise<RunReport> => {
      const bytes = readFileSync(join(root, runtime), "utf8");
      runs.push({ paths: selected.map((f) => f.path), runId: options.runId, bytes });
      if (rewrite) writeFileSync(join(root, runtime), `${runs.length}\n`);
      await delay(30);
      return {
        end: "completed",
        durationMs: 30,
        completedFiles: selected,
        fileErrors: [],
        failure: null,
        results: selected.map((f) => ({
          check: { kind: "test", project: f.project, testPath: f.path, fullName: "passes" },
          outcome: "pass",
          durationMs: 1,
          location: null,
          errors: [],
        })),
        observed: selected.map((testFile) => ({
          testFile,
          paths: [runtime],
          modules: [],
          directories: [],
        })),
      };
    },
  };
  const policy = {
    ...DEFAULT_POLICY,
    baseline: { ...DEFAULT_POLICY.baseline, onStart: "lookup-then-run-missing" as const },
    runtimeFiles: scoped ? [{ project: "", tests: ["test/*.test.ts"], paths: [runtime] }] : [],
    slow: {
      ...DEFAULT_POLICY.slow,
      trigger: "idle" as const,
      include: slow ? ["test/*.test.ts"] : [],
      maxParallel: 1,
      quietMs: 0,
    },
  };
  const scheduler = createScheduler({
    root,
    worktreeId,
    store,
    runner,
    sink: createStateSink(store),
    policy,
    squealVersion: "0.1.369",
    runsDir: storePaths(common).runsDir,
    head: () => readHead(root),
    slow: { slotDir: join(root, ".git", "slots"), recheckMs: 25 },
    onError: (error) => console.log(JSON.stringify({ error: error.message })),
  });
  try {
    await scheduler.start();
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline && runs.length < 6) await delay(50);
    await scheduler.close();
    const rows = store.testFileKeys.list(worktreeId).map((row) => ({
      path: row.testFile.path,
      key: row.key,
      pending: row.pending,
      revision: row.revision,
      results:
        row.key === null
          ? []
          : store.results
              .byKey(row.key)
              .map((r) => ({ outcome: r.outcome, run: r.provenance.runId })),
    }));
    console.log(
      JSON.stringify({
        rewrite,
        slow,
        scoped,
        runs,
        rows,
        completed: runs.map((r) => store.runs.get(r.runId)?.end),
        observed: store.meta.get("observed."),
        runtimePolicy: store.meta.get(`runtimeFiles.${worktreeId}`),
      }),
    );
  } finally {
    await scheduler.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}
await probe(false, true, true);
await probe(true, true, true);
await probe(true, false, true);
await probe(false, true, false);
