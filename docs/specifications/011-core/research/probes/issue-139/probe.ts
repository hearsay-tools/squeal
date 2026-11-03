// Throwaway: real scheduler/store/capacity/status, scripted runner, no daemon or test process.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, cpus, loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const source = resolve(process.argv[2] ?? ".");
const version = JSON.parse(readFileSync(join(source, "package.json"), "utf8")).version;
const load = loadavg()[0];
console.log(JSON.stringify({ event: "environment", at: new Date().toISOString(), version, source,
  node: process.version, load, cpus: cpus().length, available: availableParallelism() }));
if (load > cpus().length) process.exit(77);
const moduleAt = (path: string) => import(pathToFileURL(join(source, "src/core", path)).href);
const { createScheduler } = await moduleAt("scheduler/index.ts");
const { openStore, isStoreOpenFailure, storePaths } = await moduleAt("store/index.ts");
const { createStateSink } = await moduleAt("state/index.ts");
const { worktreeIdFor } = await moduleAt("fs/index.ts");
const { readHead } = await moduleAt("daemon-loop/head.ts");
const { DEFAULT_POLICY } = await moduleAt("types/index.ts");
const { readNamedFiles } = await moduleAt("status/standing.ts");
const { nextStep } = await moduleAt("status/next-step.ts");
const { readMarks } = await moduleAt("capacity/index.ts");
const { createFsHasher } = await moduleAt("hash/index.ts");
const { statCandidates } = await moduleAt("revision/index.ts");

