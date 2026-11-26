// Throwaway (spec 027 research). Drives `squeal runner-host --runner pytest`
// through any stdio command (here `docker exec -i <container> ...`) with the
// protocol of src/core/runner-host/protocol.ts: start, run, then one ending.
// Usage: node drive-host.mjs <ending> <file[,file...]> -- <command...>
//   ending: wait (await the run) | cancel (cancel "stop" after 5 s)
//         | eof (close stdin after 5 s) | kill (SIGKILL the client after 5 s)
import { spawn } from "node:child_process";
const MARK = "\u0001squeal-runner-host ";
const argv = process.argv.slice(2);
const ending = argv[0], file = argv[1], cmd = argv.slice(argv.indexOf("--") + 1);
const python = process.env.PROBE_PYTHON ?? "/pkgs/.venv";
const t0 = Date.now();
const at = () => `${String(Date.now() - t0).padStart(6)} ms`;
const child = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
const pending = new Map();
let buf = "";
child.stdout.setEncoding("utf8").on("data", (d) => {
  buf += d;
  for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    const k = line.indexOf(MARK); if (k < 0) continue;
    const msg = JSON.parse(line.slice(k + MARK.length));
    if ("id" in msg && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.ev !== "alive") console.log(at(), "event", JSON.stringify(msg).slice(0, 200));
  }
});
child.stderr.setEncoding("utf8").on("data", (d) => process.stdout.write(`[host stderr] ${d.slice(0, 400)}`));
child.on("exit", (code, signal) => console.log(at(), "client exit", code, signal));
let next = 1;
const send = (m, a) => { const id = next++; child.stdin.write(`${MARK}${JSON.stringify({ id, m, a })}\n`); return id; };
const req = (m, a) => new Promise((r) => pending.set(send(m, a), r));
const policy = { observe: true, exclude: [], excludeProjects: [], coverage: false, coverageChildren: false, tierSize: 1 };
const runner = process.env.PROBE_RUNNER ?? "pytest";
const project = runner === "node-test"
  ? { name: "p", node: process.env.PROBE_NODE ?? "node", argv: [], env: {}, include: ["**/*.test.mjs"] }
  : { name: "p", python, args: [], env: {}, include: ["**/test_*.py"] };
const started = await req("start", [{ protocol: 1, version: process.env.SQ_VERSION ?? "0.1.641", runner,
  options: { childEnv: {}, process: { project, tempDir: "/tmp", cacheDir: "/tmp/sqcache" } }, policy }]);
console.log(at(), "start", JSON.stringify(started.r?.host ?? started.e));
const runId = next;
const run = req("run", [file.split(",").map((path) => ({ project: "p", path })), { runId: "r1", logDir: "/tmp/sqlogs/r1", timeoutMs: null }]);
run.then((m) => {
  const r = m.r ?? {};
  const files = (r.files ?? r.results ?? []);
  console.log(at(), "run reply", m.e ? JSON.stringify(m.e) : JSON.stringify(r).slice(0, 600));
});
if (ending === "wait") { await run; child.stdin.end(); }
else if (ending === "twice") { await run; await req("run", [file.split(",").map((path) => ({ project: "p", path })), { runId: "r2", logDir: "/tmp/sqlogs/r2", timeoutMs: null }]).then((m) => console.log(at(), "second run", JSON.stringify(m.r ?? m.e).slice(0, 160))); child.stdin.end(); }
else {
  await new Promise((r) => setTimeout(r, 5000));
  console.log(at(), "ending:", ending);
  if (ending === "cancel") { child.stdin.write(`${MARK}${JSON.stringify({ id: next++, m: "cancel", a: [runId, "stop", "stop"] })}\n`); await run; child.stdin.end(); }
  if (ending === "eof") child.stdin.end();
  if (ending === "kill") child.kill("SIGKILL");
}
