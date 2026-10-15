// 006-53: the host load a cell's processes read. Preloaded through NODE_OPTIONS (`--import`) in
// the a9 to a11 cells only: `os.loadavg` answers the load per CPU written in the file
// EVAL_LOAD_PER_CPU_FILE names, times the CPU count, read at each call so the runner can change
// it under a running daemon. No readable number there: the real load.
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";

const real = os.loadavg;
os.loadavg = () => {
  const file = process.env.EVAL_LOAD_PER_CPU_FILE;
  try {
    const perCpu = Number.parseFloat(readFileSync(file, "utf8"));
    if (Number.isFinite(perCpu)) return Array(3).fill(perCpu * os.availableParallelism());
  } catch {
    // The real load below.
  }
  return real();
};
syncBuiltinESMExports();
