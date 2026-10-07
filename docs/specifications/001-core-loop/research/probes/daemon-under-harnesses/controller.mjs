// Stand-in for the harness's agent process (claude): runs the hook, stays alive.
import { spawnSync } from "node:child_process";
const [hook, daemon, out, cwd] = process.argv.slice(2);
spawnSync(process.execPath, [hook, daemon, out, cwd], { stdio: "inherit" });
setInterval(() => {}, 1 << 30);
