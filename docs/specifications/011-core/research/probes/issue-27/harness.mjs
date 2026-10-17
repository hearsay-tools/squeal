// Throwaway fake harness for hearsay-tools/squeal#27. Not product code.
// Stands in for one Claude Code process: reads {name, input} JSON lines on stdin,
// runs that hook bundle as its own child (so the hook's recorded harness process
// is this process), prints one result line, and lives until killed.
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";

const [plugin, cwd] = process.argv.slice(2);
for await (const line of createInterface({ input: process.stdin })) {
  const { name, input } = JSON.parse(line);
  const r = spawnSync("node", ["--disable-warning=ExperimentalWarning", join(plugin, "dist", `${name}.mjs`)], {
    cwd, env: process.env, input: JSON.stringify({ cwd, ...input }), encoding: "utf8", timeout: 10_000,
  });
  process.stdout.write(JSON.stringify({ name, status: r.status, stdout: r.stdout.trim().slice(0, 200) }) + "\n");
}
setInterval(() => {}, 1 << 30); // stdin closed: stay alive until killed, like an idle harness
