import type { EpochMs } from "../types/index.js";

/*
 * Spec 014 D7 and D8 (tasks 014-10, 014-11): the words of `squeal ps`, in
 * its text and in its flags' reasons and commands. A value `ps` could not
 * read prints as `?` in a column and as `unknown` in a sentence, never as
 * 0. Sizes are binary: `2.2G` in a column, `2.2 GiB` in a sentence. A
 * duration is `3h` in a column and `3h 05m` in a sentence. Each path in an
 * end command goes through `shellQuote`, the one quoting rule.
 */

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

/** An unknown value in a column. */
export const UNKNOWN = "?";

export const NO_BOOT = "the boot time cannot be read, so no process has an age";

const SAFE_WORD = /^[\w@%+=:,./-]+$/;

/** A word the shell reads back as `word`: bare when it is safe, else single-quoted. */
export function shellQuote(word: string): string {
  return SAFE_WORD.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/** An epoch time as `YYYY-MM-DD HH:MM UTC`. */
export function dateOf(ms: EpochMs): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function count(n: number, one: string, many = `${one}s`): string {
  return `${thousands(n)} ${n === 1 ? one : many}`;
}

/** A whole number with a comma every three digits, as `en-US` writes it, without `Intl`'s start-up (014-23). */
export function thousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+$)/g, ",");
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

/** The time from `since` to `at` in a column; `?` when `since` is unknown. */
export function age(since: number | null, at: number): string {
  return since === null ? UNKNOWN : columnDuration(at - since);
}

/** A duration in a sentence, a flag's reason: `45 s`, `12m`, `3h 05m`. */
export function sentenceDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 120) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 120) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** A duration in a column: `45s`, `39m`, `5h`, `3d`, the largest unit up to 100 minutes and 48 hours. */
export function columnDuration(ms: number): string {
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
