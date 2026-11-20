/*
 * Throwaway probe, row 011-413. Run from the repository root:
 *   pnpm exec tsx docs/specifications/011-core/research/probes/run-width-design/stale-cores.ts
 * Drives the real `createPermitPool` (src/core/capacity/pool.ts at 0.1.570) with
 * fake tree and host readers, as test/capacity/host-gate.test.ts does, on the
 * 12-CPU lab VM's numbers: hostSlots 11, ceiling 9 (share 0.75 of 12).
 * Question: after a wide Vitest tier ends while another lease (a node:test
 * slot) keeps the pool active, what grant does the next backlog tier get,
 * before and after the next mark refresh?
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostCpu, TreeCpu } from "../../../../../../src/core/capacity/cores.js";
import { clearMark, writeMark } from "../../../../../../src/core/capacity/marks.js";
import { createPermitPool } from "../../../../../../src/core/capacity/pool.js";

const REFRESH_MS = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function reader(cores: number): TreeCpu & HostCpu & { cores: number } {
  return { cores, read() { return this.cores; }, reset() {} };
}

async function scenario(label: string, treeDuringTier: number, otherLease: boolean) {
  const root = mkdtempSync(join(tmpdir(), "rw413-"));
  const dir = join(root, "pool");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tree = reader(0);
  const host = reader(0);
  const pool = createPermitPool({
    dir: dir as never,
    owner: { pid: process.pid, worktreeId: "w" as never },
    hostSlots: 11,
    cpus: 12,
    backgroundShare: 0.75,
    cores: tree,
    host,
    refreshMs: REFRESH_MS,
  });
  const out: string[] = [];
  // A node:test backlog slot holds one permit for the whole window (H0: 65.8 to 336.4 s).
  const slot = otherLease ? pool.acquire(1, "fast", 1, "backlog") : null;
  const tier = pool.acquire(9, "fast", 1, "backlog");
  out.push(`first tier grant ${tier?.grant}`);
  // The tier runs: the tree (daemon, runner host, forks) uses `treeDuringTier` cores; the host
  // sees the same, so nothing is busy beyond the tree.
  tree.cores = treeDuringTier;
  host.cores = treeDuringTier;
  await sleep(REFRESH_MS * 3);
  // The tier's tail, then its end: its forks are gone.
  tier?.shrinkTo(2);
  tier?.release();
  tree.cores = otherLease ? 1 : 0;
  host.cores = otherLease ? 1 : 0;
  out.push(`offer right after the end ${pool.offer(9, "fast", "backlog")}`);
  const next = pool.acquire(9, "fast", 1, "backlog");
  out.push(`next tier grant right after the end ${next?.grant ?? 0}`);
  next?.release();
  await sleep(REFRESH_MS * 2);
  out.push(`offer after the next refresh ${pool.offer(9, "fast", "backlog")}`);
  slot?.release();
  pool.close();
  rmSync(root, { recursive: true, force: true });
  console.log(`${label}: ${out.join("; ")}`);
}

await scenario("A node slot held, tree 9.5 during the tier", 9.5, true);
await scenario("B node slot held, tree 8.2 during the tier", 8.2, true);
await scenario("C node slot held, tree 7.2 during the tier", 7.2, true);
await scenario("D no other lease, tree 8.2 during the tier", 8.2, false);

/*
 * E: a second daemon waits for the pool (S2's copy 2) while copy 1's wide
 * tier runs: copy 1's mark holds 9 background permits at 9.6 cores, and the
 * host reads 9.6 busy. Copy 1's tier ends at t = 20 s: its mark goes (it held
 * nothing else) and the host reads 0.3. Copy 2 looks at t = 0, then every
 * 2 s (CAPACITY_RECHECK_MS), as the pump does while it is refused.
 */
async function waiter(label: string) {
  const root = mkdtempSync(join(tmpdir(), "rw413-"));
  const dir = join(root, "pool");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let clock = Date.now();
  const tree = reader(0);
  const host = reader(9.6);
  const pool = createPermitPool({
    dir: dir as never,
    owner: { pid: process.pid, worktreeId: "copy2" as never },
    hostSlots: 11,
    cpus: 12,
    backgroundShare: 0.75,
    cores: tree,
    host,
    now: () => clock,
  });
  const copy1 = () => {
    writeMark(dir as never, { id: "copy1", want: 9, grant: 9, since: null, cores: 9.6, background: 9 } as never);
    const at = new Date(clock);
    utimesSync(markPath(dir), at, at);
  };
  const out: string[] = [];
  clock += 1_500; // the window opened at construction is over 1 s old at the first look
  for (let t = 0; t <= 40; t += 2) {
    if (t < 20) copy1();
    if (t === 20) {
      clearMark(dir as never, "copy1" as never);
      host.cores = 0.3;
    }
    const lease = pool.acquire(9, "fast", 1, "backlog");
    if (t >= 14) out.push(`t=${t}s ${lease?.grant ?? 0}`);
    if (lease !== null) {
      lease.release();
      if (t >= 20) break;
    }
    clock += 2_000;
  }
  pool.close();
  rmSync(root, { recursive: true, force: true });
  console.log(`${label}: grant at each look: ${out.join(", ")}`);
}

function markPath(dir: string): string {
  return join(dir, readdirSync(dir).find((n) => n.includes("copy1") && !n.endsWith(".tmp")) ?? "");
}

await waiter("E second daemon waits; copy 1's tier ends at t=20 s");

/*
 * F: after E, copy 2 holds its 1-permit tier; 1 s later copy 1 picks its next
 * backlog tier (S2: copy 1's 55-file tier at 203.4 s). Both pools are real and
 * share one directory; the host reads 1.3 busy (copy 2's one worker and its
 * daemons). What does copy 1 get?
 */
async function reserve(label: string) {
  const root = mkdtempSync(join(tmpdir(), "rw413-"));
  const dir = join(root, "pool");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let clock = Date.now();
  const make = (id: string, host: HostCpu, tree: TreeCpu) =>
    createPermitPool({
      dir: dir as never,
      owner: { pid: process.pid, worktreeId: id as never },
      hostSlots: 11,
      cpus: 12,
      backgroundShare: 0.75,
      cores: tree,
      host,
      now: () => clock,
    });
  const host2 = reader(9.6);
  const copy2 = make("copy2", host2, reader(0));
  clock += 1_500;
  // No other mark and a stale busy window: the floor's one permit, as in E at t = 20 s.
  const first = copy2.acquire(9, "fast", 1, "backlog");
  clock += 1_000;
  const copy1 = make("copy1", reader(1.3), reader(0));
  clock += 1_500;
  const next = copy1.acquire(9, "fast", 1, "backlog");
  console.log(
    `${label}: copy 2 holds ${first?.grant ?? 0}, copy 1 gets ${next?.grant ?? 0} of the ceiling's 9`,
  );
  next?.release();
  first?.release();
  copy1.close();
  copy2.close();
  rmSync(root, { recursive: true, force: true });
}

await reserve("F copy 1's next tier beside copy 2's narrow one");
