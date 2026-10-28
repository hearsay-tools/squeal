// Throwaway protocol probe. The CLI and SQLite store are real; the daemon is scripted.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { availableParallelism, loadavg } from "node:os";
import { join, resolve } from "node:path";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import { openStore, isStoreOpenFailure } from "../../../src/core/store/index.js";

const load = loadavg()[0];
console.log(JSON.stringify({ started: new Date().toISOString(), load, cpus: availableParallelism(), node: process.version }));
if (load > availableParallelism()) {
  console.log("SKIP: one-minute load exceeds CPUs");
  process.exit(77);
}
const cli = resolve(process.argv[2] ?? "plugins/claude-code/dist/cli/squeal.mjs");
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
console.log(JSON.stringify({ cli, checkoutVersion: version }));

async function scenario(name: string, acceptanceMs: number, fastMs: number, slowMs: number) {
  const dir = mkdtempSync("/tmp/sq119-");
  const root = join(dir, "repo");
  mkdirSync(root);
  execFileSync("git", ["init", "-q", root]);
  mkdirSync(join(root, "test"));
  for (const file of ["fast", "slow"]) writeFileSync(join(root, `test/${file}.test.mjs`), "// scripted pending file\n");
  writeFileSync(join(root, "squeal.config.json"), JSON.stringify({ slow: { include: ["test/slow.test.mjs"] } }));
  const id = worktreeIdFor(root);
  const socketPath = join(dir, `squeal-${id}.sock`);
  const store = openStore(join(root, ".git"));
  if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
  const startedAt = Date.now();
  const daemon = { socketPath, startedAt, heartbeatAt: startedAt, heartbeatIntervalMs: 5000, squealVersion: version, token: name };
  const worktree = { id, root, commonDir: join(root, ".git"), isMain: true, registeredAt: startedAt, daemon };
  store.worktrees.upsert(worktree);
  store.revisions.append({ worktreeId: id, createdAt: startedAt, head: null, dirty: true, trigger: "watch", changes: [] });
  function set(file: string, pending: "queued" | null) {
    const path = `test/${file}.test.mjs`;
    store.transaction(() => {
      store.testFileKeys.upsertMany([{ worktreeId: id, testFile: { project: "", path }, key: `key-${file}`, revision: 1, pending }]);
      store.knownStates.upsertMany([{ worktreeId: id, check: { kind: "test", project: "", testPath: path, fullName: file }, outcome: "pass", validity: pending ? "pending" : "current", pendingPhase: pending, observedAt: 1, commit: null, origin: { kind: "own" }, durationMs: 1, location: null, summary: null, fingerprint: null }]);
    });
  }
  set("fast", "queued");
  set("slow", "queued");
  let requestedAt = 0;
  const seen: Record<string, number> = {};
  const timers: NodeJS.Timeout[] = [];
  const server = createServer(socket => {
    socket.on("error", () => {});
    socket.once("data", data => {
      const request = JSON.parse(data.toString());
      seen[request.type] = (seen[request.type] ?? 0) + 1;
      let answer: object;
      if (request.type === "run-slow" || request.type === "run-slow-status") {
        if (!requestedAt) {
          requestedAt = Date.now();
          timers.push(setTimeout(() => set("fast", null), fastMs), setTimeout(() => set("slow", null), slowMs));
        }
        answer = { ok: true, type: "run-slow", requestId: "probe-request", requested: Date.now() - requestedAt >= acceptanceMs ? { revision: 1, queued: 1 } : null, error: null };
      } else if (request.type === "sync") {
        answer = { ok: true, type: "sync", requestId: "sync", revision: 1, error: null };
      } else answer = { ok: true, type: request.type };
      socket.end(`${JSON.stringify({ schemaVersion: 1, ...answer })}\n`);
    });
  });
  await new Promise<void>(done => server.listen(socketPath, done));
  const heartbeat = setInterval(() => store.worktrees.upsert({ ...worktree, daemon: { ...daemon, heartbeatAt: Date.now() } }), 1000);
  async function run(args: string[]) {
    const before = performance.now();
    const env = { PATH: process.env.PATH!, XDG_RUNTIME_DIR: dir, LANG: "C.UTF-8" };
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", cli, ...args], { cwd: root, env });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => stdout += d);
    child.stderr.on("data", d => stderr += d);
    const kill = setTimeout(() => child.kill("SIGKILL"), 25000);
    const code = await new Promise<number | null>(done => child.on("exit", done));
    clearTimeout(kill);
    const result = { scenario: name, command: [process.execPath, "--disable-warning=ExperimentalWarning", cli, ...args], elapsedMs: Math.round(performance.now() - before), exit: code, stdout, stderr, pending: store.testFileKeys.list(id).filter(x => x.pending !== null).map(x => x.testFile.path), requests: { ...seen } };
    console.log(JSON.stringify(result));
    return result;
  }
  try {
    const result = await run(["run", "--slow", "--wait", "3000000"]);
    if (acceptanceMs > 10000) {
      if (result.exit !== 1 || !result.stdout.includes("the daemon takes it once its current work allows") || result.pending.length !== 2) throw new Error("receipt reproduction failed");
      const named = await run(["status", "--wait", "3000000", "test/slow.test.mjs"]);
      if (named.exit !== 0 || named.pending.length !== 0 || named.elapsedMs < 1000) throw new Error("named wait control failed");
    } else if (result.exit !== 0 || result.pending.length !== 0 || result.elapsedMs < slowMs) throw new Error("accepted-request control failed");
  } finally {
    clearInterval(heartbeat);
    for (const timer of timers) clearTimeout(timer);
    await new Promise<void>(done => server.close(() => done()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
await scenario("acceptance-delayed", 12000, 14000, 16000);
await scenario("accepted-with-fast-backlog", 0, 2000, 4000);
