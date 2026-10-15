// How long a Node process's children still name it as parent after its leader shows Z (or vanishes).
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
const nice = Number(process.argv[2] ?? 0);
const trials = Number(process.argv[3] ?? 20);
const hogs = Number(process.argv[4] ?? 2);
const stat = (pid) => {
  try {
    const t = readFileSync(`/proc/${pid}/stat`, "latin1");
    const f = t.slice(t.lastIndexOf(")") + 2).split(" ");
    return { state: f[0], ppid: Number(f[1]) };
  } catch { return null; }
};
const cmd = (pid) => { try { return readFileSync(`/proc/${pid}/cmdline`, "latin1"); } catch { return "<gone>"; } };
const hogProcs = Array.from({ length: hogs }, () => spawn(process.execPath, ["-e", "for(;;){}"], { stdio: "ignore" }));
const forkSrc = `
require("os").setPriority(${nice});
const c = require("child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { detached: true, stdio: "ignore" });
c.unref(); process.stdout.write(String(c.pid) + "\\n");
setTimeout(() => process.exit(0), 300);`;
const windows = []; let emptyName = 0;
for (let i = 0; i < trials; i++) {
  const fork = spawn(process.execPath, ["-e", forkSrc], { stdio: ["ignore", "pipe", "ignore"] });
  const child = Number(await new Promise((done) => fork.stdout.once("data", (d) => done(String(d).trim()))));
  let tGone = null, tMoved = null, sawEmpty = false;
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    const f = stat(fork.pid), c = stat(child);
    const now = performance.now();
    if (tGone === null && (f === null || f.state === "Z")) tGone = now;
    if (tGone !== null && c && c.ppid === fork.pid && cmd(fork.pid) === "") sawEmpty = true;
    if (c && c.ppid !== fork.pid) { tMoved = now; break; }
  }
  windows.push(tGone === null ? 0 : tMoved - tGone);
  if (sawEmpty) emptyName++;
  try { process.kill(child, "SIGKILL"); } catch {}
  await new Promise((done) => (fork.exitCode !== null ? done() : fork.once("exit", done)));
}
for (const h of hogProcs) h.kill("SIGKILL");
windows.sort((a, b) => a - b);
const q = (p) => windows[Math.min(windows.length - 1, Math.floor(p * windows.length))].toFixed(2);
console.log(`nice ${nice} hogs ${hogs}: window ms p50 ${q(0.5)} p90 ${q(0.9)} max ${q(1)}; parent named "" while still the ppid in ${emptyName}/${trials}`);
