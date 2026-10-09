// Runs one daemon in the foreground of this process, as `squeal start` would spawn it,
// keeping its stdout and stderr and printing how it exited (code or signal) with UTC times.
// Usage: node daemon-fg.mjs <squeal.mjs> <root>
import { spawn } from "node:child_process";
const [cli, root] = process.argv.slice(2);
const t = () => new Date().toISOString().slice(11, 23);
const child = spawn(process.execPath, [cli, "daemon", root], { stdio: ["ignore", "inherit", "inherit"], detached: true });
console.log(`${t()} daemon pid ${child.pid} for ${root}`);
child.on("exit", (code, signal) => { console.log(`${t()} daemon exit code=${code} signal=${signal}`); process.exit(0); });
