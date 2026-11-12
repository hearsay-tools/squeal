import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { leaseProcess, leaseProcessAlive } from "../../src/core/daemon/lease-process.js";

/*
 * Review 0.1.442 B3 (row 021-16): a write lease lasts while its client's
 * process lives, paused or not, and ends once it is gone.
 */

async function exited(): Promise<ReturnType<typeof leaseProcess>> {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"]);
  await new Promise((done) => child.once("spawn", done));
  const holder = leaseProcess(child.pid);
  child.kill("SIGKILL");
  await new Promise((done) => child.once("exit", done));
  return holder;
}

describe("a lease's process (review 0.1.442 B3)", () => {
  it("lives while it runs, and also while it is stopped", async () => {
    expect(leaseProcessAlive(leaseProcess())).toBe(true);
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"]);
    await new Promise((done) => child.once("spawn", done));
    const holder = leaseProcess(child.pid);
    child.kill("SIGSTOP");
    try {
      expect(leaseProcessAlive(holder)).toBe(true);
    } finally {
      child.kill("SIGKILL");
      await new Promise((done) => child.once("exit", done));
    }
  });

  it("is gone once it exited", async () => {
    expect(leaseProcessAlive(await exited())).toBe(false);
  });

  it.runIf(process.platform === "linux")(
    "is gone when its PID now names a process started at another time, and unknown in another PID namespace",
    () => {
      const own = leaseProcess();
      expect(own.startTime).not.toBeNull();
      expect(leaseProcessAlive({ ...own, startTime: (own.startTime ?? 0) + 1 })).toBe(false);
      expect(leaseProcessAlive({ ...own, pidNamespace: "pid:[1]" })).toBeNull();
    },
  );
});
