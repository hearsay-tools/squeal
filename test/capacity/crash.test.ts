import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createPermitPool } from "../../src/core/capacity/index.js";
import { SLOT_WAITER_FRESH_MS } from "../../src/core/slow/index.js";

/*
 * Spec 001 D11 Capacity (task 001-376): "the OS releases it when its holder
 * dies". A plain Node process takes the whole pool and is SIGKILLed; its
 * permits come back at once, its mark stops counting within 30 s.
 */

const register = fileURLToPath(new URL("../store/child/register-ts.mjs", import.meta.url));
const poolModule = fileURLToPath(new URL("../../src/core/capacity/pool.ts", import.meta.url));

const holderScript = `
const { createPermitPool } = await import(${JSON.stringify(poolModule)});
const [dir] = process.argv.slice(1);
const pool = createPermitPool({ dir, owner: { pid: process.pid, worktreeId: "doomed" }, hostSlots: 4 });
const lease = pool.acquire(200);
console.log("took " + lease.grant);
setInterval(() => {}, 1000);
`;

let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-pool-crash-"));
  dir = join(root, "squeal-uid");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test("a holder killed with SIGKILL returns its permits to the pool", {
  timeout: 60_000,
}, async () => {
  const child = spawn(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--import",
      register,
      "--input-type=module",
      "--eval",
      holderScript,
      dir,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const closed = new Promise<void>((resolve) => child.on("close", () => resolve()));
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  try {
    const deadline = Date.now() + 30_000;
    while (!stdout.includes("took")) {
      if (child.exitCode !== null) throw new Error(`holder exited: ${stderr}`);
      if (Date.now() > deadline) throw new Error(`holder took nothing within 30 s: ${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(stdout).toContain("took 4");

    let clock = Date.now();
    // Processes only: the dead holder's mark, fresh for 30 s, would also count its cores (row 011-98).
    const pool = createPermitPool({
      dir,
      owner: { pid: process.pid, worktreeId: "survivor" },
      hostSlots: 4,
      now: () => clock,
      cores: null,
    });
    try {
      // Every permit is the holder's: this daemon gets none and waits (row 011-96).
      expect(pool.acquire(200)).toBeNull();

      child.kill("SIGKILL");
      await closed;
      // The permits are back at once; the dead holder's mark still counts for its share.
      const after = pool.acquire(200);
      expect(after?.grant).toBe(2);
      after?.release();

      // Once its mark is 30 s old, this daemon is alone and takes the host's slots.
      clock += SLOT_WAITER_FRESH_MS;
      expect(pool.acquire(200)?.grant).toBe(4);
    } finally {
      pool.close();
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed;
  }
});
