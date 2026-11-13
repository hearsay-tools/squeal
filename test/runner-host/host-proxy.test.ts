import { describe, expect, it } from "vitest";
import type { AdapterHooks } from "../../src/core/runner-host/host.js";
import type { HostPolicy } from "../../src/core/runner-host/protocol.js";
import { startHostProxy } from "../../src/core/runner-host/proxy.js";
import type { RunOptions, RunReport } from "../../src/core/types/runner.js";
import { fakeAdapter, inProcessHost, POLICY, REPORT } from "./fake-channel.js";

/*
 * Spec 021 D6, D7 (row 021-11): the proxy against a fake adapter in a host
 * served in this process. Each request is answered once; the adapter's
 * callbacks arrive as events; a cancelled run still answers once; the
 * input's end stops the run and closes the adapter. The proxy's traits, from
 * the values the host sent last, are rows of `test/daemon/runner-traits.test.ts`.
 */

const VERSION = "0.0.0-test";
const A = { project: "", path: "test/a.test.ts" };
const B = { project: "", path: "test/b.test.ts" };

function proxyOver(
  host: ReturnType<typeof inProcessHost>,
  policy: () => HostPolicy = () => POLICY,
) {
  const notes: string[] = [];
  return {
    notes,
    proxy: startHostProxy({
      channel: host.channel,
      runner: "vitest",
      version: VERSION,
      options: { childEnv: {} },
      policy,
      note: (text) => notes.push(text),
    }),
  };
}

const options = (over: Partial<RunOptions> = {}): RunOptions => ({
  runId: "run-1",
  logDir: "/tmp/logs",
  timeoutMs: null,
  ...over,
});

describe("runner host and proxy", () => {
  it("answers members", async () => {
    const host = inProcessHost(async () => fakeAdapter({ testFiles: async () => [A, B] }));
    const { proxy } = proxyOver(host);
    const adapter = await proxy;
    expect(adapter.name).toBe("vitest");
    expect(adapter.adapterVersion).toBe("fake-1");
    expect(adapter.recheck).toBeUndefined();
    expect(await adapter.testFiles()).toEqual([A, B]);
    expect(await adapter.closure(A)).toEqual({ testFile: A, paths: [A.path] });
    await adapter.close();
    await host.served;
  });

  it("sends the policy before a request once it changed, and the adapter reads it there", async () => {
    let seen: boolean[] = [];
    let hooks: AdapterHooks | null = null;
    const host = inProcessHost(async (_, given) => {
      hooks = given;
      return fakeAdapter({
        affected: async () => {
          seen.push(given.policy().observe);
          return { direct: [], transitive: [] };
        },
      });
    });
    let policy = POLICY;
    const { proxy } = proxyOver(host, () => policy);
    const adapter = await proxy;
    await adapter.affected([]);
    policy = { ...POLICY, observe: true };
    await adapter.affected([]);
    await adapter.affected([]);
    expect(seen).toEqual([false, true, true]);
    expect(hooks).not.toBeNull();
    const notices = host.sent.filter((m) => (m as { m: string }).m === "policy");
    expect(notices).toHaveLength(1);
    seen = [];
    await adapter.close();
  });

  it("streams fileEnded and notes, and a cancelled run answers once with its report", async () => {
    const host = inProcessHost(async (_, hooks) =>
      fakeAdapter({
        run: (_files, run) =>
          new Promise<RunReport>((resolve) => {
            run.fileEnded?.(A);
            hooks.note("a note from the run");
            run.signal?.addEventListener("abort", () =>
              resolve({
                ...REPORT,
                completedFiles: [A],
                failure: `cancelled: ${String(run.signal?.reason)}`,
              }),
            );
          }),
      }),
    );
    const { proxy, notes } = proxyOver(host);
    const adapter = await proxy;
    const ended: string[] = [];
    const signal = new AbortController();
    const report = adapter.run(
      [A, B],
      options({ signal: signal.signal, fileEnded: (f) => ended.push(f.path) }),
    );
    await expect.poll(() => ended).toEqual([A.path]);
    signal.abort("supersession");
    expect(await report).toEqual({
      ...REPORT,
      completedFiles: [A],
      failure: "cancelled: supersession",
    });
    expect(notes).toEqual(["a note from the run"]);
    const runs = host.sent.filter((m) => (m as { m: string }).m === "run");
    expect(runs).toHaveLength(1);
    await adapter.close();
  });

  it("calls the daemon's beforeForce with the workers' env and waits for it", async () => {
    const order: string[] = [];
    const host = inProcessHost(async () =>
      fakeAdapter({
        run: async (_, run) => {
          await run.beforeForce?.({ SQUEAL_DAEMON_CHILD: "token:vitest" });
          order.push("forced");
          return REPORT;
        },
      }),
    );
    const { proxy } = proxyOver(host);
    const adapter = await proxy;
    const report = await adapter.run(
      [A],
      options({
        beforeForce: async (env) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          order.push(`read ${String(env.SQUEAL_DAEMON_CHILD)}`);
        },
      }),
    );
    expect(report).toEqual(REPORT);
    expect(order).toEqual(["read token:vitest", "forced"]);
    await adapter.close();
  });

  it("stops the run and closes the adapter when its input ends", async () => {
    const events: string[] = [];
    const host = inProcessHost(async () =>
      fakeAdapter({
        run: (_, run) =>
          new Promise<RunReport>((resolve) => {
            run.stop?.addEventListener("abort", () => {
              events.push(`stop ${String(run.stop?.reason)}`);
              resolve(REPORT);
            });
          }),
        close: async () => {
          events.push("close");
        },
      }),
    );
    const { proxy } = proxyOver(host);
    const adapter = await proxy;
    void adapter.run([A], options());
    await expect.poll(() => host.sent.some((m) => (m as { m: string }).m === "run")).toBe(true);
    host.channel.endInput();
    await host.served;
    expect(events).toEqual(["stop stop", "close"]);
  });

  it("refuses a host of another Squeal version", async () => {
    const host = inProcessHost(async () => fakeAdapter(), "9.9.9");
    const { proxy } = proxyOver(host);
    await expect(proxy).rejects.toThrow(
      "runner host of Squeal 9.9.9 (protocol 1) refuses a daemon of Squeal 0.0.0-test (protocol 1)",
    );
    await host.served;
  });

  it("rejects with the adapter's own error when it cannot start, and the host ends", async () => {
    const host = inProcessHost(async () => {
      throw new Error("vitest/node does not resolve from /w");
    });
    const { proxy } = proxyOver(host);
    await expect(proxy).rejects.toThrow("vitest/node does not resolve from /w");
    await host.served;
  });
});
