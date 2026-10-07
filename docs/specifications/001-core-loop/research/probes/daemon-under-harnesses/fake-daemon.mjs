// Stand-in daemon: records its own ids, then idles until killed.
import { readFileSync, writeFileSync } from "node:fs";
const stat = readFileSync("/proc/self/stat", "utf8");
const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
writeFileSync(process.argv[2], JSON.stringify({
  pid: process.pid, ppid: Number(f[1]), pgid: Number(f[2]), sid: Number(f[3]),
  cwd: process.cwd(), tmpdir: process.env.TMPDIR ?? null,
  cgroup: readFileSync("/proc/self/cgroup", "utf8").trim(),
}));
setInterval(() => {}, 1 << 30);
