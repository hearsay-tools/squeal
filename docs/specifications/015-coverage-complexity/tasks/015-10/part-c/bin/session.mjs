#!/usr/bin/env node
// Throwaway probe for 015-10 Part C. Not product code.
//   node session.mjs <id> <repo>     id: sq1..sq6 or cz1..cz6, `r` suffix for a rerun; repo: squeal or cezar
// One `claude -p` session on --model sonnet, as squeal-e2e (as-e2e.mjs), in the clone
// /home/squeal-e2e/runs/d1510/<repo>, with prompts/<id>.txt. Before it: the clone is reset to
// its base commit and a daemon counts that revision. The one-minute load is recorded at the start
// (the load gate was dropped, the human, 2026-10-24 07:05Z). One session per clone at a time:
// a lock directory, locks/<repo>, refuses a second runner. Stream-json with hook events,
// every line stamped with epoch ms as it arrives. 60 s after the `result` event, or at 15 min,
// the session is sent SIGTERM (only this script's own child). Before and after: the daemon's
// CPU (ps time of its pid), `squeal code`, the diff. Credentials pass by name only.
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [id, repo] = process.argv.slice(2);
if (!/^(sq|cz)[1-6]r?$/.test(id ?? "") || !["squeal", "cezar"].includes(repo ?? "")) {
  console.error("usage: session.mjs <sq1..cz6>[r] <squeal|cezar>");
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const W = dirname(here);
const R = "/home/squeal-e2e/runs/d1510";
const CWD = `${R}/${repo}`;
const BASE = { squeal: "d5018817aa3c2f6e09126a8d18cfc59389a810c9", cezar: "03c905a00c449c7a6257e2d0d3c16383cd267743" }[repo];
// cz4 and cz5 shared the cezar clone and cz5's reset wiped
// cz4's edits. The lock makes that impossible.
mkdirSync(join(W, "locks"), { recursive: true });
try {
  mkdirSync(join(W, "locks", repo));
} catch {
  console.error(`refused: a session already runs in ${repo} (locks/${repo})`);
  process.exit(3);
}
process.on("exit", () => rmSync(join(W, "locks", repo), { recursive: true, force: true }));
const out = join(W, "logs", "sessions", id);
mkdirSync(out, { recursive: true });
const task = readFileSync(join(W, "prompts", `${id.replace(/r$/, "")}.txt`), "utf8").trim();
const meta = { id, repo, base: BASE };
const load1 = () => Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
const as = (args, extra = {}) =>
  execFileSync("node", [join(here, "as-e2e.mjs"), R, CWD, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...extra });
const tryAs = (args) => {
  try {
    return as(args);
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}(exit ${e.status})`;
  }
};
const daemonCpu = () => {
  const ps = execFileSync("ps", ["-u", "squeal-e2e", "-o", "pid=,times=,args="], { encoding: "utf8" });
  const line = ps.split("\n").find((l) => l.includes(" daemon ") && l.trim().endsWith(`daemon ${CWD}`));
  if (!line) return null;
  const [pid, cpu] = line.trim().split(/\s+/);
  return { pid: Number(pid), cpuS: Number(cpu) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reset the clone to its base; give the daemon its pass.
tryAs(["git", "reset", "-q", "--hard", BASE]);
tryAs(["git", "clean", "-fdq"]);
// sq6 starts on a branch `work` behind the base, so the session's own fast-forward is a pull.
const CHECKOUT = { sq6: "ab376e7fd27b043d530aff3729333dde80fec735" }[id.replace(/r$/, "")];
if (CHECKOUT) meta.checkout = tryAs(["git", "checkout", "-q", "-B", "work", CHECKOUT]) || `work at ${CHECKOUT}`;
else tryAs(["git", "checkout", "-q", "dogfood"]);
// A daemon exits 3 s after its last session ends: start one, so the reset is counted before the
// session registers (sq2 registered at the stale revision and was told the reset as a FAIL).
meta.startOut = tryAs(["squeal", "start"]).trim().split("\n").slice(-2).join(" | ");
tryAs(["squeal", "status", "--wait", "30000"]);
writeFileSync(join(out, "code-before.txt"), tryAs(["squeal", "code"]));
meta.daemonBefore = daemonCpu();

meta.loadAtStart = load1();
meta.start = new Date().toISOString();
const t0 = Date.now();

const args = [
  join(here, "as-e2e.mjs"), R, CWD,
  "claude", "-p", task, "--model", "sonnet", "--output-format", "stream-json", "--verbose",
  "--include-hook-events", "--permission-mode", "bypassPermissions",
];
const child = spawn("node", args, {
  cwd: "/",
  env: { ...process.env, E2E_PRESERVE: "ANTHROPIC_BASE_URL,ANTHROPIC_AUTH_TOKEN", E2E_NODE: "24" },
  stdio: ["ignore", "pipe", "pipe"],
});
const stream = createWriteStream(join(out, "stream.jsonl"));
const errs = createWriteStream(join(out, "stderr.txt"));
let buf = "";
let resultAt = null;
const loads = [];
const loadTimer = setInterval(() => loads.push({ t: Date.now() - t0, load1: load1() }), 30000);
child.stdout.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    stream.write(`${Date.now()} ${line}\n`);
    try {
      const ev = JSON.parse(line);
      if (ev.type === "system" && ev.subtype === "init") meta.sessionId = ev.session_id;
      if (resultAt === null && ev.type === "result") {
        resultAt = Date.now();
        setTimeout(() => child.kill("SIGTERM"), 60000).unref();
      }
    } catch {}
  }
});
child.stderr.pipe(errs);
const hard = setTimeout(() => {
  meta.killedAtLimit = true;
  child.kill("SIGTERM");
}, 15 * 60000);
const code = await new Promise((r) => child.on("exit", (c, s) => r(c ?? s)));
clearTimeout(hard);
clearInterval(loadTimer);
meta.exit = code;
meta.wallS = (Date.now() - t0) / 1000;
meta.resultS = resultAt === null ? null : (resultAt - t0) / 1000;
meta.loadAtEnd = load1();
meta.loads = loads;
await sleep(3000);
meta.daemonAfter = daemonCpu();
writeFileSync(join(out, "diff.patch"), tryAs(["git", "diff", BASE]));
writeFileSync(join(out, "status-after.txt"), tryAs(["git", "status", "--short"]));
const changed = tryAs(["git", "diff", "--name-only", BASE]).split("\n").filter(Boolean);
const untracked = tryAs(["git", "ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
meta.changed = [...changed, ...untracked];
tryAs(["squeal", "status", "--wait", "30000"]);
writeFileSync(join(out, "code-after.txt"), tryAs(["squeal", "code"]));
const codeFiles = meta.changed.filter((p) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py)$/.test(p));
if (codeFiles.length > 0) writeFileSync(join(out, "code-after-paths.json"), tryAs(["squeal", "code", ...codeFiles, "--json"]));
writeFileSync(join(out, "squeal-status-after.txt"), tryAs(["squeal", "status"]));
if (meta.sessionId) {
  const slug = CWD.replace(/[^a-zA-Z0-9]/g, "-");
  writeFileSync(
    join(out, "transcript.jsonl"),
    tryAs(["cat", `${R}/claude/projects/${slug}/${meta.sessionId}.jsonl`]),
  );
}
writeFileSync(join(out, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
console.log(JSON.stringify({ id, start: meta.start, loadAtStart: meta.loadAtStart, wallS: meta.wallS, exit: code, changed: meta.changed }));
