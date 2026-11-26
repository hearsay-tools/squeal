import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { coreEnvironmentInputs } from "../../../src/core/keys/environment.js";
import type { AdmitAsk, HostAdmission } from "../../../src/core/runner-host/remote/admission.js";
import { UNGRANTED } from "../../../src/core/runner-host/remote/admission.js";
import { isRemoteOutageReason } from "../../../src/core/runner-host/remote/daemon-lane.js";
import { withRemoteLane } from "../../../src/core/runner-host/remote/lane.js";
import type { RunnerAdapter } from "../../../src/core/types/runner.js";
import { vitestTraits } from "../../../src/runners/vitest/traits.js";
import { RUN_MISSING } from "../../helpers/baseline.js";
import { type CatchUpSide, catchUpRepo, catchUpSide } from "../../scheduler/catch-up-fixture.js";
import { SLOW } from "../../scheduler/cleanup.js";
import { REPORT } from "../fake-channel.js";
import { background, REF, setup } from "./lane-fixture.js";

/*
 * Row 026-30: under `whenLost: "not-run"` a tier whose channel dropped
 * connects once more at once and runs there again, once; a timeout, the
 * `local` policy and a second drop go on as before, and the backoff holds
 * for later tiers. A lane ready again after files were left not run says
 * so (`onRecovered`), never at its first connect. A run takes the Git lease
 * only once granted, and the daemon's exit ends its wait for permits.
 */

/** The host's exit names the reason; the lane's line wraps it. */
const RECONNECTING =
  /^remote box: connection dropped \(.*exited.*\); reconnecting once before giving up$/;
const reconnects = (logs: readonly string[]) => logs.filter((line) => RECONNECTING.test(line));

describe("one reconnect after a dropped channel (row 026-30)", () => {
  it("runs the tier there again over a fresh connection when only the first run dropped", async () => {
    let runs = 0;
    const s = await setup({
      whenLost: "not-run",
      remoteRun: async (_, _hang, _options, kill) => {
        if (++runs === 1) {
          kill();
          return new Promise(() => {});
        }
        return { ...REPORT, completedFiles: [REF] };
      },
    });
    const report = await s.lane.run([REF], background());
    expect(report.end).toBe("completed");
    expect(report.completedFiles).toEqual([REF]);
    expect(s.connects).toHaveLength(2);
    expect(reconnects(s.logs)).toHaveLength(1);
    expect(s.lane.report()).toMatchObject({ state: "ready" });
  });

  it("gives up after the one retry, names why, and keeps the backoff for the next tier", async () => {
    const s = await setup({
      whenLost: "not-run",
      remoteRun: async (_, _hang, _options, kill) => {
        kill();
        return new Promise(() => {});
      },
    });
    const lost = await s.lane.run([REF], background());
    expect(lost.end).toBe("crashed");
    expect(lost.completedFiles).toEqual([]);
    // Review 0.1.637 B1: the proxy's own cause, wrapped in the target and the policy.
    expect(lost.failure).toMatch(
      /^remote box unreachable during the run of 1 files \(.*exited.*\); not run here \(whenLost "not-run"\); waits retry once box reconnects/,
    );
    expect(isRemoteOutageReason(lost.failure ?? "")).toBe(true);
    expect(s.connects).toHaveLength(2);
    expect(reconnects(s.logs)).toHaveLength(1);
    // Within the backoff, the next tier neither connects nor waits.
    const next = await s.lane.run([REF], background());
    expect(next.failure).toBe('remote box unreachable; not run here (whenLost "not-run")');
    expect(s.connects).toHaveLength(2);
    expect(s.localRuns).toHaveLength(0);
  });

  it("does not reconnect after a timeout", async () => {
    const s = await setup({
      whenLost: "not-run",
      deadlines: { aliveMs: 200 },
      remoteRun: (_, hang) => {
        hang();
        return new Promise(() => {});
      },
    });
    const lost = await s.lane.run([REF], background());
    expect(lost.end).toBe("timed-out");
    expect(s.connects).toHaveLength(1);
    expect(s.logs).not.toContainEqual(expect.stringContaining("reconnecting once"));
  });

  it("runs the files here at once under whenLost local, with no reconnect", async () => {
    const s = await setup({
      whenLost: "local",
      remoteRun: async (_, _hang, _options, kill) => {
        kill();
        return new Promise(() => {});
      },
    });
    const report = await s.lane.run([REF], background());
    expect(report.end).toBe("completed");
    expect(s.localRuns).toHaveLength(1);
    expect(s.connects).toHaveLength(1);
    expect(s.logs).not.toContainEqual(expect.stringContaining("reconnecting once"));
  });

  it("does not reconnect for a tier cancelled meanwhile", async () => {
    const cancel = new AbortController();
    const s = await setup({
      whenLost: "not-run",
      remoteRun: async (_, _hang, _options, kill) => {
        cancel.abort();
        kill();
        return new Promise(() => {});
      },
    });
    await s.lane.run([REF], background({ signal: cancel.signal }));
    expect(s.connects).toHaveLength(1);
  });
});

