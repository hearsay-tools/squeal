// Throwaway probe for hearsay-tools/squeal#90. Not product code, not a test.
// Usage: node probe.mjs <plugin-root> <node_modules-with-vitest>
//   e.g. node probe.mjs ~/.claude/plugins/cache/hearsay/squeal/0.1.279 <worktree>/node_modules
// Builds a scratch repo, HOME and XDG_RUNTIME_DIR under a fresh /tmp dir. The repo copies the
// shape of the incident's policy: baseline.onStart "lookup-only", three slow e2e files whose
// declared inputs include "e2e/**/*.{ts,mjs}", two fast tests. It plays the plugin's own hook
// bundles with Claude Code's JSON on stdin (synthetic, no real claude session):
//   A  squeal stop -> PostToolBatch with no edit                       (control)
//   B  squeal stop -> Bash-style edit of e2e/a.e2e.ts -> PostToolBatch  (the incident's step)
//   C  edit again while the restarted daemon lives -> PostToolBatch     (live-watcher edit)
//   D  squeal hold -- sh -c '<edit>; sleep 8' with a PostToolBatch mid-hold (existing gh-49 hold)
//   E  squeal hold --max 2m -- sleep 60 in the background; edits in separate Bash calls; squeal start
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [plugin, nodeModules] = process.argv.slice(2);
const cli = join(plugin, "dist/cli/squeal.mjs");
const T = mkdtempSync("/tmp/squeal-issue90-");
const repo = join(T, "repo");
const env = { ...process.env, HOME: join(T, "home"), XDG_RUNTIME_DIR: join(T, "run"), CLAUDE_PLUGIN_ROOT: plugin };
delete env.CLAUDE_CODE_SESSION_ATTENDED; // -p-like: no idle waiter
for (const k of Object.keys(env)) if (k.startsWith("SQUEAL_") || k.startsWith("CEZ_")) delete env[k];
for (const d of [join(repo, "e2e"), env.HOME, env.XDG_RUNTIME_DIR]) mkdirSync(d, { recursive: true });
chmodSync(env.XDG_RUNTIME_DIR, 0o700);
const git = (...a) => execFileSync("git", a, { cwd: repo, env, stdio: "pipe" });
const put = (p, s) => writeFileSync(join(repo, p), s);
git("init", "-q", "-b", "main");
symlinkSync(nodeModules, join(repo, "node_modules"));
put(".gitignore", "node_modules\n");
put("package.json", '{"name":"p","type":"module","private":true}\n');
put("vitest.config.ts", 'export default { test: { include: ["*.test.ts", "e2e/*.e2e.ts"] } };\n');
put("squeal.config.json", JSON.stringify({
  baseline: { onStart: "lookup-only" },
  slow: { include: ["e2e/*.e2e.ts"], maxWorkers: 1, maxParallel: 1 },
  inputs: { "e2e/*.e2e.ts": ["e2e/**/*.{ts,mjs}"] },
}, null, 2) + "\n");
for (const n of ["a", "b"]) put(`${n}.test.ts`, `import { test } from "vitest"; test("${n}", () => {});\n`);
for (const n of ["a", "b", "c"]) put(`e2e/${n}.e2e.ts`, `import { test } from "vitest"; test("e2e ${n}", () => {});\n`);
git("add", "-A");
git("-c", "user.name=p", "-c", "user.email=p@p", "commit", "-qm", "fixture");

const session = "issue90-probe";
const t0 = Date.now();
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
const load = () => execFileSync("cat", ["/proc/loadavg"]).toString().trim();
function hook(name, input) {
  const r = spawnSync("node", ["--disable-warning=ExperimentalWarning", join(plugin, "dist", `${name}.mjs`)], {
    cwd: repo, env, input: JSON.stringify({ session_id: session, cwd: repo, ...input }), encoding: "utf8", timeout: 15_000,
  });
  let text = r.stdout.trim();
  try { text = JSON.parse(text).hookSpecificOutput?.additionalContext ?? text; } catch {}
  console.log(`${stamp()} hook ${name} exit=${r.status}\n${text.replace(/^/gm, "    | ")}`);
}
const batch = (command) =>
  hook("post-tool-batch", { hook_event_name: "PostToolBatch", tool_calls: [{ tool_name: "Bash", tool_input: { command } }] });
