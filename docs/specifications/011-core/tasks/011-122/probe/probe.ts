import { appendFileSync } from "node:fs";
import { isMainThread, threadId } from "node:worker_threads";

/** Task 011-122 probe: one line per event, to `SQUEAL_PROBE_LOG`. `instrument.mjs` copies it into a copy of the tree, never into the tree. */
const file = process.env.SQUEAL_PROBE_LOG ?? "";
const probing = file !== "";

export function probe(event: string, detail?: Record<string, unknown>): void {
  if (!probing) return;
  const extra = detail === undefined ? "" : ` ${JSON.stringify(detail)}`;
  try {
    appendFileSync(file, `${Date.now()} ${performance.now().toFixed(1)} t${threadId} ${event}${extra}\n`);
  } catch {}
}

export function since(t0: number, t1 = performance.now()): number {
  return Math.round((t1 - t0) * 10) / 10;
}

/** The calling frames in `dist`, outside the store connection and this file. */
export function where(depth = 4): string {
  if (!probing) return "";
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 30;
  const stack = new Error().stack?.split("\n").slice(1) ?? [];
  Error.stackTraceLimit = limit;
  const frames: string[] = [];
  for (const line of stack) {
    const m = /at (?:(.+?) \()?.*\/dist\/(.+?)\.js:(\d+):\d+\)?$/.exec(line.trim());
    if (m === null) continue;
    const path = m[2] ?? "";
    if (path.includes("store/connection") || path.endsWith("core/probe")) continue;
    frames.push(`${(m[1] ?? "?").replace(/^async /, "")}@${path.replace(/^core\//, "")}:${m[3]}`);
    if (frames.length >= depth) break;
  }
  return frames.join(" < ");
}

if (probing && isMainThread) {
  // Event loop stalls: a 10 ms interval; a gap past 40 ms is a stall, logged with its start.
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const gap = now - last;
    if (gap > 40) probe("stall", { ms: Math.round(gap), fromMs: Date.now() - Math.round(gap) });
    last = now;
  }, 10);
  timer.unref();
}
