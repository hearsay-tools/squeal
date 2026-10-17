// Throwaway probe for hearsay-tools/squeal#27. Not product code.
// Usage: node probe.mjs <plugin-root>   (e.g. ~/.claude/plugins/cache/hearsay/squeal/0.1.199)
// Builds a scratch main repo plus one linked worktree (as cezar's .ai/cezar/worktrees/<runId>),
// with its own HOME and XDG_RUNTIME_DIR under a fresh /tmp dir, and plays four cases with the
// plugin's own hook bundles, each session hosted by a fake harness process (harness.mjs):
//   A  SessionStart, turn Stop, harness stays alive, no SessionEnd   (a settled-but-open session)
//   B  SessionStart, turn Stop, harness killed, no SessionEnd        (a harness that dies without the hook)
//   C  SessionStart, turn Stop, SessionEnd, harness then exits       (a clean session end)
//   D  two sessions on the root; first SessionEnd, then the second   (shared root, then last session)
// After each step it prints whether a daemon process naming the worktree lives.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";

const plugin = process.argv[2];
const here = dirname(fileURLToPath(import.meta.url));
const cli = join(plugin, "dist/cli/squeal.mjs");
const T = mkdtempSync("/tmp/squeal-issue27-");
const repo = join(T, "repo");
const wt = join(repo, ".ai/cezar/worktrees/run-1");
const env = { ...process.env, HOME: join(T, "home"), XDG_RUNTIME_DIR: join(T, "run"), CLAUDE_PLUGIN_ROOT: plugin };
delete env.CLAUDE_CODE_SESSION_ATTENDED; // headless-like: no idle waiter
delete env.CLAUDE_PROJECT_DIR;
for (const d of [repo, env.HOME, env.XDG_RUNTIME_DIR]) mkdirSync(d, { recursive: true });
chmodSync(env.XDG_RUNTIME_DIR, 0o700);
const git = (...a) => execFileSync("git", a, { cwd: repo, env, stdio: "pipe" });
git("init", "-q", "-b", "main");
writeFileSync(join(repo, ".gitignore"), ".ai/\n");
writeFileSync(join(repo, "squeal.config.json"), "{}\n");
writeFileSync(join(repo, "package.json"), '{"name":"p","type":"module","scripts":{"test":"vitest"}}\n');
writeFileSync(join(repo, "vitest.config.ts"), "export default {};\n");
writeFileSync(join(repo, "a.test.ts"), "import { test } from 'vitest'; test('a', () => {});\n");
git("add", "-A");
git("-c", "user.name=p", "-c", "user.email=p@p", "commit", "-qm", "fixture");
git("worktree", "add", "-q", "-b", "run-1", wt);

const t0 = Date.now();
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log = (s) => console.log(`${stamp()} ${s}`);
function daemons() {
  const r = spawnSync("pgrep", ["-af", `squeal.mjs daemon ${wt}`], { encoding: "utf8" });
  const lines = r.stdout.trim().split("\n").filter((l) => l && !l.includes("pgrep"));
  return lines.length;
}
function startHarness(session) {
  const p = spawn("node", [join(here, "harness.mjs"), plugin, wt], { env, stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: p.stdout })[Symbol.asyncIterator]();
  const hook = async (name, input) => {
    p.stdin.write(JSON.stringify({ name, input: { session_id: session, hook_event_name: name, ...input } }) + "\n");
    const { value } = await lines.next();
    log(`[${session} pid ${p.pid}] hook ${value}`);
  };
  return { p, hook };
}
const start = (h) => h.hook("session-start", { hook_event_name: "SessionStart", source: "startup" });
const stop = (h) => h.hook("stop", { hook_event_name: "Stop", stop_hook_active: false });
const end = (h) => h.hook("session-end", { hook_event_name: "SessionEnd", reason: "other" });
const kill = async (h) => { h.p.kill("SIGKILL"); await new Promise((r) => h.p.once("exit", r)); log(`killed harness pid ${h.p.pid}`); };
/** Polls daemon presence every 500 ms for up to `ms`; prints the first change. */
async function watch(label, ms) {
  const from = daemons();
  const t = Date.now();
  while (Date.now() - t < ms) {
    await sleep(500);
    const n = daemons();
    if (n !== from) { log(`${label}: daemon ${from} -> ${n} after ${((Date.now() - t) / 1000).toFixed(1)} s`); return n; }
  }
  log(`${label}: daemon stays ${from} for ${ms / 1000} s`);
  return from;
}
function status() {
  const r = spawnSync("node", [cli, "status"], { cwd: wt, env, encoding: "utf8", timeout: 30_000 });
  log(`$ squeal status (in worktree) exit=${r.status}\n${(r.stdout + r.stderr).trim().split("\n").slice(0, 4).map((l) => "    " + l).join("\n")}`);
}
async function cleanup() {
  spawnSync("node", [cli, "stop"], { cwd: wt, env, encoding: "utf8", timeout: 30_000 });
  spawnSync("pkill", ["-f", `squeal.mjs daemon ${wt}`]);
  await sleep(500);
}

console.log(`fixture ${T}\nworktree ${wt}\nplugin ${plugin}\nload ${execFileSync("cat", ["/proc/loadavg"]).toString().trim()} nproc ${execFileSync("nproc").toString().trim()}`);

console.log("=== A: turn Stop, harness alive, no SessionEnd");
let a = startHarness("sA");
await start(a); await sleep(3000); log(`daemon processes: ${daemons()}`);
await stop(a);
await watch("A after Stop", 20_000);
status();
await kill(a);
await watch("A after harness killed", 20_000);
await cleanup();

console.log("=== B: turn Stop, harness killed, no SessionEnd");
const b = startHarness("sB");
await start(b); await sleep(3000); log(`daemon processes: ${daemons()}`);
await stop(b); await kill(b);
await watch("B after harness killed", 20_000);
await cleanup();

console.log("=== C: turn Stop, SessionEnd, harness exits");
const c = startHarness("sC");
await start(c); await sleep(3000); log(`daemon processes: ${daemons()}`);
await stop(c); await end(c); await kill(c);
await watch("C after SessionEnd", 20_000);
await cleanup();

console.log("=== D: two sessions share the root");
const d1 = startHarness("sD1"), d2 = startHarness("sD2");
await start(d1); await sleep(3000); await start(d2); log(`daemon processes: ${daemons()}`);
await stop(d1); await end(d1); await kill(d1);
await watch("D after first SessionEnd", 12_000);
await stop(d2); await end(d2); await kill(d2);
await watch("D after last SessionEnd", 20_000);
await cleanup();

log(`leftover daemons: ${daemons()}`);
git("worktree", "remove", "--force", wt);
rmSync(T, { recursive: true, force: true });
log(`removed ${T}; load ${execFileSync("cat", ["/proc/loadavg"]).toString().trim()}`);
