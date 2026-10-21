/*
 * Spec 014 D8 (task 014-11): how `squeal ps` prints a value. A value `ps`
 * could not read prints as `?` in a column and as `unknown` in a sentence,
 * never as 0. Sizes are binary: `2.2G` in a column, `2.2 GiB` in a
 * sentence. Nothing here knows a flag.
 */

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

/** An unknown value in a column. */
export const UNKNOWN = "?";

/** Sums the values that are known; `null` when none is. */
export function known(values: readonly (number | null)[]): number | null {
  const read = values.filter((v): v is number => v !== null);
  return read.length === 0 ? null : read.reduce((a, b) => a + b, 0);
}

export function count(n: number, one: string, many = `${one}s`): string {
  return `${thousands(n)} ${n === 1 ? one : many}`;
}

export function thousands(n: number): string {
  return n.toLocaleString("en-US");
}

/** A percent in a sentence: whole above 10, one decimal below. */
export function share(value: number): string {
  return value >= 10 ? `${Math.round(value)}%` : `${value.toFixed(1)}%`;
}

/** A percent in a column, whole; `?` when unknown. */
export function percent(value: number | null): string {
  return value === null ? UNKNOWN : `${Math.round(value)}%`;
}

/** Percent of one CPU as CPUs, one decimal. */
export function cpus(value: number): string {
  return (value / 100).toFixed(1);
}

/** Bytes: `2.2G`, `310M`, `512K` in a column; `2.2 GiB`, `310 MiB` in a sentence. */
export function bytes(n: number | null, column = false): string {
  if (n === null) return column ? UNKNOWN : "unknown";
  if (n === 0) return "0";
  const [value, unit] =
    n >= GIB
      ? [(n / GIB).toFixed(1), "G"]
      : n >= MIB
        ? [String(Math.round(n / MIB)), "M"]
        : [String(Math.round(n / KIB)), "K"];
  return column ? `${value}${unit}` : `${value} ${unit}iB`;
}

/** `32.7 of 47.0 GiB`. */
export function ofGib(part: number, whole: number): string {
  return `${(part / GIB).toFixed(1)} of ${(whole / GIB).toFixed(1)} GiB`;
}

/** The time from `since` to `at`, as `duration` gives it; `?` when `since` is unknown. */
export function age(since: number | null, at: number): string {
  return since === null ? UNKNOWN : duration(at - since);
}

/** `45s`, `39m`, `5h`, `3d`: the largest unit up to 100 minutes and 48 hours. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 100 * 60) return `${Math.floor(s / 60)}m`;
  if (s < 48 * 3600) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/** Cumulative CPU time: `11m42s`, `2h05m`. */
export function cpuTime(ms: number | null): string {
  if (ms === null) return UNKNOWN;
  const s = Math.floor(ms / 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  if (s < 3600) return `${Math.floor(s / 60)}m${two(s % 60)}s`;
  return `${Math.floor(s / 3600)}h${two(Math.floor(s / 60) % 60)}m`;
}
