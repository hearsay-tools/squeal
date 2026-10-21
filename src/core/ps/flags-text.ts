import type { EpochMs } from "../types/index.js";

/*
 * Spec 014 D7 (task 014-10): the text every flag module shares. Each path
 * in an end command goes through `shellQuote`, the one quoting rule.
 */

const SAFE_WORD = /^[\w@%+=:,./-]+$/;

export const NO_BOOT = "the boot time cannot be read, so no process has an age";

/** A word the shell reads back as `word`: bare when it is safe, else single-quoted. */
export function shellQuote(word: string): string {
  return SAFE_WORD.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/** An epoch time as `YYYY-MM-DD HH:MM UTC`. */
export function dateOf(ms: EpochMs): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** `45 s`, `12m`, `3h 05m`. */
export function duration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 120) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 120) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
