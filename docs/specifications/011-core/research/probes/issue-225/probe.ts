// Throwaway probe for issue #225. Not product code. Drives the real permit pool
// with injected CPU readings in a temporary directory. No daemon, no real load.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostCpu, TreeCpu } from "../../../../../../src/core/capacity/cores.js";
import { type PoolMark, writeMark } from "../../../../../../src/core/capacity/marks.js";
import { createPermitPool, type PoolTierKind } from "../../../../../../src/core/capacity/pool.js";
import { loadAllows } from "../../../../../../src/core/retry/load.js";
import { gateText } from "../../../../../../src/core/scheduler/pool-wait.js";

const tree: TreeCpu = { read: () => 0, reset() {} };
const host = (cores: number): HostCpu => ({ read: () => cores });

interface Case {
  name: string;
  hostSlots: number;
  busy: number;
  kind: PoolTierKind;
  others: PoolMark[];
}

const now = Date.now();
const runsBackground: PoolMark = { id: "other-runs", want: 1, grant: 1, since: null, cores: 1, background: 1 };
const olderWaiter: PoolMark = { id: "other-waits", want: 4, grant: 0, since: now - 60_000, cores: 0, background: 0 };

const cases: Case[] = [
  { name: "A slots6 busy17 alone (floor)", hostSlots: 6, busy: 17, kind: "backlog", others: [] },
  { name: "B slots6 busy17 another daemon runs 1 background permit", hostSlots: 6, busy: 17, kind: "backlog", others: [runsBackground] },
  { name: "C slots6 busy17 an older fast waiter, 0 grants", hostSlots: 6, busy: 17, kind: "backlog", others: [olderWaiter] },
  { name: "D slots6 busy5.5 another daemon runs 1 background permit", hostSlots: 6, busy: 5.5, kind: "backlog", others: [runsBackground] },
  { name: "E slots23 busy17 another daemon runs 1 background permit", hostSlots: 23, busy: 17, kind: "backlog", others: [runsBackground] },
  { name: "F slots23 busy18 another daemon runs 1 background permit", hostSlots: 23, busy: 18, kind: "backlog", others: [runsBackground] },
  { name: "G slots6 busy23 checkpoint kind, other runs 1", hostSlots: 6, busy: 23, kind: "checkpoint", others: [runsBackground] },
];

for (const c of cases) {
  const root = mkdtempSync(join(tmpdir(), "squeal-issue-225-"));
  const dir = join(root, "squeal-uid");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const m of c.others) writeMark(dir, m);
  const pool = createPermitPool({
    dir,
    owner: { pid: process.pid, worktreeId: "me" },
    hostSlots: c.hostSlots,
    cpus: 24,
    cores: tree,
    host: host(c.busy),
  });
  // A load retry's tier: one file, fewest one worker.
  const lease = pool.acquire(1, "fast", 1, c.kind);
  const gate = pool.gate();
  console.log(
    `${c.name}: ${lease === null ? "REFUSED" : `granted ${lease.grant}`}; status would say: ${gate === null ? "-" : gateText(gate)}`,
  );
  lease?.release();
  pool.close();
  rmSync(root, { recursive: true, force: true });
}

// Retry eligibility (the load gate) is a different test from pool admission.
for (const oneMinute of [17, 23.9, 24]) {
  console.log(`retry load gate, load ${oneMinute} / 24 CPUs: eligible=${loadAllows({ oneMinute, cpus: 24 })}`);
}
