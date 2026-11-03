// Throwaway: a seeded store and a stand-in socket, never a real runner.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { worktreeIdFor } from "../../../../../../src/core/fs/index.js";
import { socketPathFor } from "../../../../../../src/core/daemon/paths.js";
import { isStoreOpenFailure, openStore } from "../../../../../../src/core/store/open.js";
import { daemonIncarnation, refinedMetaKey } from "../../../../../../src/core/types/index.js";

const runtime = process.argv[2] ?? "/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.390";
const cli = join(runtime, "dist/cli/squeal.mjs");
const manifest = JSON.parse(readFileSync(join(runtime, "runtime.json"), "utf8"));
const hash = createHash("sha256").update(readFileSync(cli)).digest("hex");
assert.equal(hash, manifest.files["dist/cli/squeal.mjs"].sha256);
assert.equal(manifest.version, "0.1.390");
console.log(JSON.stringify({ runtime, version: manifest.version, cliSha256: hash, node: process.version }));

const root = mkdtempSync("/tmp/sq142-");
const commonDir = join(root, ".git");
const runDir = join(root, "socket");
mkdirSync(runDir);
execFileSync("git", ["init", "-q", root]);
writeFileSync(join(root, "squeal.config.json"), JSON.stringify({ baseline: { onStart: "lookup-only" } }));
const id = worktreeIdFor(root);
const env = { ...process.env, XDG_RUNTIME_DIR: runDir };
const socketPath = socketPathFor(id, env);
const store = openStore(commonDir);
if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
const now = Date.now();
const record = {
  socketPath, startedAt: now - 120_000, heartbeatAt: now,
  heartbeatIntervalMs: 5_000, squealVersion: "0.1.390", token: "issue-142-probe",
};
const register = (stale: boolean) => store.worktrees.upsert({
  id, root, commonDir, isMain: true, registeredAt: now - 120_000,
  daemon: { ...record, heartbeatAt: Date.now() - (stale ? 64_000 : 0) },
});
register(false);
for (let revision = 1; revision <= 2; revision++) store.revisions.append({
  worktreeId: id, createdAt: now - (3 - revision) * 10_000,
  head: null, dirty: true, trigger: "watch",
  changes: [{ path: "scripts/test-package.test.mjs", oldHash: null, newHash: `new-${revision}` }],
});
store.meta.set(refinedMetaKey(id), "1");
store.testFileKeys.upsertMany([{
  worktreeId: id, testFile: { project: "", path: "scripts/old.test.mjs" },
  key: "old-key", revision: 1, pending: "queued",
}]);
mkdirSync(join(root, "scripts"));
writeFileSync(join(root, "scripts/test-package.test.mjs"), "// Newly created, not discovered.\n");
let syncRevision: number | null = null;
const requests: Record<string, number> = {};
const server = createServer((socket) => {
  socket.on("error", () => {});
  socket.once("data", (bytes) => {
    const request = JSON.parse(bytes.toString());
    requests[request.type] = (requests[request.type] ?? 0) + 1;
    const response = request.type === "ping"
      ? { type: "ping", pid: process.pid, worktreeId: id, root, squealVersion: "0.1.390", phase: "ready", startedAt: record.startedAt }
      : { type: "sync", requestId: "probe-sync", revision: syncRevision, error: null, moves: true, incarnation: daemonIncarnation(record) };
    socket.end(`${JSON.stringify({ schemaVersion: 1, ok: true, ...response })}\n`);
  });
});
await new Promise<void>((resolve) => server.listen(socketPath, resolve));

async function run(label: string, stale: boolean, path: string) {
  const load = loadavg()[0];
  const count = cpus().length;
  console.log(JSON.stringify({ label, at: new Date().toISOString(), load1: load, cpus: count }));
  if (load > count) { console.log("SKIP: one-minute load exceeds CPU count"); return null; }
  register(stale);
  const args = [cli, "status", "--json", "--wait", "1500", path];
  console.log(JSON.stringify({ command: [process.execPath, ...args], cwd: root }));
  const start = performance.now();
  const output = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
  const json = JSON.parse(output.stdout);
  console.log(JSON.stringify({ code: output.code, wallMs: Math.round(performance.now() - start),
    revision: json.revision, testFilesListed: json.testFilesListed, runnerPartPending: json.runnerPartPending,
    refinedRevision: json.refinedRevision, daemon: json.daemon, selection: json.selection, requests }));
  // JSON escaping preserves exact stderr bytes, including trailing spaces.
  console.log(JSON.stringify({ stderr: output.stderr }));
  return { ...output, json };
}

try {
  const fresh = await run("fresh heartbeat, new file, discovery pending", false, "scripts/test-package.test.mjs");
  const stale = await run("stale heartbeat, answering socket, new file, discovery pending", true, "scripts/test-package.test.mjs");
  const existing = await run("fresh heartbeat, listed file, discovery pending", false, "scripts/old.test.mjs");
  for (const result of [fresh, stale, existing]) if (result) {
    assert.equal(result.code, 3);
    assert.equal(result.json.selection.result, "none");
    assert.equal(result.json.runnerPartPending, true);
  }
  if (fresh) assert.match(fresh.stderr, /no test file's closure holds scripts\/test-package\.test\.mjs/);
  if (stale) {
    assert.match(stale.stderr, /no test file's closure holds scripts\/test-package\.test\.mjs/);
    assert.match(stale.stderr, /socket showed it alive/);
    assert.equal(stale.json.selection.reason, "lapsed");
  }
  syncRevision = 2;
  const synced = await run("fresh heartbeat, sync answered, new file, discovery pending", false, "scripts/test-package.test.mjs");
  if (synced) {
    assert.equal(synced.code, 3);
    assert.equal(synced.json.selection.reason, "unlisted");
    assert.match(synced.stderr, /no test file's closure holds scripts\/test-package\.test\.mjs/);
  }
  // A completed listing still containing no matching test is a distinct control.
  store.meta.set(refinedMetaKey(id), "2");
  const absent = await run("fresh heartbeat, completed listing, no matching file", false, "scripts/absent.mjs");
  if (absent) {
    assert.equal(absent.code, 3);
    assert.equal(absent.json.selection.reason, "unmatched");
    assert.equal(absent.json.runnerPartPending, false);
  }
  // Synthetic recovery: inject discovery and a current pass; no test actually ran.
  store.testFileKeys.upsertMany([{
    worktreeId: id, testFile: { project: "", path: "scripts/test-package.test.mjs" },
    key: "new-key", revision: 2, pending: null,
  }]);
  store.knownStates.upsertMany([{
    worktreeId: id, check: { kind: "file", project: "", testPath: "scripts/test-package.test.mjs" },
    outcome: "pass", validity: "current", pendingPhase: null, observedAt: 2,
    commit: null, origin: { kind: "own" }, durationMs: 1, location: null,
    summary: null, fingerprint: null,
  }]);
  const recovered = await run("stale heartbeat, sync answered, file listed and current (injected)", true, "scripts/test-package.test.mjs");
  if (recovered) {
    assert.equal(recovered.code, 0);
    assert.equal(recovered.json.selection.result, "pass");
    assert.equal(recovered.json.runnerPartPending, false);
  }
  console.log("Assertions passed for every non-skipped case. No real daemon or tests were run.");
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
  rmSync(root, { recursive: true, force: true });
}
