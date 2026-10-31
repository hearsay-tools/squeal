/*
 * Row 011-288 (011 C8 as amended 2026-10-31): the plugin's verdict on a
 * bridge's held answer. A request the plugin marks with `ack` may get an
 * answer marked `held`, one JSON line, whose report commits only when the
 * plugin, having read it before its deadline, sends the bridge
 * `VERDICT_SIGNAL`. No signal by the deadline (or the hook budget) is
 * abandon. A request without `ack`, from a plugin older than this row, gets
 * its report committed before the answer, as before. Signals need no stdin
 * kept open, so an older bridge, which reads its request to stdin's end,
 * still works with this plugin. OpenCode runs on Linux only (spec 008,
 * non-goals), where the plugin already kills the bridge's process group.
 * It imports nothing: the plugin's bundle takes the name from here.
 */

/** The plugin's commit verdict. A bridge always listens for it, so a stray one never kills it. */
export const VERDICT_SIGNAL = "SIGUSR2";

/** A request's mark from a plugin that gives verdicts: when its own deadline for the call ends. */
export interface Ack {
  /** Milliseconds since the epoch. */
  readonly by: number;
}

const ignore = () => {};

/** Makes `VERDICT_SIGNAL` harmless in this process, held answer or not. Idempotent. */
export function ignoreVerdictSignal(): void {
  if (!process.listeners(VERDICT_SIGNAL).includes(ignore)) process.on(VERDICT_SIGNAL, ignore);
}

/** The `ack` of a parsed request; `null` without a valid one. */
export function ackOf(request: unknown): Ack | null {
  const ack = (request as { ack?: { by?: unknown } } | null)?.ack;
  return typeof ack?.by === "number" && Number.isFinite(ack.by) ? { by: ack.by } : null;
}

/** A verdict being waited for: `commit` resolves `true` at the signal, `false` at its bound. */
export interface VerdictWait {
  readonly commit: Promise<boolean>;
  /** Stops waiting; `commit` resolves `false`. */
  cancel(): void;
}

/** Listens for the verdict now, before the held answer is written, for at most `boundMs`. */
export function awaitSignal(boundMs: number): VerdictWait {
  let finish: (commit: boolean) => void = () => {};
  const commit = new Promise<boolean>((resolve) => {
    const on = () => end(true);
    const timer = setTimeout(() => end(false), Math.max(0, boundMs));
    const end = (value: boolean) => {
      clearTimeout(timer);
      process.off(VERDICT_SIGNAL, on);
      resolve(value);
    };
    finish = end;
    process.on(VERDICT_SIGNAL, on);
  });
  return { commit, cancel: () => finish(false) };
}