function squeal(...a) {
  const r = spawnSync("node", [cli, ...a], { cwd: repo, env, encoding: "utf8", timeout: 180_000 });
  console.log(`${stamp()} $ squeal ${a.join(" ")} -> exit=${r.status}\n${(r.stdout + r.stderr).trim().replace(/^/gm, "    ")}`);
  return r.stdout;
}
// The Bash tool's edit: a shell runs sed, as python3/sed did in the incident.
let edits = 0;
function bashEdit(file) {
  edits++;
  spawnSync("sh", ["-c", `sed -i '$a // probe edit ${edits}' ${file}`], { cwd: repo, env });
  console.log(`${stamp()} bash: sed -i '$a // probe edit ${edits}' ${file}`);
}
function daemons() {
  const r = spawnSync("pgrep", ["-af", `squeal.mjs daemon ${repo}`], { encoding: "utf8" });
  const n = r.stdout.trim().split("\n").filter((l) => l && !l.includes("pgrep")).length;
  console.log(`${stamp()} daemon processes for fixture: ${n}`);
  return n;
}
// Per slow file: its state and validity, from status --json.
function slowState(label) {
  const r = spawnSync("node", [cli, "status", "--json"], { cwd: repo, env, encoding: "utf8", timeout: 30_000 });
  let s;
  try { s = JSON.parse(r.stdout); } catch { console.log(`${stamp()} [${label}] status --json unreadable: ${r.stdout.slice(0, 200)}`); return; }
  const holds = (s.holds ?? []).map((h) => h.cause).join(",") || "none";
  console.log(`${stamp()} [${label}] rev=${s.revision?.number ?? s.revision} slow=${JSON.stringify(s.slow ?? s.slowTier ?? null)} holds=${holds}`);
}

console.log(`fixture ${T}\nplugin ${plugin}\nload ${load()} nproc ${execFileSync("nproc").toString().trim()}`);
squeal("--version");
hook("session-start", { hook_event_name: "SessionStart", source: "startup" });
await sleep(3000);
squeal("run", "--all", "--wait", "120000");
squeal("run", "--slow", "--wait", "120000");
squeal("status");
slowState("all current");

console.log("\n=== A: squeal stop, PostToolBatch, no edit (control)");
squeal("stop");
batch("squeal stop");
await sleep(2000);
daemons();

console.log("\n=== B: squeal stop held; Bash edit of e2e/a.e2e.ts; PostToolBatch");
bashEdit("e2e/a.e2e.ts");
batch("sed -i … e2e/a.e2e.ts");
for (const ms of [500, 1500, 3000]) { await sleep(ms); slowState(`B +${ms}ms after hook`); }
daemons();
batch("true");
await sleep(5000);
slowState("B settled");
squeal("status");

console.log("\n=== C: second Bash edit while the restarted daemon lives");
bashEdit("e2e/a.e2e.ts");
await sleep(400);
batch("sed -i … e2e/a.e2e.ts");
for (const ms of [300, 1000, 2500]) { await sleep(ms); slowState(`C +${ms}ms`); }
await sleep(6000);
batch("true");
slowState("C settled");

console.log("\n=== D: squeal hold -- sh -c '<edit>; sleep 8' (gh-49 mechanism)");
const held = spawn("node", [cli, "hold", "--max", "2m", "--", "sh", "-c", "sed -i '$a // probe edit hold' e2e/b.e2e.ts; sleep 8"], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
let heldOut = "";
held.stdout.on("data", (d) => (heldOut += d));
held.stderr.on("data", (d) => (heldOut += d));
const heldExit = new Promise((r) => held.on("exit", (c) => r(c)));
await sleep(3000);
batch("squeal hold -- sh -c …");
slowState("D mid-hold +3s");
await sleep(3000);
slowState("D mid-hold +6s");
console.log(`${stamp()} hold exited ${await heldExit}\n${heldOut.trim().replace(/^/gm, "    ")}`);
for (const ms of [500, 5000]) { await sleep(ms); slowState(`D after hold +${ms}ms`); }
batch("true");

console.log("\n=== E: background squeal hold -- sleep 60; edits from separate Bash calls; squeal start ends it");
const bg = spawn("node", [cli, "hold", "--max", "2m", "--", "sleep", "60"], { cwd: repo, env, stdio: "ignore" });
const bgExit = new Promise((r) => bg.on("exit", (c, sig) => r(`${c} ${sig ?? ""}`.trim())));
await sleep(2000);
for (let i = 0; i < 2; i++) {
  bashEdit("e2e/c.e2e.ts");
  await sleep(400);
  batch("sed -i … e2e/c.e2e.ts");
  await sleep(4000);
  slowState(`E held, edit ${i + 1} +4s`);
}
squeal("start");
for (const ms of [1000, 5000]) { await sleep(ms); slowState(`E after squeal start +${ms}ms`); }
batch("true");
bg.kill("SIGTERM");
console.log(`${stamp()} background hold (killed after squeal start) exited ${await bgExit}`);

// Cleanup: end the session, stop the daemon, kill only this fixture's processes.
hook("session-end", { hook_event_name: "SessionEnd", reason: "other" });
squeal("stop");
spawnSync("pkill", ["-f", `squeal.mjs daemon ${repo}`]);
await sleep(500);
daemons();
rmSync(T, { recursive: true, force: true });
console.log(`${stamp()} removed ${T}; load ${load()}`);
