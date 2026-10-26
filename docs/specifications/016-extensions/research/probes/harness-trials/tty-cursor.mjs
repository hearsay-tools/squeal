// Throwaway probe (016-35). Run as squeal-e2e in ~/ht035/repo.
// Usage: node tty-cursor.mjs <name> <prompt> [cursor-agent flags...]
// Runs interactive cursor-agent under `script` (a pseudo-terminal), with the
// prompt as its first message. It watches the hook log for a stop with
// loop_count >= 1 (the follow-up turn has ended) or for $HT_TTY_MS (default
// 150 s), waits 5 s more, then sends Ctrl+C twice to quit. The screen goes to
// ~/ht035/logs/<name>.screen.txt; the hook log is moved to <name>.hooks.jsonl.
// Under cursor-config.sh squeal it also quits once cursor-squeal.jsonl holds a
// stop that Squeal let end (no follow-up); that log moves to <name>.squeal.jsonl.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";

const [name, prompt, ...flags] = process.argv.slice(2);
const logs = `${process.env.HOME}/ht035/logs`;
const hooks = `${logs}/cursor-hooks.jsonl`;
const squeal = `${logs}/cursor-squeal.jsonl`;
// A fresh start: no hook logs and no once-flags of an earlier run.
for (const f of readdirSync(logs)) if (f === "cursor-hooks.jsonl" || f === "cursor-squeal.jsonl" || f.startsWith("cursor-once-")) rmSync(`${logs}/${f}`);
const read = (path) => (existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
const command = ["cursor-agent", "--trust", "--force", ...flags, prompt].map(quote).join(" ");
const child = spawn("script", ["-qfec", command, `${logs}/${name}.screen.txt`], { stdio: ["pipe", "ignore", "ignore"] });
const started = Date.now();
let quitting = false;
const quit = () => {
  if (quitting) return;
  quitting = true;
  setTimeout(() => child.stdin.write("\x03"), 5_000);
  setTimeout(() => child.stdin.write("\x03"), 6_000);
  setTimeout(() => child.kill("SIGTERM"), 20_000);
};
const timer = setInterval(() => {
  if (read(hooks).some((l) => l.event === "stop" && (l.loop_count ?? 0) >= 1)) quit();
  if (read(squeal).some((l) => l.cursorEvent === "stop" && l.out === null)) quit();
  if (Date.now() - started > Number(process.env.HT_TTY_MS ?? 150_000)) quit();
}, 1_000);
child.on("exit", (code) => {
  clearInterval(timer);
  if (existsSync(hooks)) renameSync(hooks, `${logs}/${name}.hooks.jsonl`);
  if (existsSync(squeal)) renameSync(squeal, `${logs}/${name}.squeal.jsonl`);
  console.log(`script exit ${code} after ${Math.round((Date.now() - started) / 1000)} s`);
  process.exit(0);
});
