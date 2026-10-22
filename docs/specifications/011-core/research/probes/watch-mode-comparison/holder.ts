// Holds every permit of the scratch pool for <seconds>, as another daemon's backlog tier would
// (011 C10), through the clone's own pool code. Run with the squeal clone's tsx in env.sh's
// environment, so the pool is $XDG_RUNTIME_DIR/squeal under /tmp. Throwaway (011-119).
import { createPermitPool } from "/tmp/wm119/repos/squeal-s/src/core/capacity/pool.ts";
import { slowSlotDir } from "/tmp/wm119/repos/squeal-s/src/core/slow/slot.ts";
const seconds = Number(process.argv[2] ?? 60);
const dir = slowSlotDir(process.env);
if (!dir.startsWith("/tmp/wm119/")) throw new Error(`refusing a pool outside the scratch dir: ${dir}`);
const pool = createPermitPool({ dir, owner: { pid: process.pid, worktreeId: "holder-011-119" as never }, hostSlots: 4 });
let lease = null;
while (lease === null) { lease = pool.acquire(4, "fast", 4); if (lease === null) await new Promise((r) => setTimeout(r, 200)); }
console.log(JSON.stringify({ held: lease.grant, at: Date.now() / 1000 }));
await new Promise((r) => setTimeout(r, seconds * 1000));
lease.release();
console.log(JSON.stringify({ released: true, at: Date.now() / 1000 }));
