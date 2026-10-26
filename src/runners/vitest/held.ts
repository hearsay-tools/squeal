import type { Vitest } from "vitest/node";
import { CHILD_VARIABLE } from "../../core/daemon/escaped.js";
import { type HostTable, heldByRun, type RunTies } from "../../core/daemon/outlived.js";
import type { ProcessIdentity } from "../../core/types/index.js";
import { OBSERVE_VARIABLE } from "../observe/index.js";
import type { RunCollector } from "./reporter.js";

/*
 * Row 011-245 (gh-101): before `execute`'s forced cancel kills the workers,
 * what they started, read through the ties the instance gave them.
 */

/** `heldByRun` for the run's ties, its time and count in the run log. */
export async function heldAtForce(
  vitest: Vitest,
  collector: RunCollector,
  since: number,
  host: HostTable,
): Promise<readonly ProcessIdentity[]> {
  const started = performance.now();
  const held = await heldByRun(tiesOf(vitest), since, host);
  const ms = Math.round(performance.now() - started);
  collector.note(
    `before the forced cancel, read what the workers started in ${ms} ms: ${held.length} found`,
  );
  return held;
}

/** What the instance adds to its workers' env (013 V10): the daemon's mark and the recorder's output. */
function tiesOf(vitest: Vitest): RunTies {
  const env: Record<string, unknown> = vitest.config.env ?? {};
  const mark = env[CHILD_VARIABLE];
  const settings = env[OBSERVE_VARIABLE];
  let out: unknown;
  try {
    out =
      typeof settings === "string" ? (JSON.parse(settings) as { out?: unknown }).out : undefined;
  } catch {
    out = undefined;
  }
  return {
    ...(typeof mark === "string" ? { worker: { variable: CHILD_VARIABLE, value: mark } } : {}),
    ...(typeof out === "string" && out !== ""
      ? { observed: { variable: OBSERVE_VARIABLE, out } }
      : {}),
  };
}
