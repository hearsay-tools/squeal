import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createPermitPool } from "../../src/core/capacity/pool.js";
import type { HostedAdapter } from "../../src/core/runner-host/host.js";
import { type HostAdmission, UNGRANTED } from "../../src/core/runner-host/remote/admission.js";
import { remoteHostOver } from "../../src/core/runner-host/remote/connect.js";
import { withRemoteLane } from "../../src/core/runner-host/remote/lane.js";
import { createTreeHost } from "../../src/core/runner-host/remote/tree-host.js";
import type { RunnerAdapter } from "../../src/core/types/runner.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { inProcessHost, POLICY } from "../runner-host/fake-channel.js";
import { until } from "../runner-host/remote/lane-fixture.js";
import {
  type CatchUpFile,
  type CatchUpRunner,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";

/*
 * Spec 021 D18, last bullet (row 021-21; the coordinator, request
 * 66d23a73): a background tier the lane sends to a remote holds no local
 * permit, neither while the remote machine refuses it nor while it runs
 * there, so this machine's own background tiers are not held back by it.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-remote-permits-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const FILES: CatchUpFile[] = [
  { path: "test/a.test.ts", ms: 10, imports: ["src/a.ts"] },
  { path: "test/b.test.ts", ms: 10, imports: ["src/b.ts"] },
];
const SLOTS = 4;

/** The permits another process could take in the local pool now. */
function free(dir: string): number {
  const probe = createPermitPool({
    dir,
    owner: { pid: process.pid, worktreeId: `probe-${Math.random()}` },
    hostSlots: SLOTS,
    cores: null,
  });
  const grant = probe.acquire(SLOTS, "fast", 1, "checkpoint")?.grant ?? 0;
  probe.close();
  return grant;
}

/**
 * A remote host in this process that answers as `runner` does and runs its
 * files; its machine refuses the first two looks. `seen` gets the local
 * pool's free permits at each look and during the run.
 */
function busyRemote(runner: CatchUpRunner, root: string, seen: (at: string) => void) {
  const remoteRoot = join(scratch, `remote-${Date.now()}-${Math.random()}`, "root");
  mkdirSync(remoteRoot, { recursive: true });
  let looks = 0;
  const admission: HostAdmission = {
    admit: (ask) => {
      seen("look");
      return ++looks <= 2 ? { grant: 0 } : { grant: ask.want };
    },
    // A grant without a pool behind it: the run goes ungranted.
    claim: () => UNGRANTED,
    close: () => {},
  };
  const adapter = (): HostedAdapter => ({
    name: runner.name,
    adapterVersion: runner.adapterVersion,
    invalidate: async () => ({ recreatedProjects: [] }),
    affected: async () => ({ direct: [], transitive: [] }),
    closure: (testFile) => runner.closure(testFile),
    enumerate: async () => [],
    testFiles: () => runner.testFiles(),
    environment: () => runner.environment(),
    run: (files, options) => {
      seen("run");
      return runner.run(files, options);
    },
    close: async () => {},
  });
  const host = inProcessHost(async () => adapter(), "0.0.0-test", {
    tree: createTreeHost(remoteRoot, () => {}),
    admission,
  });
  return remoteHostOver(host.channel, "v-test", {
    target: { destination: "box" },
    version: "0.0.0-test",
    root,
    runner: "vitest",
    options: { childEnv: {} },
    policy: () => POLICY,
  });
}

describe("a background tier on a remote holds no local permit (spec 021 D18, row 021-21)", () => {
  it("gives its local grant back while the remote machine refuses it and while it runs there", async () => {
    const repo = catchUpRepo(FILES);
    const statuses: string[] = [];
    const seen: string[] = [];
    const side = catchUpSide(repo, repo.main, {
      files: FILES,
      hostSlots: SLOTS,
      policy: RUN_MISSING,
      wrapRunner: (runner): RunnerAdapter =>
        withRemoteLane({
          target: "box",
          whenLost: "local",
          root: repo.main,
          version: "0.0.0-test",
          local: runner,
          connect: () =>
            busyRemote(runner, repo.main, (at) => seen.push(`${at} ${free(repo.poolDir)}`)),
          allowlist: () => [],
          status: (text) => statuses.push(text),
          log: () => {},
          admitEveryMs: 10,
        }),
    });
    await until(() => statuses.some((s) => s.includes("go there")));
    await side.scheduler.start();
    await side.scheduler.idle();
    // Every free permit of this machine stays free while the tier waits there and runs there.
    expect(seen).toEqual([`look ${SLOTS}`, `look ${SLOTS}`, `look ${SLOTS}`, `run ${SLOTS}`]);
    for (const { path } of FILES) expect(side.current(path)).toBe(true);
    expect(free(repo.poolDir)).toBe(SLOTS);
  });
});
