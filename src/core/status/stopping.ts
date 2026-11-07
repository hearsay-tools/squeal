import { HANDOFF_BOUND_MS } from "../presence/stored.js";
import type { DaemonShort, DaemonStopping } from "../types/status.js";

/**
 * What every text says of a daemon that ended its handoff short (row
 * 011-140): its version validates, and `squeal start` of the claim's replaces it.
 */
export function shortText(short: DaemonShort, command: string): string {
  const at = new Date(short.since).toISOString();
  return (
    `the handoff to ${short.claimed} ended at ${at} with a ${short.version} daemon, which validates; ` +
    `no hook asks it to step down again, and \`${command} start\` of ${short.claimed} replaces it`
  );
}

/** A handoff's bound in seconds, as the texts name it. */
const BOUND_S = Math.round(HANDOFF_BOUND_MS / 1_000);

/**
 * What every text says of a stopping daemon (C9 as amended 2026-10-20):
 * `handing over from 0.1.223 to 0.1.224 since <time>` with a claim,
 * `stopping since <time>` without, `age` after the time when given, and
 * `, past its 130 s bound` once overdue.
 */
export function stoppingState(stopping: DaemonStopping, age?: string): string {
  const what =
    stopping.to === undefined ? "stopping" : `handing over from ${stopping.from} to ${stopping.to}`;
  const at = new Date(stopping.since).toISOString();
  const past = stopping.overdue ? `, past its ${BOUND_S} s bound` : "";
  return `${what} since ${at}${age === undefined ? "" : ` (${age})`}${past}`;
}

/** What follows it: what it waits for, or past its bound, that `squeal start` finishes it. */
export function stoppingNext(stopping: DaemonStopping, command: string): string {
  if (stopping.overdue) return `\`${command} start\` finishes it`;
  return stopping.to === undefined
    ? "nothing validates until its lock frees"
    : `${stopping.to} serves once the old daemon's lock frees`;
}

/** `stoppingState`, then `stoppingNext`. */
export function stoppingText(stopping: DaemonStopping, command: string, age?: string): string {
  return `${stoppingState(stopping, age)}; ${stoppingNext(stopping, command)}`;
}
