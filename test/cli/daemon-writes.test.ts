import { afterEach, describe, expect, it } from "vitest";
import { endCommandHolds, HOLD_NOT_STARTED, holdCommand } from "../../src/cli/hold.js";
import type { CliIo } from "../../src/cli/main.js";
import { retryCommand } from "../../src/cli/retry.js";
import { clearStoppedMark } from "../../src/cli/stopped-mark.js";
import { DaemonWriter } from "../../src/core/delivery/daemon-writer.js";
import { markStopped } from "../../src/core/presence/events.js";
import { readStop } from "../../src/core/presence/stored.js";
import { readRetries } from "../../src/core/retry/records.js";
import { readCommandHolds } from "../../src/core/scheduler/hold-rows.js";
import type { AbsolutePath, EpochMs } from "../../src/core/types/common.js";
import { countWrites, type ServedWrites, serveWrites } from "../harness/daemon-writes-helpers.js";
import { FILE, type SquealRepo, squealRepo } from "../harness/helpers.js";

/*
 * Spec 021 D15 (row 021-16): while a daemon serves the worktree, `hold`,
 * `start`'s clearing of the stop mark and holds, and `retry` send their
 * writes to its socket, and it writes them; past D1's bound under another
 * client's write lease, a command says who holds it and writes nothing.
 * Without a daemon, these commands write the store themselves within D1's
 * bound, as the 021-07 tests (`hold-busy`, `retry-busy`) check.
 */

const served: ServedWrites[] = [];
afterEach(async () => {
  for (const s of served.splice(0)) await s.close();
});

async function serving(): Promise<{ r: SquealRepo; daemon: ServedWrites }> {
  const r = squealRepo();
  r.policy({});
  const daemon = await serveWrites(r);
  served.push(daemon);
  return { r, daemon };
}

function io(r: SquealRepo) {
  const out = { stdout: "", stderr: "" };
  const cli: CliIo = {
    stdout: (text) => {
      out.stdout += text;
    },
    stderr: (text) => {
      out.stderr += text;
    },
    cwd: r.root,
    env: {},
  };
  return { cli, out };
}

const ask = async () => null;

describe("commands while a daemon serves (021-16)", () => {
  it("hold adds and removes its entry through the daemon, with no store write of its own", async () => {
    const { r, daemon } = await serving();
    const { cli, out } = io(r);
    const count = countWrites(daemon.store);
    const code = await holdCommand(["--", "true"], cli, { ask });
    const counted = count.stop();
    expect(code).toBe(0);
    expect(out.stderr).toContain("is on hold until `true` exits");
    expect(counted.transactions).toBe(0);
    expect(counted.madeWritable).toBe(0);
    expect(counted.statements).toBe(daemon.statements());
    expect(daemon.batches.length).toBeGreaterThanOrEqual(2);
    expect(readCommandHolds(r.store, r.worktreeId)).toEqual([]);
  });

  it("start clears the stop mark and the holds through the daemon", async () => {
    const { r, daemon } = await serving();
    r.store.transaction(() => markStopped(r.store, r.worktreeId, 1 as EpochMs, null, true));
    const count = countWrites(daemon.store);
    expect(await clearStoppedMark(r.root as AbsolutePath)).toBeNull();
    expect(await endCommandHolds(r.root as AbsolutePath)).toEqual([]);
    const counted = count.stop();
    expect(counted.transactions).toBe(0);
    expect(readStop(r.store, r.worktreeId)).toBeNull();
  });

  it("retry stores its request through the daemon", async () => {
    const { r, daemon } = await serving();
    r.apply(r.fail());
    const { cli, out } = io(r);
    const count = countWrites(daemon.store);
    const code = await retryCommand([FILE.path, "--reason", "environment"], cli);
    const counted = count.stop();
    expect(out.stdout).toContain("Retry queued (reason: environment)");
    expect(code).toBe(0);
    expect(counted.transactions).toBe(0);
    expect(readRetries(r.store)).toHaveLength(1);
  });

  it("past its bound under another client's lease, hold names that client and does not start", async () => {
    const { r } = await serving();
    const record = r.store.worktrees.get(r.worktreeId)?.daemon;
    const other = new DaemonWriter({
      worktreeId: r.worktreeId,
      storeSchema: r.store.schemaVersion,
      socketPath: () => record?.socketPath ?? null,
      holder: "4242 another hook",
      boundMs: 1_000,
    });
    expect(await other.acquire()).toBe(true);
    const { cli, out } = io(r);
    const code = await holdCommand(["--", "true"], cli, { ask, busyBoundMs: 300 });
    await other.release();
    expect(code).toBe(HOLD_NOT_STARTED);
    expect(out.stderr).toContain("its write lease held by 4242 another hook");
    expect(readCommandHolds(r.store, r.worktreeId)).toEqual([]);
  });
});
