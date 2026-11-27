// Machine speed around each cell (row 025-27): a single-thread SHA-256
// calibration and the CPU time the hypervisor took (steal, from /proc/stat).
// A cell run on a slower or busier machine shows it here, so a change between
// versions that only follows the machine is not read as Squeal's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** SHA-256 over 1 MiB, repeated for `ms`: MiB hashed per second on one thread. */
export function calibrate(ms = 3000) {
  const buf = Buffer.alloc(1 << 20, 7);
  const end = performance.now() + ms;
  let n = 0;
  while (performance.now() < end) {
    createHash("sha256").update(buf).digest();
    n++;
  }
  return (n * 1000) / ms;
}

/** Steal and total jiffies of the machine, from the `cpu` line of /proc/stat. */
export function stealJiffies(text = readFileSync("/proc/stat", "utf8")) {
  const f = text.split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
  // user nice system idle iowait irq softirq steal guest guest_nice; guest time is already in user.
  const counted = f.slice(0, 8);
  return { steal: f[7] ?? 0, total: counted.reduce((a, b) => a + b, 0) };
}

/** Steal as a percent of all CPU time between two `stealJiffies` readings. */
export function stealPct(before, after) {
  const total = after.total - before.total;
  return total > 0 ? (100 * (after.steal - before.steal)) / total : null;
}

/**
 * The record a cell keeps in cell.json as `machine`: SHA-256 MiB/s before and
 * after the cell, and steal over the cell, in percent.
 */
export function machineRecord(before, after) {
  return {
    sha256Before: before.sha256,
    sha256After: after.sha256,
    stealPct: stealPct(before.jiffies, after.jiffies),
  };
}

/** One reading: calibration first, then the jiffies, so steal covers only the cell. */
export function machineBefore(ms) {
  return { sha256: calibrate(ms), jiffies: stealJiffies() };
}

/** One reading after the cell: the jiffies first, then the calibration. */
export function machineAfter(ms) {
  const jiffies = stealJiffies();
  return { sha256: calibrate(ms), jiffies };
}

/** `SHA-256 1931→1902 MiB/s, steal 0.4%`, or null for a cell from before row 025-27. */
export function machineText(m) {
  if (!m) return null;
  const s = (x) => (typeof x === "number" ? x.toFixed(0) : "?");
  const steal = typeof m.stealPct === "number" ? `${m.stealPct.toFixed(1)}%` : "n/a";
  return `SHA-256 ${s(m.sha256Before)}→${s(m.sha256After)} MiB/s, steal ${steal}`;
}
