// Throwaway: round trips of one line over one ssh session (a remote cat), as a kept connection sees them.
import { spawn } from "node:child_process";
const p = spawn(process.argv[2], ["boat-trial", "cat"], { stdio: ["pipe", "pipe", "inherit"] });
const times = []; let t = 0; let n = 0;
p.stdout.setEncoding("utf8").on("data", () => { times.push(Number(process.hrtime.bigint() - t) / 1e6); if (++n < 21) send(); else { p.stdin.end(); times.shift(); times.sort((a, b) => a - b); console.log("in-session echo ms: min", times[0].toFixed(1), "median", times[10].toFixed(1), "max", times.at(-1).toFixed(1)); } });
function send() { t = process.hrtime.bigint(); p.stdin.write("x\n"); }
setTimeout(send, 3000);
