// workers.mjs <out.tsv> <seconds> <cgroup dir> [<cgroup dir>...]: every 1 s
// one line per cgroup: epoch ms, the cgroup's index, how many Vitest fork
// workers live in it (cmdline holds `vitest/dist/workers/forks.js`; with
// squawk's isolate default each test file is one such process, Vitest 4.1.10
// `ForksPoolWorker`), how many node:test processes (`--test`), and all
// processes. Reads /sys and /proc only. A live fork is a worker slot in use,
// so a tier's grant minus this count is its idle slots.
import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
const [out, secs, ...cgs] = process.argv.slice(2);
writeFileSync(out, "t_ms\tcg\tforks\tnode_test\tprocs\n");
const end = Date.now() + Number(secs) * 1000;
const tick = () => {
  const now = Date.now();
  let lines = "";
  cgs.forEach((cg, i) => {
    let pids = [];
    try { pids = readFileSync(`${cg}/cgroup.procs`, "utf8").trim().split("\n").filter(Boolean); } catch { return; }
    let forks = 0, nodeTest = 0;
    for (const pid of pids) {
      let cmd = "";
      try { cmd = readFileSync(`/proc/${pid}/cmdline`, "latin1"); } catch { continue; }
      if (cmd.includes("vitest/dist/workers/forks.js")) forks++;
      else if (cmd.includes("\0--test\0")) nodeTest++;
    }
    lines += `${now}\t${i}\t${forks}\t${nodeTest}\t${pids.length}\n`;
  });
  appendFileSync(out, lines);
  if (Date.now() < end) setTimeout(tick, 1000 - (Date.now() - now));
};
tick();
