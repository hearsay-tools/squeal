// Throwaway (row 021-17). Read only. Every second for N seconds, finds every
// live Squeal daemon from /proc/<pid>/cmdline (process title "squeal <project>
// daemon @<worktree>") and prints its main thread's state and wchan, as
// ../daemon-model/wchan-sample.sh did for a fixed pid list (daemons here come
// and go within minutes). One process, no forks. Opens no socket, signals nothing.
// Output: <epoch s, 3 decimals since window 2> <pid> <project> <worktree> <state> <wchan> <load1>
// Usage: node wchan-watch.mjs SECONDS
import { readFileSync, readdirSync } from "node:fs";
const end = Date.now() + Number(process.argv[2]) * 1000;
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
let known = new Map(); let scanAt = 0;
const tick = () => {
  const now = Date.now();
  if (now - scanAt > 5000) { // rescan for daemons every 5 s
    scanAt = now; const next = new Map();
    for (const d of readdirSync("/proc")) {
      if (!/^\d+$/.test(d)) continue;
      const c = read(`/proc/${d}/cmdline`); if (!c || !c.startsWith("squeal ")) continue;
      const m = /^squeal (\S+) daemon @(\S+)/.exec(c.split("\0").join(" ")); if (m) next.set(d, [m[1], m[2]]);
    }
    known = next;
  }
  const load = (read("/proc/loadavg") ?? "?").split(" ")[0]; const lines = [];
  for (const [pid, [project, wt]] of known) {
    const st = read(`/proc/${pid}/task/${pid}/stat`); const w = read(`/proc/${pid}/task/${pid}/wchan`);
    if (st === null || w === null) continue;
    const at = Date.now(); lines.push(`${(at / 1000).toFixed(3)} ${pid} ${project} ${wt} ${st.slice(st.lastIndexOf(")") + 2).split(" ")[0]} ${w || "0"} ${load}`);
  }
  if (lines.length) process.stdout.write(lines.join("\n") + "\n");
  if (now < end) setTimeout(tick, 1000 - (Date.now() % 1000));
};
tick();
