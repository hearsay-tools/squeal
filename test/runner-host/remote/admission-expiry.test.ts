import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, afterEach, describe, expect, it, onTestFinished } from "vitest";
import type { HostCpu, TreeCpu } from "../../../src/core/capacity/cores.js";
import {
  createPermitPool,
  type PermitPool,
  type PoolLease,
  poolPermitFile,
} from "../../../src/core/capacity/pool.js";
import type { HostedAdapter } from "../../../src/core/runner-host/host.js";
import {
  createHostAdmission,
  type HostAdmission,
} from "../../../src/core/runner-host/remote/admission.js";
import { remoteHostOver } from "../../../src/core/runner-host/remote/connect.js";
import { createTreeHost } from "../../../src/core/runner-host/remote/tree-host.js";
import type { RemoteRunReply } from "../../../src/core/runner-host/remote/tree-wire.js";
import { takePermit } from "../../../src/core/slow/slot.js";
import type { RunOptions } from "../../../src/core/types/runner.js";
import { inProcessHost, POLICY, REPORT } from "../fake-channel.js";
import { background, REF, setup, until } from "./lane-fixture.js";

/*
 * Review 0.1.445 R1 (row 021-21, spec 021 D18): a run never starts on the
 * remote machine without a permit of that machine held for it. A grant the
 * host returned before the run came (its hold passed, or a later look took
 * its place) leaves the run refused unstarted, whoever holds the permit
 * now; the lane asks the machine again and the run waits for a grant.
 * Only a look whose pool failed lets a run go without a grant.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-admission-expiry-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const closing: { close(): void }[] = [];
afterEach(() => {
  for (const item of closing.splice(0)) item.close();
});

let n = 0;
const tree: TreeCpu = { read: () => 0, reset() {} };
const quiet: HostCpu = { read: () => 2 };

/** A pool directory of the remote machine, which has one permit. */
function machineDir(): string {
  const dir = join(scratch, `machine-${++n}`, "squeal-uid");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** The host's admission over the machine's single permit, its grants held `holdMs`. */
function admissionIn(dir: string, holdMs?: number): HostAdmission {
  const made = createHostAdmission(
    (log) =>
      createPermitPool({
        dir,
        owner: { pid: process.pid, worktreeId: "runner-host:/remote/tree" },
        hostSlots: 1,
        cpus: 24,
        cores: tree,
        host: quiet,
        log,
      }),
    holdMs,
  );
  closing.push(made);
  return made;
}

/** Another daemon of the remote machine, which takes the permit when it is free. */
function otherDaemon(dir: string): PermitPool {
  const pool = createPermitPool({
    dir,
    owner: { pid: process.pid, worktreeId: "other daemon" },
    hostSlots: 1,
    cores: null,
  });
  closing.push(pool);
  return pool;
}

/** Whether a holder locks the machine's permit now. */
function permitHeld(dir: string): boolean {
  const db = takePermit(join(dir, poolPermitFile(0)), { pid: process.pid, worktreeId: "counter" });
  if (db === null) return true;
  db.close();
  return false;
}

describe("a run whose remote grant went back before it came (review 0.1.445 R1, spec 021 D18)", () => {
  it("is refused unstarted at the host, and nothing runs beside the permit's new holder", async () => {
    const dir = machineDir();
    const root = join(scratch, `local-${++n}`);
    const remoteRoot = join(scratch, `remote-${n}`, "root");
    mkdirSync(join(root, "test"), { recursive: true });
    mkdirSync(remoteRoot, { recursive: true });
    writeFileSync(join(root, "test/a.test.ts"), "\n");
    execFileSync("git", ["init", "-q", root]);
    const ran: RunOptions[] = [];
    const adapter: HostedAdapter = {
      name: "vitest",
      adapterVersion: "1",
      invalidate: async () => ({ recreatedProjects: [] }),
      affected: async () => ({ direct: [], transitive: [] }),
      closure: async (testFile) => ({ testFile, paths: [] }),
      enumerate: async () => [],
      testFiles: async () => [REF],
      environment: async () => [],
      run: async (files, options) => {
        ran.push(options);
        return { ...REPORT, completedFiles: [...files] };
      },
      close: async () => {},
    };
    const host = inProcessHost(async () => adapter, "0.0.0-test", {
      tree: createTreeHost(remoteRoot, () => {}),
      admission: admissionIn(dir, 30),
    });
    onTestFinished(() => host.channel.kill());
    const remote = await remoteHostOver(host.channel, "v-test", {
      target: { destination: "box" },
      version: "0.0.0-test",
      root,
      runner: "vitest",
      options: { childEnv: {} },
      policy: () => POLICY,
    });
    expect(await remote.admit({ want: 1, least: 1 })).toEqual({ grant: 1 });
    expect(permitHeld(dir)).toBe(true);
    // The hold passes before the run comes, and another daemon takes the machine's one permit.
    await sleep(150);
    const other = otherDaemon(dir).acquire(1, "fast", 1, "checkpoint");
    expect(other?.grant).toBe(1);
    const reply = (await remote.adapter.run([REF], {
      runId: "late",
      logDir: join(scratch, `logs-${n}`),
      timeoutMs: 60_000,
      workers: 1,
      admitted: true,
    } as RunOptions)) as RemoteRunReply;
    expect(reply.unadmitted).toBe(true);
    expect(ran).toHaveLength(0);
    other?.release();
  });

  it("waits through the lane for a new grant, and runs only while it holds the machine's permit", async () => {
    const dir = machineDir();
    const real = admissionIn(dir);
    const other = otherDaemon(dir);
    const taken: { lease: PoolLease | null } = { lease: null };
    let first = true;
    // The first grant goes back before its run comes, as after the hold, and the other daemon takes the permit.
    const admission: HostAdmission = {
      admit: (ask) => {
        const answer = real.admit(ask);
        if (first && answer.grant > 0) {
          first = false;
          real.admit({ want: 0, least: 0 });
          taken.lease = other.acquire(1, "fast", 1, "checkpoint");
        }
        return answer;
      },
      claim: () => real.claim(),
      close: () => real.close(),
    };
    const during: boolean[] = [];
    const { lane, remoteRuns, logs } = await setup({
      admission,
      admitEveryMs: 20,
      remoteRun: async () => {
        during.push(permitHeld(dir));
        return { ...REPORT, completedFiles: [REF] };
      },
    });
    const running = lane.run([REF], background());
    await until(() => logs.some((line) => line.includes("asking again")));
    expect(taken.lease?.grant).toBe(1);
    await sleep(150);
    // Refused unstarted there, it waits while the other daemon holds the permit.
    expect(remoteRuns).toHaveLength(0);
    taken.lease?.release();
    const report = await running;
    expect(report.completedFiles).toEqual([REF]);
    expect(remoteRuns).toHaveLength(1);
    // The run held the machine's permit while it ran; it went back at the run's end.
    expect(during).toEqual([true]);
    expect(permitHeld(dir)).toBe(false);
  });
  it("counts the remote as lost after three runs in a row come with no grant held, and runs the files here", async () => {
    const admission: HostAdmission = {
      admit: (ask) => ({ grant: ask.want }),
      claim: () => null,
      close: () => {},
    };
    const { lane, remoteRuns, localRuns, logs } = await setup({ admission, admitEveryMs: 5 });
    const report = await lane.run([REF], background());
    expect(remoteRuns).toHaveLength(0);
    expect(logs.filter((line) => line.includes("asking again"))).toHaveLength(2);
    expect(logs).toContain(
      "remote box: its machine's grant went back before the run came, 3 times",
    );
    // `whenLost: "local"`: the files run here.
    expect(localRuns).toHaveLength(1);
    expect(report.completedFiles).toEqual([REF]);
  });
});
