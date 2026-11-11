import { describe, expect, it } from "vitest";
import { runnerHostGone, startHostProxy } from "../../src/core/runner-host/proxy.js";
import type { RunReport } from "../../src/core/types/runner.js";
import { fakeAdapter, inProcessHost, POLICY } from "./fake-channel.js";

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