describe("the lane's recovery after an outage (row 026-30)", () => {
  it("calls onRecovered once the lane is ready again after files were left not run, never at the first connect", async () => {
    let recovered = 0;
    let drop = true;
    const s = await setup({
      whenLost: "not-run",
      onRecovered: () => recovered++,
      remoteRun: async (_, _hang, _options, kill) => {
        if (!drop) return { ...REPORT, completedFiles: [REF] };
        kill();
        return new Promise(() => {});
      },
    });
    expect(recovered).toBe(0);
    await s.lane.run([REF], background());
    // The reconnect once reached a ready host, though its run dropped too: no recovery yet.
    expect(recovered).toBe(0);
    drop = false;
    s.advance(60_000);
    const report = await s.lane.run([REF], background());
    expect(report.end).toBe("completed");
    expect(recovered).toBe(1);
    // Ready and nothing left not run since: a later reconnect is no recovery.
    s.advance(60_000);
    await s.lane.run([REF], background());
    expect(recovered).toBe(1);
  });
});

describe("the lane's lost files queued again at its recovery (review 0.1.637 B1)", () => {
  const FILES = ["a", "b"].map((name) => ({
    path: `test/${name}.test.ts`,
    ms: 1,
    imports: [`src/${name}.ts`],
  }));

  it("runs and passes the files both dropped channels left unknown", SLOW, async () => {
    let drop = false;
    let side: CatchUpSide | undefined;
    let requeued: Promise<number | undefined> | undefined;
    const s = await setup({
      whenLost: "not-run",
      // As the daemon's: the scheduler queues again the files the real matcher accepts.
      onRecovered: () => {
        requeued = side?.scheduler.requeueUnknown?.(isRemoteOutageReason);
      },
      remoteRun: async (_, _hang, _options, kill) => {
        if (!drop) return { ...REPORT, completedFiles: [REF] };
        kill();
        return new Promise(() => {});
      },
    });
    // While the channel drops, the scheduler's runs go through the lane and end with its report.
    const throughLane = (runner: RunnerAdapter): RunnerAdapter =>
      new Proxy(runner, {
        get(target, prop, receiver) {
          if (prop === "run" && drop) return () => s.lane.run([REF], background());
          const value = Reflect.get(target, prop, receiver) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    const repo = catchUpRepo(FILES);
    const f = catchUpSide(repo, repo.main, {
      files: FILES,
      hostSlots: 1,
      tierSize: 1,
      policy: RUN_MISSING,
      wrapRunner: throughLane,
    });
    side = f;
    const [A, B] = FILES.map((file) => file.path) as [string, string];
    await f.scheduler.start();
    await f.quiet();
    expect(f.current(A)).toBe(true);

    drop = true;
    await f.edit("watch", "src/a.ts");
    await f.quiet();
    expect(f.current(A)).toBe(false);
    expect(reconnects(s.logs)).toHaveLength(1);
    const runsA = f.runner.runsOf(A).length;

    // Past the backoff the lane connects again, ready: its recovery queues A again at the same key.
    drop = false;
    s.advance(60_000);
    expect((await s.lane.run([REF], background())).end).toBe("completed");
    expect(await requeued).toBe(1);
    await f.quiet();
    expect(f.runner.runsOf(A).length).toBe(runsA + 1);
    expect(f.current(A)).toBe(true);
    expect(f.current(B)).toBe(true);
  });
});

describe("the Git lease and the daemon's exit around the wait for permits (row 026-30)", () => {
  function refusing(events: string[], grantAfter: number): HostAdmission {
    let looks = 0;
    return {
      admit: (ask: AdmitAsk) => {
        if (ask.want < 1) return { grant: 0 };
        events.push(`admit ${++looks}`);
        return looks < grantAfter ? { grant: 0 } : { grant: ask.want };
      },
      claim: () => UNGRANTED,
      close: () => {},
    };
  }

  it("takes the Git lease only once the remote machine granted the run", async () => {
    const events: string[] = [];
    const s = await setup({
      admission: refusing(events, 3),
      admitEveryMs: 5,
      gitLease: async () => {
        events.push("lease");
        return () => events.push("lease end");
      },
      remoteRun: async (_, _hang, _options) => {
        events.push("run");
        return { ...REPORT, completedFiles: [REF] };
      },
    });
    const report = await s.lane.run([REF], background());
    expect(report.end).toBe("completed");
    expect(events).toEqual(["admit 1", "admit 2", "admit 3", "lease", "run", "lease end"]);
  });

  it("ends a wait for permits at the daemon's exit, the run not started and no lease taken", async () => {
    const events: string[] = [];
    const exit = new AbortController();
    const s = await setup({
      whenLost: "not-run",
      admission: refusing(events, Number.POSITIVE_INFINITY),
      admitEveryMs: 60_000,
      exitSignal: exit.signal,
      gitLease: async () => {
        events.push("lease");
        return () => {};
      },
    });
    const running = s.lane.run([REF], background());
    while (!events.includes("admit 1")) await sleep(10);
    const at = Date.now();
    exit.abort();
    const report = await running;
    expect(Date.now() - at).toBeLessThan(1_000);
    expect(report.completedFiles).toEqual([]);
    expect(report.failure).toBe("cancelled while it waited for permits");
    expect(events).toEqual(["admit 1"]);
    expect(s.remoteRuns).toEqual([]);
  });
});

describe("remote outage matching and concurrent sendPending serialization (wave 12 integration)", () => {
  it("matches only remote outage and refusal unknown reasons", () => {
    expect(
      isRemoteOutageReason(
        'remote agent37 unreachable during the run of 6 files (the host ended); not run here (whenLost "not-run")',
      ),
    ).toBe(true);
    expect(
      isRemoteOutageReason('remote box refused (degraded disk); not run here (whenLost "not-run")'),
    ).toBe(true);
    expect(
      isRemoteOutageReason(
        'vitest: remote agent37 unreachable since 2026-11-26T00:00:00.000Z (the host ended); not planned here (whenLost "not-run")',
      ),
    ).toBe(true);
    expect(isRemoteOutageReason("runner crashed")).toBe(false);
    expect(isRemoteOutageReason("timed out after 60 s")).toBe(false);
    expect(isRemoteOutageReason("inputs changed during 3 runs in a row")).toBe(false);
  });

  it("holds concurrent remote closure calls until an in-flight invalidation finishes", async () => {
    const events: string[] = [];
    let finishInvalidate: () => void = () => {};
    const invDone = new Promise<void>((resolve) => {
      finishInvalidate = resolve;
    });
    const fakeAdapter = {
      name: "vitest",
      adapterVersion: "1",
      traits: vitestTraits(),
      invalidate: async () => {
        events.push("invalidate:start");
        await invDone;
        events.push("invalidate:end");
        return { recreatedProjects: [] };
      },
      affected: async () => ({ direct: [], transitive: [] }),
      closure: async (ref: typeof REF) => {
        events.push(`closure:${ref.path}`);
        return { testFile: ref, paths: [ref.path] };
      },
      enumerate: async () => [],
      testFiles: async () => [REF],
      environment: async () => [],
      run: async () => REPORT,
      close: async () => {},
    };
    const lane = withRemoteLane({
      target: "box",
      root: "/tmp/squeal-send-pending-test",
      version: "0.1.637",
      local: fakeAdapter,
      planning: "remote",
      whenLost: "not-run",
      allowlist: () => [],
      status: () => {},
      log: () => {},
      connect: async () => {
        const core = coreEnvironmentInputs({
          squealVersion: "0.1.637",
          installedDependencies: "same",
          allowlist: [],
        });
        return {
          adapter: fakeAdapter,
          node: core.nodeVersion,
          coreEnvironment: async () => ({
            nodeVersion: core.nodeVersion,
            platform: core.platform,
            arch: core.arch,
            installedDependencies: "same",
            env: {},
          }),
          blobs: async () => ({}),
          admit: async () => ({ grant: 1 }),
          install: async () => ({ ran: false, command: null }),
        };
      },
    });
    try {
      // Wait for initial ready, then queue an invalidation while ready.
      await lane.testFiles();
      const inv = lane.invalidate([{ path: "src/a.ts", kind: "change" }]);
      while (!events.includes("invalidate:start")) await sleep(5);
      // Two concurrent closures arrive while `invalidate` is still in flight.
      const c1 = lane.closure({ project: "unit", path: "test/one.test.ts" });
      const c2 = lane.closure({ project: "unit", path: "test/two.test.ts" });
      await sleep(20);
      // Neither closure may overtake the in-flight invalidation/tree write.
      expect(events).toEqual(["invalidate:start"]);
      finishInvalidate();
      await Promise.all([inv, c1, c2]);
      expect(events[0]).toBe("invalidate:start");
      expect(events[1]).toBe("invalidate:end");
      expect(events.slice(2).sort()).toEqual([
        "closure:test/one.test.ts",
        "closure:test/two.test.ts",
      ]);
    } finally {
      await lane.close();
    }
  });
});
