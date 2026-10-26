// Throwaway probe for 016-34: preloaded (`node --import`) into every per-run
// command, so each reports its own CPU from fork to exit at microsecond
// resolution: getrusage(RUSAGE_SELF) counts node's bootstrap and every thread.
import { writeFileSync } from "node:fs";

const out = process.env.BC34_CPU_OUT;
if (out)
  process.on("exit", () => {
    const { user, system } = process.cpuUsage();
    writeFileSync(out, JSON.stringify({ cpuUs: user + system, maxRssKb: process.resourceUsage().maxRSS }));
  });
