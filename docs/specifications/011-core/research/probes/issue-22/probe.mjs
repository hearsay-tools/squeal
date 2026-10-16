// Throwaway probe for hearsay-tools/squeal#22. Not product code.
// Usage: node probe.mjs <plugin-root>   (e.g. ~/.claude/plugins/cache/hearsay/squeal/0.1.199)
// Builds a scratch repo, HOME and XDG_RUNTIME_DIR under a fresh /tmp dir, plays
// SessionStart -> Stop -> (squeal stop -> Stop) x3 with the plugin's own hook
// bundles, and prints what each step said and whether a daemon process lives.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const plugin = process.argv[2];
const cli = join(plugin, "dist/cli/squeal.mjs");
const T = mkdtempSync("/tmp/squeal-issue22-");
const repo = join(T, "repo");
const env = { ...process.env, HOME: join(T, "home"), XDG_RUNTIME_DIR: join(T, "run"), CLAUDE_PLUGIN_ROOT: plugin };
delete env.CLAUDE_CODE_SESSION_ATTENDED; // -p-like: no idle waiter
for (const d of [repo, env.HOME, env.XDG_RUNTIME_DIR]) mkdirSync(d, { recursive: true });
chmodSync(env.XDG_RUNTIME_DIR, 0o700);
const git = (...a) => execFileSync("git", a, { cwd: repo, env, stdio: "pipe" });
git("init", "-q", "-b", "main");
writeFileSync(join(repo, "squeal.config.json"), "{}\n");
writeFileSync(join(repo, "package.json"), '{"name":"p","type":"module","scripts":{"test":"vitest"}}\n');
writeFileSync(join(repo, "vitest.config.ts"), "export default {};\n");
writeFileSync(join(repo, "a.test.ts"), "import { test } from 'vitest'; test('a', () => {});\n");
git("add", "-A");
git("-c", "user.name=p", "-c", "user.email=p@p", "commit", "-qm", "fixture");

const session = "issue22-probe";
const t0 = Date.now();
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
function hook(name, input) {
  const r = spawnSync("node", ["--disable-warning=ExperimentalWarning", join(plugin, "dist", `${name}.mjs`)], {
    cwd: repo, env, input: JSON.stringify({ session_id: session, cwd: repo, ...input }), encoding: "utf8", timeout: 10_000,
  });
  console.log(`${stamp()} hook ${name} exit=${r.status} stdout=${JSON.stringify(r.stdout.trim())}`);
}
function squeal(...a) {
  const r = spawnSync("node", [cli, ...a], { cwd: repo, env, encoding: "utf8", timeout: 120_000 });
  console.log(`${stamp()} $ squeal ${a.join(" ")} -> exit=${r.status}\n${(r.stdout + r.stderr).trim().replace(/^/gm, "    ")}`);
}
function daemons() {
  const r = spawnSync("pgrep", ["-af", `squeal.mjs daemon ${repo}`], { encoding: "utf8" });
  const lines = r.stdout.trim().split("\n").filter((l) => l && !l.includes("pgrep"));
  console.log(`${stamp()} daemon processes for fixture: ${lines.length}${lines.length ? "\n    " + lines.join("\n    ") : ""}`);
  return lines.length;
}

console.log(`fixture ${T}\nplugin ${plugin}\nload ${execFileSync("cat", ["/proc/loadavg"]).toString().trim()} nproc ${execFileSync("nproc").toString().trim()}`);
hook("session-start", { hook_event_name: "SessionStart", source: "startup" });
await sleep(3000);
squeal("status");
daemons();
hook("stop", { hook_event_name: "Stop", stop_hook_active: false });
// Control: squeal stop, then no hook for 15 s; does anything bring the daemon back?
squeal("stop");
await sleep(15_000);
daemons();
squeal("status");
// Variant: the PostToolBatch of the Bash call that ran \`squeal stop\`, before any Stop.
console.log("--- PostToolBatch after squeal stop");
squeal("stop");
daemons();
hook("post-tool-batch", { hook_event_name: "PostToolBatch", tool_calls: [{ tool_name: "Bash", tool_input: { command: "squeal stop" } }] });
await sleep(3000);
if (daemons() > 0) squeal("stop");
daemons();
for (let i = 1; i <= 3; i++) {
  console.log(`--- cycle ${i}`);
  hook("stop", { hook_event_name: "Stop", stop_hook_active: false });
  await sleep(3000);
  const n = daemons();
  squeal("status");
  if (n > 0) squeal("stop");
  daemons();
}
// Cleanup: end the session, stop whatever is left, kill only this fixture's processes.
hook("session-end", { hook_event_name: "SessionEnd", reason: "other" });
squeal("stop");
spawnSync("pkill", ["-f", `squeal.mjs daemon ${repo}`]);
await sleep(500);
daemons();
rmSync(T, { recursive: true, force: true });
console.log(`${stamp()} removed ${T}; load ${execFileSync("cat", ["/proc/loadavg"]).toString().trim()}`);
