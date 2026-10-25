import { pidNamespace, readProcStat } from "../../src/core/delivery/harness-process.js";
import { commandHoldMetaKey, mergeHoldMetaKey } from "../../src/core/scheduler/hold-rows.js";
import type { SquealRepo } from "./helpers.js";

/** The live daemon's merge hold of `src/math.ts`, as it publishes it (row 011-72). */
export function holdMerge(r: SquealRepo): void {
  const revision = r.store.revisions.latest(r.worktreeId)?.number ?? 0;
  const row = { v: 1, since: Date.now(), revision, paths: ["src/math.ts"], count: 1 };
  r.store.meta.set(mergeHoldMetaKey(r.worktreeId), JSON.stringify(row));
}

/** A live `squeal hold` of `npm run gate`, this test's process its wrapper (row 011-74). */
export function holdCommand(r: SquealRepo): void {
  const stat = readProcStat(process.pid);
  const namespace = pidNamespace();
  if (stat === null || namespace === null) throw new Error("no /proc entry for this process");
  const wrapper = { pid: process.pid, startTime: stat.startTime, pidNamespace: namespace };
  const since = Date.now();
  const entry = {
    token: "t1",
    since,
    until: since + 3_600_000,
    command: "npm run gate",
    wrapper,
    child: null,
  };
  r.store.meta.set(commandHoldMetaKey(r.worktreeId), JSON.stringify({ v: 1, entries: [entry] }));
}
