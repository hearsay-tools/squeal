// Start-to-ready time and daemon RSS for one worktree. Read only on the store.
// Usage: node ready.mjs <squeal.mjs> <worktree root> [seconds to keep sampling RSS]
// Spawns `squeal start <root>` (which spawns the daemon), then polls every 100 ms:
// the store's `daemon-bootstrapped:<id>` meta row (written once the start scan and the
// runner graphs are done, `daemon.ts`), the first `test_file_keys` row, and the
// daemon's VmRSS from /proc. Prints one line per milestone and the RSS peak.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [cli, root, keepS = "120"] = process.argv.slice(2);
const t0 = Date.now();
const since = () => `+${((Date.now() - t0) / 1000).toFixed(2)}s`;
const start = spawnSync(process.execPath, [cli, "start", root], { encoding: "utf8" });
console.log(`${since()} squeal start exit ${start.status}: ${start.stdout.split("\n")[0]}`);
const status = JSON.parse(execFileSync(process.execPath, [cli, "status", "--json"], { cwd: root, encoding: "utf8" }));
const id = status.worktreeId;
const common = execFileSync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
const db = new DatabaseSync(join(common, "squeal/store.sqlite"), { readOnly: true });
const pidOf = () => {
  const r = spawnSync("pgrep", ["-f", `squeal.mjs daemon ${root}$`], { encoding: "utf8" });
  return r.stdout.trim().split("\n").filter(Boolean).map(Number)[0];
};
const rss = (pid) => {
  try {
    const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    return m ? Number(m[1]) / 1024 : undefined;
  } catch { return undefined; }
};
let ready = false, keyed = false, peak = 0, pid;
const end = t0 + Number(keepS) * 1000;
while (Date.now() < end) {
  pid ??= pidOf();
  const mb = pid ? rss(pid) : undefined;
  if (mb !== undefined) peak = Math.max(peak, mb);
  if (!ready && db.prepare("select value from meta where key = ?").get(`daemon-bootstrapped:${id}`)) {
    ready = true;
    console.log(`${since()} ready (daemon-bootstrapped written), pid ${pid}, RSS ${mb?.toFixed(1)} MiB`);
  }
  if (!keyed && db.prepare("select 1 from test_file_keys where worktree_id = ? limit 1").get(id)) {
    keyed = true;
    console.log(`${since()} first test_file_keys row, RSS ${mb?.toFixed(1)} MiB`);
  }
  await new Promise((r) => setTimeout(r, 100));
}
console.log(`${since()} worktree ${id}, daemon pid ${pid}, RSS now ${pid ? rss(pid)?.toFixed(1) : "-"} MiB, peak ${peak.toFixed(1)} MiB`);
