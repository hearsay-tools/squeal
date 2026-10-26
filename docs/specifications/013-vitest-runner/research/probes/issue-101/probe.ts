// Throwaway (issue #101 triage probe, 2026-10-26). Not product code; delete freely.
// Runs one fixture test through the real VitestAdapter, aborts the run with a
// scheduler cause, then reports whether the test's detached SIGTERM-ignoring
// child is still alive. Kills only the holder pids it recorded, after checking
// each one's command line carries this probe's token.
// Usage: npx tsx probe.ts <control|await|block|slow-teardown> [cause]
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createVitestAdapter } from "../../../../../../src/runners/vitest/index.js";

const mode = process.argv[2] ?? "await";
const cause = process.argv[3] ?? "supersession";
const repo = resolve(import.meta.dirname, "../../../../../..");
const fixtures = join(repo, "test/fixtures/vitest");
const root = join(fixtures, ".tmp", `issue-101-${randomUUID()}`);
const token = `squeal-issue-101-${randomUUID().slice(0, 8)}`;
const holder = join(import.meta.dirname, "holder.cjs");
const marks = join(root, ".marks");
const owned: number[] = [];
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;
const log = (...a: unknown[]) => console.log(`[${at()}]`, ...a);

function cleanup() {
  for (const pid of owned) {
    let cmd = "";
    try { cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8"); } catch { continue; }
    if (cmd.includes(token)) { try { process.kill(pid, "SIGKILL"); log("cleanup: SIGKILL owned holder", pid); } catch {} }
  }
  rmSync(root, { recursive: true, force: true });
}
// Self-expiry: the whole probe ends within 120 s whatever happens.
setTimeout(() => { log("probe self-expiry"); cleanup(); process.exit(2); }, 120_000).unref();

function proc(pid: number) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ").trim();
    return { alive: true, state: f[0], ppid: Number(f[1]), pgid: Number(f[2]), cmd };
  } catch { return { alive: false }; }
}

const testFile = `
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, it } from "vitest";
const MARKS = ${JSON.stringify(marks)};
let leader;
afterEach(async () => {
  writeFileSync(MARKS + "/teardown", String(Date.now()));
  if (${JSON.stringify(mode)} === "slow-teardown") {
    // A supervisor's stop: SIGTERM the group, wait for it, escalate after 2 s.
    try { process.kill(-leader.pid, "SIGTERM"); } catch {}
    await new Promise((r) => setTimeout(r, 2_000));
  }
  try { process.kill(-leader.pid, "SIGKILL"); } catch {}
  writeFileSync(MARKS + "/teardown-done", String(Date.now()));
});
it("starts a detached leader that forks a SIGTERM-ignoring holder, then waits", async () => {
  leader = spawn("sh", ["-c", ${JSON.stringify(`node ${holder} --lifetime 60000 --tag ${token} --ready ${marks}/holder.ready & echo $! > ${marks}/holder.pid; exit 0`)}], { detached: true, stdio: "ignore" });
  const deadline = Date.now() + 20_000;
  while (!existsSync(MARKS + "/holder.ready") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  writeFileSync(MARKS + "/worker", JSON.stringify({ pid: process.pid, ppid: process.ppid, ipc: typeof process.send === "function", leader: leader.pid }));
  writeFileSync(MARKS + "/started", "");
  if (${JSON.stringify(mode)} === "block") {
    while (Date.now() < deadline) {} // ignores every cancel: the event loop never turns
  } else {
    while (!existsSync(MARKS + "/release") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  }
}, 60_000);
`;

mkdirSync(join(fixtures, ".tmp"), { recursive: true });
cpSync(join(fixtures, "basic"), root, { recursive: true });
mkdirSync(marks, { recursive: true });
writeFileSync(join(root, "test/holder.test.ts"), testFile);
log("mode", mode, "cause", cause, "token", token);
const adapter = await createVitestAdapter({ root });
try {

  await adapter.invalidate([{ path: "test/holder.test.ts", kind: "add" }]);
  const controller = new AbortController();
  if (mode === "control") writeFileSync(join(marks, "release"), "");
  const running = adapter.run([{ project: "", path: "test/holder.test.ts" }], {
    runId: randomUUID(), logDir: join(root, ".squeal-logs"), timeoutMs: null, signal: controller.signal,
  });
  while (!existsSync(join(marks, "started"))) {
    if (Date.now() - t0 > 60_000) throw new Error("test never started");
    await new Promise((r) => setTimeout(r, 20));
  }
  const pid = Number(readFileSync(join(marks, "holder.pid"), "utf8"));
  owned.push(pid);
  log("worker", readFileSync(join(marks, "worker"), "utf8"));
  log("holder before abort", pid, JSON.stringify(proc(pid)));
  if (mode !== "control") { log("abort", cause); controller.abort(cause); }
  const report = await running;
  log("run returned", JSON.stringify({ end: report.end, failure: report.failure, completed: report.completedFiles, results: report.results.map((r) => r.outcome) }));
  log("teardown began:", existsSync(join(marks, "teardown")), "teardown finished:", existsSync(join(marks, "teardown-done")));
  const w = JSON.parse(readFileSync(join(marks, "worker"), "utf8"));
  log("worker after run", w.pid, JSON.stringify(proc(w.pid)));
  await new Promise((r) => setTimeout(r, 1_000));
  log("holder 1 s after run returned", pid, JSON.stringify(proc(pid)));
  // Release a cooperative waiter so a hung instance does not hold the probe.
  writeFileSync(join(marks, "release"), "");
} finally {
  await Promise.race([adapter.close(), new Promise((r) => setTimeout(r, 15_000))]);
  for (const pid of owned) log("holder after adapter.close", pid, JSON.stringify(proc(pid)));
  cleanup();
  for (const pid of owned) log("holder after cleanup", pid, JSON.stringify(proc(pid)));
}
process.exit(0);
