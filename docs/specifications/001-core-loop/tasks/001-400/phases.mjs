// 001-400 probe. Usage: taskset -c 0-1 node phases.mjs <heap MB>, beside 2 busy loops on the same CPUs.
// Records a Node child's exit phases as the daemon's scan would see them, polled tightly.
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { setPriority } from "node:os";
const mb = Number(process.argv[2] ?? 0);
try { rmSync("/tmp/sq400-orphan"); } catch {}
const code = `const b=Buffer.alloc(${mb}*1048576,1);const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'});c.unref();require('fs').writeFileSync('/tmp/sq400-orphan',String(c.pid));setTimeout(()=>process.exit(0),300)`;
const child = spawn(process.execPath, ["-e", code], { stdio: "ignore", env: { ...process.env, MARK: "x" } });
setPriority(child.pid, 10);
const t0 = performance.now();
const read = (p) => { try { return readFileSync(p, "latin1"); } catch (e) { return e.code; } };
let orphan, last = "", log = [];
for (;;) {
  const now = performance.now() - t0;
  if (orphan === undefined) { const o = read("/tmp/sq400-orphan"); if (/^\d+$/.test(o)) orphan = Number(o); else continue; }
  const stat = read(`/proc/${child.pid}/stat`);
  if (!stat.includes(")")) { log.push(`${now.toFixed(0)} gone`); break; }
  const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const exiting = (Number(f[6]) & 4) !== 0;
  const env = read(`/proc/${child.pid}/environ`);
  const envs = env.includes("MARK=x") ? "marked" : env === "" ? "empty" : env;
  let tasks = "?"; try { tasks = readdirSync(`/proc/${child.pid}/task`).length; } catch {}
  const os = read(`/proc/${orphan}/stat`);
  const ppid = Number(os.slice(os.lastIndexOf(")") + 2).split(" ")[1]);
  const s = `${f[0]}${exiting ? "+EXITING" : ""} env=${envs} tasks=${tasks} orphanParent=${ppid === child.pid ? "fork" : "reaper"}`;
  if (s !== last) { log.push(`${now.toFixed(0)} ${s}`); last = s; }
  if (ppid !== child.pid && f[0] === "Z") break;
}
try { process.kill(orphan, "SIGKILL"); } catch {}
console.log(`mb ${mb}: ${log.slice(-6).join(" | ")}`);
