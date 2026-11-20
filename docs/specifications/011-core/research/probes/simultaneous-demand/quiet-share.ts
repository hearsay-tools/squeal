/*
 * Throwaway probe, row 011-420. Run with an arm's source root (a scratch copy
 * of main + 011-417, with or without q.patch or qc.patch applied):
 *   tsx quiet-share.ts <arm src root>
 * Drives the real `createPermitPool` of that arm with fake tree and host
 * readers, on the 12-CPU lab VM's numbers: hostSlots 11, ceiling 9.
 * Daemon A ends its catch-up quiet first and asks for a 9-wide backlog tier;
 * daemon B's quiet still holds 64 backlog files (arm q and qc: B's mark
 * states them, `expect(64)`). Then A's tier runs at its grant (0.95 core per
 * worker, as the host sees it) and B's quiet ends: B asks for 9.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const { createPermitPool } = await import(join(root, "src/core/capacity/pool.ts"));
const REFRESH_MS = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Reader = { cores: number; read(): number; reset(): void };
const reader = (cores: number): Reader => ({ cores, read() { return this.cores; }, reset() {} });

async function run(label: string, bQuiet: boolean, aAlone = false) {
  const tmp = mkdtempSync(join(tmpdir(), "sd420-"));
  const dir = join(tmp, "pool");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const host = reader(0.3);
  const treeA = reader(0);
  const treeB = reader(0);
  const pool = (id: string, tree: Reader) =>
    createPermitPool({
      dir, owner: { pid: process.pid, worktreeId: id }, hostSlots: 11, cpus: 12,
      backgroundShare: 0.75, cores: tree, host, refreshMs: REFRESH_MS,
    });
  const a = pool("worktree-a", treeA);
  const b = pool("worktree-b", treeB);
  const out: string[] = [];
  if (bQuiet && !aAlone) {
    if (typeof b.expect !== "function") out.push("B cannot state its quiet demand (no expect)");
    else b.expect(64);
  }
  const tierA = a.acquire(200, "fast", 1, "backlog");
  out.push(`A grant ${tierA?.grant ?? 0}`);
  treeA.cores = 0.95 * (tierA?.grant ?? 0);
  host.cores = 0.3 + treeA.cores;
  await sleep(REFRESH_MS * 12); // A's refresh measures its tree; B's host reading ages past 1 s
  if (!aAlone) {
    if (typeof b.expect === "function") b.expect(0);
    const tierB = b.acquire(64, "fast", 1, "backlog");
    out.push(`B grant at its quiet's end ${tierB?.grant ?? 0}`);
    tierB?.release();
  }
  tierA?.release();
  a.close();
  b.close();
  rmSync(tmp, { recursive: true, force: true });
  console.log(`${label}: ${out.join("; ")}`);
}

await run("1 B's quiet holds backlog when A asks", true);
await run("2 A alone (no other daemon)", false, true);
