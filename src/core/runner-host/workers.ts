import { setTimeout as sleep } from "node:timers/promises";
import { CHILD_VARIABLE, EscapedChildren } from "../daemon/escaped.js";
import { lowerWhile, runPriority } from "../daemon/low-priority.js";
import { HOST } from "../daemon/outlived.js";
import { childrenOf, exited, GRACE_MS, lifeOf, type ProcessEntry } from "../daemon/terminate.js";
import type { RunOptions, RunReport } from "../types/runner.js";

/*
 * Spec 021 D8 (row 021-11): what the daemon did for the workers of an
 * in-process run that they no longer reach as its children, done in the
 * host. While the run lasts, its workers run at the run's priority
 * (`lowerWhile`, 001 D11). Once it resolves, the host waits up to the grace
 * for them to be gone, as `EscapedChildren` waits for the daemon's own
 * children, so the daemon's sweep after the reply finds only what a test
 * left behind (001 D12).
 */

/** Runs `run` with its workers handled; the host's own process is `self`. */
export type RunAround = (options: RunOptions, run: () => Promise<RunReport>) => Promise<RunReport>;

/** A run's mark, `<token>:<lane>`, as `EscapedChildren.envFor` makes it. */
function markOf(options: RunOptions): { token: string; lane: string } | null {
  const value = options.childEnv?.[CHILD_VARIABLE];
  if (value === undefined) return null;
  const colon = value.indexOf(":");
  return colon < 0 ? null : { token: value.slice(0, colon), lane: value.slice(colon + 1) };
}

/** The host's `RunAround` on Linux; elsewhere each run as it is, as the daemon does. */
export function hostWorkers(self: number = process.pid): RunAround {
  const children = new Map<string, EscapedChildren>();
  return async (options, run) => {
    const mark = markOf(options);
    if (mark === null || process.platform !== "linux") return run();
    let own = children.get(mark.token);
    if (own === undefined) {
      own = new EscapedChildren(mark.token, self);
      children.set(mark.token, own);
    }
    const since = own.mark();
    const settled = new AbortController();
    const priority = runPriority(options.priority, options.lane ?? mark.lane);
    const lowering = lowerWhile(own, mark.lane, priority, since, settled.signal);
    try {
      return await run();
    } finally {
      settled.abort();
      await lowering;
      await workersGone(self, `${mark.token}:${mark.lane}`, since);
    }
  };
}

/**
 * Waits up to the grace for the children of `self` started since `since`
 * that carry `mark`, or are exiting, to be gone, every thread of theirs.
 */
async function workersGone(self: number, mark: string, since: number): Promise<void> {
  const candidates = childrenOf(self).flatMap((pid) => {
    const life = lifeOf(pid);
    return life !== null && life.start >= since ? [life] : [];
  });
  const marks = await Promise.all(candidates.map(({ pid }) => HOST.variable(pid, CHILD_VARIABLE)));
  let left: ProcessEntry[] = candidates.filter((life, i) => life.dying || marks[i] === mark);
  const deadline = Date.now() + GRACE_MS;
  left = left.filter((entry) => !exited(entry));
  while (left.length > 0 && Date.now() < deadline) {
    await sleep(25);
    left = left.filter((entry) => !exited(entry));
  }
}
