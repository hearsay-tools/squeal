// Stand-in hook: spawns the daemon as ensure.ts does, then exits.
import { spawn } from "node:child_process";
const [daemon, out, cwd] = process.argv.slice(2);
const child = spawn(process.execPath, [daemon, out], { cwd, detached: true, stdio: "ignore" });
child.on("error", () => {});
child.unref();
