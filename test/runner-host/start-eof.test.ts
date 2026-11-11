import { type ChildProcess, spawn } from "node:child_process";
import { describe, expect, it, onTestFinished } from "vitest";
import type { HostedAdapter } from "../../src/core/runner-host/host.js";
import { encodeLine, RUNNER_HOST_PROTOCOL } from "../../src/core/runner-host/protocol.js";
import { fakeAdapter, inProcessHost, POLICY } from "./fake-channel.js";

/*
 * Spec 021 D6 (row 021-11, review 0.1.434 B4): when its input ends, the host
 * stops its run and its workers and exits. An input that ends while the
 * adapter is still being built must not leave that adapter, and the workers
 * it started, alive: the host closes it once it is built, and never serves
 * it.
 */

const START = {
  protocol: RUNNER_HOST_PROTOCOL,
  version: "0.0.0-test",
  runner: "vitest",
  options: { childEnv: {} },
  policy: POLICY,
};

const alive = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;

/** An adapter factory that starts a worker and waits for `release` before it returns. */
function gatedFactory() {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let began = false;
  let closed = 0;
  let worker: ChildProcess | null = null;
  const build = async (): Promise<HostedAdapter> => {
    began = true;
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    worker = child;
    onTestFinished(() => {
      child.kill("SIGKILL");
    });
    await gate;
    return fakeAdapter({
      close: async () => {
        closed++;
        child.kill("SIGKILL");
      },
    });
  };
  return {
    build,
    release: () => release(),
    began: () => began,
    closed: () => closed,
    worker: () => worker,
  };
}

describe("a runner host whose input ends during its start", () => {
  it("closes the adapter built after the end, within the close bound", async () => {
    const factory = gatedFactory();
    const host = inProcessHost(factory.build, "0.0.0-test", { closeMs: 5_000 });
    host.channel.write(encodeLine({ id: 1, m: "start", a: [START] }));
    await expect.poll(() => factory.began()).toBe(true);
    host.channel.endInput();
    // The end is read before the factory returns.
    await new Promise((resolve) => setTimeout(resolve, 50));
    factory.release();
    await host.served;
    expect(factory.closed()).toBe(1);
    const worker = factory.worker();
    if (worker === null) throw new Error("no worker started");
    await expect.poll(() => alive(worker)).toBe(false);
  });

  it("closes the adapter built after the bound passed, and the host still ends at the bound", async () => {
    const factory = gatedFactory();
    const host = inProcessHost(factory.build, "0.0.0-test", { closeMs: 50 });
    host.channel.write(encodeLine({ id: 1, m: "start", a: [START] }));
    await expect.poll(() => factory.began()).toBe(true);
    host.channel.endInput();
    await host.served;
    expect(factory.closed()).toBe(0);
    factory.release();
    await expect.poll(() => factory.closed()).toBe(1);
    const worker = factory.worker();
    if (worker === null) throw new Error("no worker started");
    await expect.poll(() => alive(worker)).toBe(false);
  });
});
