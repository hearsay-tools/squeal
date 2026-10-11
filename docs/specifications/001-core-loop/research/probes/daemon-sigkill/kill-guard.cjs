// Preload (NODE_OPTIONS=--require) for every Node process of a test run: a process.kill
// that would reach the caller's own process group (pid 0, or minus its own pgrp) or the
// run's leader (SQ180_LEADER, its pid or group) is logged to SQ180_LOG with its stack and
// is NOT sent, so the run survives and names the caller. Linux only. Throwaway probe.
const { appendFileSync, readFileSync } = require("node:fs");
const log = process.env.SQ180_LOG;
const leader = Number(process.env.SQ180_LEADER || NaN);
const pgrp = () => Number(readFileSync("/proc/self/stat", "utf8").split(") ")[1].split(" ")[2]);
const original = process.kill;
process.kill = function guardedKill(pid, signal) {
  const target = Number(pid);
  const hit = target === 0 ? "own group (0)" : target === -pgrp() ? "own group (-pgrp)"
    : target === leader ? "leader" : target === -leader ? "leader's group" : null;
  if (hit && signal !== 0 && log) {
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), self: process.pid, pgrp: pgrp(),
      argv: process.argv.slice(1, 3), target: pid, signal: signal ?? "SIGTERM", hit,
      stack: new Error().stack.split("\n").slice(2, 14) }) + "\n");
    return true;
  }
  return original.apply(this, arguments);
};