const scratch = resolve("docs/specifications/011-core/research/probes/issue-139/.scratch");
mkdirSync(scratch, { recursive: true });
const until = async (predicate: () => boolean, label: string) => {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timeout: ${label}`);
    await delay(20);
  }
};
async function scenario(name: string, slots: number | null, edit: boolean) {
  const dir = mkdtempSync(join(scratch, "case-"));
  const root = join(dir, "repo");
  mkdirSync(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init", "-q");
  const nodeFile = { project: "nt", path: "a-node.test.cjs" };
  const vitestFiles = [1, 2, 3, 4].map(i => ({ project: "server", path: `b${i}.test.ts` }));
  const files = [nodeFile, ...vitestFiles];
  const policy = { ...DEFAULT_POLICY, baseline: { onStart: "lookup-then-run-missing" },
    nodeTest: [{ name: "nt", cwd: ".", node: process.execPath, argv: [], env: {}, include: ["*.cjs"] }],
    runner: { ...DEFAULT_POLICY.runner, tierSize: 4, backlogTierSize: 20, timeoutMs: 15000 } };
  writeFileSync(join(root, "squeal.config.json"), JSON.stringify(policy));
  for (const file of files) writeFileSync(join(root, file.path), "// synthetic runner input\n");
  git("add", ".");
  git("-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "commit", "-qm", "fixture");
  const commonDir = join(root, ".git");
  const store = openStore(commonDir);
  if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
  const id = worktreeIdFor(root);
  const began = Date.now();
  store.worktrees.upsert({ id, root, commonDir, isMain: true, registeredAt: began,
    daemon: { socketPath: join(dir, "unused.sock"), startedAt: began, heartbeatAt: began,
      heartbeatIntervalMs: 60000, squealVersion: version } });
  let release = () => {};
  const held = new Promise<void>(r => { release = r; });
  const runs: { paths: string[]; workers?: number; ended: boolean }[] = [];
  const errors: string[] = [];
  const runner = {
    name: "scripted", adapterVersion: "1", lane: (f: typeof nodeFile) => f.project === "nt" ? "node-test" : "vitest",
    besideBacklog: (f: typeof nodeFile) => f.project === "nt",
    backlogSlot: (f: typeof nodeFile) => f.project === "nt" ? 1 : null,
    tierWidth: (_f: typeof nodeFile, grant: number) => Math.max(1, grant),
    invalidate: async () => ({ recreatedProjects: [] }),
    affected: async (changed: string[]) => ({ direct: files.filter(f => changed.includes(f.path)), transitive: [] }),
    closure: async (f: typeof nodeFile) => ({ testFile: f, paths: [f.path] }),
    enumerate: async () => [], testFiles: async () => files,
    environment: async () => ["nt", "server"].map(project => ({ project, runnerName: "scripted",
      runnerVersion: "1", adapterVersion: "1", resolvedConfig: "{}", files: [] })),
    close: async () => {},
    run: async (selected: typeof files, options: { workers?: number }) => {
      const run = { paths: selected.map(f => f.path), workers: options.workers, ended: false };
      runs.push(run);
      if (selected.some(f => f.project === "nt")) await held;
      run.ended = true;
      return { end: "completed", durationMs: 1, completedFiles: selected, fileErrors: [], failure: null,
        results: selected.map(f => ({ check: { kind: "test", project: f.project, testPath: f.path, fullName: "scripted pass" },
          outcome: "pass", durationMs: 1, location: null, errors: [] })) };
    }
  };
  const pool = join(dir, "pool");
  const scheduler = createScheduler({ root, worktreeId: id, store, runner, sink: createStateSink(store),
    policy, squealVersion: version, runsDir: storePaths(commonDir).runsDir, head: () => readHead(root),
    onError: (e: Error) => errors.push(String(e)),
    ...(slots === null ? {} : { capacity: { dir: pool, hostSlots: slots, host: null } }) });
  const snapshot = () => readNamedFiles(store, id, root, files,
    { state: "alive", lastHeartbeatAt: Date.now() }, Date.now()).map((f: { testFile: typeof nodeFile; state: string; standing?: unknown }) =>
      ({ path: f.testFile.path, state: f.state, standing: f.standing,
        text: f.standing ? nextStep(f.standing).reason : undefined }));
  try {
    await scheduler.start();
    await until(() => runs.some(r => r.paths.includes(nodeFile.path)), "node lane starts");
    if (slots !== null) await until(() => readMarks(pool, "reader", Date.now()).some((m: { grant: number }) => m.grant === 1), "node holds sole permit");
    else await until(() => runs.some(r => r.paths.includes(vitestFiles[3].path)), "Vitest starts beside node");
    await delay(100);
    const before = snapshot();
    console.log(JSON.stringify({ event: "held-node", name, slots, runs, status: scheduler.status(), files: before,
      marks: slots === null ? [] : readMarks(pool, "reader", Date.now()).map((m: { want: number; grant: number; since: number | null }) => ({ want: m.want, grant: m.grant, waiting: m.since !== null })) }));
    if (slots !== null) {
      assert.equal(before.filter((f: { text?: string }) => f.text?.includes("nothing recorded holds")).length, 4);
      assert.equal(runs.length, 1);
      // Observe across a real capacity recheck, not just the selection-to-start gap.
      await delay(2200);
      assert.equal(runs.length, 1);
      if (edit) {
        appendFileSync(join(root, vitestFiles[0].path), "// edit\n");
        await scheduler.handleBatch({ trigger: "watch", paths: await statCandidates([vitestFiles[0].path], createFsHasher(root, "sha1")) });
        await until(() => runs.some(r => r.paths.includes(vitestFiles[0].path)), "edit bypasses pool");
        console.log(JSON.stringify({ event: "edited-while-node-held", name, runs, files: snapshot() }));
        assert.equal(runs.find(r => r.paths.includes(vitestFiles[0].path))?.workers, undefined);
      }
    } else assert.equal(before.filter((f: { state: string }) => f.state === "current").length, 4);
    const freed = performance.now();
    release();
    await scheduler.idle();
    const after = snapshot();
    assert.equal(after.filter((f: { state: string }) => f.state === "current").length, 5);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ event: "complete", name, afterReleaseMs: Math.round(performance.now() - freed), runs, files: after, errors }));
  } finally {
    release();
    await scheduler.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
await scenario("free-capacity-control", null, false);
await scenario("one-slot-capacity-wait", 1, false);
await scenario("edit-bypasses-capacity-control", 1, true);
console.log(JSON.stringify({ event: "PASS", scenarios: 3 }));
