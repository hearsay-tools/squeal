import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";
import type { RemoteHost } from "../../../src/core/runner-host/remote/connect.js";
import { withRemoteLane } from "../../../src/core/runner-host/remote/lane.js";
import type { RunnerAdapter } from "../../../src/core/types/runner.js";
import { NO_TRAITS } from "../../../src/core/types/runner-traits.js";
import { REPORT } from "../fake-channel.js";
import { until } from "./lane-fixture.js";

/*
 * Review 0.1.617 B1: a lane's close is not done while its connect is. It
 * aborts the connect's signal, waits for the connect to end and closes the
 * host it reached; a host still being compared is closed at once, not after
 * its compare, and only once.
 */

const root = mkdtempSync(join(tmpdir(), "squeal-lane-close-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const local: RunnerAdapter = {
  name: "vitest",
  adapterVersion: "1",
  traits: NO_TRAITS,
  invalidate: async () => ({ recreatedProjects: [] }),
  affected: async () => ({ direct: [], transitive: [] }),
  closure: async (testFile) => ({ testFile, paths: [] }),
  enumerate: async () => [],
  testFiles: async () => [],
  environment: async () => [],
  run: async () => REPORT,
  close: async () => {},
};

/** A host whose compare waits until it is closed, then fails; `closes` counts its closes. */
function heldHost() {
  let closes = 0;
  let closed = () => {};
  const shut = new Promise<never>((_, reject) => {
    closed = () => reject(new Error("the host closed"));
  });
  shut.catch(() => {});
  const host = {
    adapter: {
      ...local,
      close: async () => {
        closes++;
        closed();
      },
    },
    node: "v24.0.0",
    coreEnvironment: () => shut,
    blobs: () => shut,
    admit: () => shut,
    install: () => shut,
  } as unknown as RemoteHost;
  return { host, closes: () => closes };
}

function lane(connect: (signal: AbortSignal) => Promise<RemoteHost>) {
  const statuses: string[] = [];
  const runner = withRemoteLane({
    target: "box",
    whenLost: "local",
    root: root as never,
    version: "0.0.0-test",
    local,
    connect,
    allowlist: () => [],
    status: (text) => statuses.push(text),
    log: () => {},
  });
  return { runner, statuses };
}

/** Whether `promise` settled within `ms`. */
async function settles(promise: Promise<unknown>, ms = 200): Promise<boolean> {
  let done = false;
  void promise.finally(() => {
    done = true;
  });
  await sleep(ms);
  return done;
}

describe("a remote lane's close with its connect in flight (review 0.1.617 B1)", () => {
  it("aborts the connect, waits for it, and closes the host it reached", async () => {
    const { host, closes } = heldHost();
    let reached = (_: RemoteHost) => {};
    let signal: AbortSignal | undefined;
    const { runner } = lane((s) => {
      signal = s;
      return new Promise((resolve) => {
        reached = resolve;
      });
    });
    const closing = runner.close();
    expect(signal?.aborted).toBe(true);
    expect(await settles(closing)).toBe(false);
    reached(host);
    await closing;
    expect(closes()).toBe(1);
  });

  it("closes a host still being compared at once, and once", async () => {
    const { host, closes } = heldHost();
    const { runner, statuses } = lane(async () => host);
    await until(() => statuses.some((s) => /not yet compared/.test(s)));
    expect(await settles(runner.close())).toBe(true);
    await sleep(50);
    expect(closes()).toBe(1);
  });
});
