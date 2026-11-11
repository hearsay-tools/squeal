import { describe, expect, it } from "vitest";
import { createRecoveringRunner } from "../../src/core/daemon/runner.js";
import { runnerHostGone, startHostProxy } from "../../src/core/runner-host/proxy.js";
import type { RunReport } from "../../src/core/types/runner.js";
import { fakeAdapter, inProcessHost, POLICY, REPORT } from "./fake-channel.js";

/*
 * Spec 021 D7, D13 (row 021-11): every request has a deadline the daemon
 * sets. A host that exits, or misses one, is lost: the run in flight ends
 * incomplete (`crashed` or `timed-out`, so every check of its tier is
 * `unknown`), never a failure or a pass; every other call fails; the proxy
 * is gone, so the recovering runner starts a new host.
 */

const A = { project: "", path: "test/a.test.ts" };
const never = () => new Promise<never>(() => {});

async function proxyOf(host: ReturnType<typeof inProcessHost>, deadlines = {}) {
  const notes: string[] = [];
  const adapter = await startHostProxy({
    channel: host.channel,
    runner: "vitest",
    version: "0.0.0-test",
    options: { childEnv: {} },
    policy: () => POLICY,
    note: (text) => notes.push(text),
    deadlines,
  });
  return { adapter, notes };
}

const runOptions = (timeoutMs: number | null) => ({ runId: "r", logDir: "/tmp/l", timeoutMs });

describe("a lost runner host", () => {
  it("ends the run in flight crashed when the host exits, and every later call fails", async () => {
    const host = inProcessHost(async () => fakeAdapter({ run: never }));
    const { adapter, notes } = await proxyOf(host);
    const report = adapter.run([A], runOptions(null));
    await expect.poll(() => host.sent.some((m) => (m as { m: string }).m === "run")).toBe(true);
    expect(runnerHostGone(adapter)).toBe(false);
    host.channel.kill();
    const ended: RunReport = await report;
    expect(ended).toMatchObject({
      end: "crashed",
      completedFiles: [],
      results: [],
      fileErrors: [],
      failure: "the vitest runner host exited (signal SIGKILL)",
    });
    expect(runnerHostGone(adapter)).toBe(true);
    await expect(adapter.closure(A)).rejects.toThrow(
      "the vitest runner host exited (signal SIGKILL)",
    );
    expect(notes).toEqual([
      "the vitest runner host exited (signal SIGKILL); a new one starts at the next call",
    ]);
    await adapter.close();
  });

  it("stops a host that misses a call's deadline, and the call fails", async () => {
    const host = inProcessHost(async () => fakeAdapter({ closure: never }));
    const { adapter } = await proxyOf(host, { callMs: 50 });
    await expect(adapter.closure(A)).rejects.toThrow(
      "the vitest runner host did not answer closure within 50 ms; Squeal stopped it",
    );
    expect(host.killed()).toBe(true);
    expect(runnerHostGone(adapter)).toBe(true);
    await adapter.close();
  });

  it("ends a run past its timeout and margin timed-out", async () => {
    const host = inProcessHost(async () => fakeAdapter({ run: never }));
    const { adapter } = await proxyOf(host, { runMarginMs: 40 });
    const report = await adapter.run([A], runOptions(10));
    expect(report).toMatchObject({
      end: "timed-out",
      completedFiles: [],
      failure: "the vitest runner host did not answer run within 50 ms; Squeal stopped it",
    });
    expect(host.killed()).toBe(true);
    expect(runnerHostGone(adapter)).toBe(true);
    await adapter.close();
  });

  it("ends a run without a test timeout timed-out once it ends no file within the watchdog", async () => {
    const host = inProcessHost(async () => fakeAdapter({ run: never }));
    const { adapter } = await proxyOf(host, { runIdleMs: 50 });
    const report = await adapter.run([A], runOptions(null));
    expect(report).toMatchObject({
      end: "timed-out",
      completedFiles: [],
      results: [],
      fileErrors: [],
      failure:
        "the vitest runner host did not answer run, nor end a file of it, within 50 ms; Squeal stopped it",
    });
    expect(host.killed()).toBe(true);
    expect(runnerHostGone(adapter)).toBe(true);
    await adapter.close();
  });

  it("keeps a run without a test timeout while it ends a file within each watchdog", async () => {
    const B = { project: "", path: "test/b.test.ts" };
    const host = inProcessHost(async () =>
      fakeAdapter({
        run: async (files, run) => {
          for (let i = 0; i < 8; i++) {
            await new Promise((resolve) => setTimeout(resolve, 40));
            run.fileEnded?.(files[i % files.length] ?? A);
          }
          return { ...REPORT, completedFiles: [...files] };
        },
      }),
    );
    // 8 files 40 ms apart: 320 ms in all, past one watchdog of 200 ms, never past one between files.
    const { adapter } = await proxyOf(host, { runIdleMs: 200 });
    const report = await adapter.run([A, B], runOptions(null));
    expect(report).toMatchObject({ end: "completed", completedFiles: [A, B] });
    expect(runnerHostGone(adapter)).toBe(false);
    await adapter.close();
  });

  it("lets the recovering runner replace a host its watchdog stopped", async () => {
    const hosts: ReturnType<typeof inProcessHost>[] = [];
    const runner = createRecoveringRunner({
      name: "vitest",
      adapterVersion: "fake-1",
      create: async () => {
        const host = inProcessHost(async () => fakeAdapter({ run: never }));
        hosts.push(host);
        return (await proxyOf(host, { runIdleMs: 50 })).adapter;
      },
      onFailure: () => {},
      gone: runnerHostGone,
    });
    expect((await runner.run([A], runOptions(null))).end).toBe("timed-out");
    expect(await runner.closure(A)).toEqual({ testFile: A, paths: [A.path] });
    expect(hosts.map((host) => host.killed())).toEqual([true, false]);
    await runner.close();
  });

  it("does not extend a run's own timeout when it ends files", async () => {
    const host = inProcessHost(async () =>
      fakeAdapter({
        run: async (files, run) => {
          for (;;) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            run.fileEnded?.(files[0] ?? A);
          }
        },
      }),
    );
    const { adapter } = await proxyOf(host, { runMarginMs: 40 });
    const report = await adapter.run([A], runOptions(10));
    expect(report).toMatchObject({
      end: "timed-out",
      failure: "the vitest runner host did not answer run within 50 ms; Squeal stopped it",
    });
    await adapter.close();
  });

  it("leaves a host lost during its start to the start's error, with no note of its own", async () => {
    const host = inProcessHost(never);
    const notes: string[] = [];
    const starting = startHostProxy({
      channel: host.channel,
      runner: "vitest",
      version: "0.0.0-test",
      options: { childEnv: {} },
      policy: () => POLICY,
      note: (text) => notes.push(text),
    });
    await expect.poll(() => host.sent.length).toBe(1);
    host.channel.kill();
    await expect(starting).rejects.toThrow("the vitest runner host exited (signal SIGKILL)");
    expect(notes).toEqual([]);
  });

  it("is gone after close, and its end there is no note", async () => {
    const host = inProcessHost(async () => fakeAdapter());
    const { adapter, notes } = await proxyOf(host);
    await adapter.close();
    await host.served;
    expect(runnerHostGone(adapter)).toBe(true);
    expect(notes).toEqual([]);
  });
});
