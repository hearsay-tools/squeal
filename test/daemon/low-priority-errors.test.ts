import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { getPriority } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import { type Identity, lowerWhile, TEST_NICE } from "../../src/core/daemon/low-priority.js";
import { statOf } from "../../src/core/daemon/terminate.js";

/*
 * Row 011-410 (review 011-409 S1): `lowerWhile` ends only on its abort. An
 * error from `carriers` or a walk is reported once per message and the next
 * look retries, so a later test process of the run still reaches nice 10.
 * This process stands in for the daemon. Run at `nice` 10 already (under a
 * lowered daemon), the priority checks hold trivially: run it directly at
 * nice 0 to prove them.
 */

/** A process that sleeps until the test ends, by its pid and start. */
function sleeper(): Identity {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], {
    stdio: "ignore",
  });
  onTestFinished(() => {
    child.kill("SIGKILL");
  });
  const entry = child.pid === undefined ? null : statOf(child.pid);
  if (entry === null) throw new Error("no sleeper");
  return { pid: entry.pid, start: entry.start };
}

/** `lowerWhile` over `carriers` and `walk`, its reports and whether it has ended. */
function lowering(
  carriers: () => Promise<Identity[]>,
  walk: (pid: number) => Identity[] = () => [],
) {
  const reports: string[] = [];
  const settled = new AbortController();
  let ended = false;
  const running = lowerWhile(
    { carriers: async () => (await carriers()).map((entry) => ({ ...entry, ppid: 1, pgrp: 1 })) },
    "fast",
    "normal",
    0,
    settled.signal,
    walk,
    (message) => reports.push(message),
  ).then(() => {
    ended = true;
  });
  const stop = async () => {
    settled.abort();
    await running;
  };
  onTestFinished(stop);
  return { reports, ended: () => ended, stop };
}

/** Waits up to 5 s for `pid` to reach nice 10. */
async function niced(pid: number): Promise<number> {
  for (let waited = 0; waited < 5_000 && getPriority(pid) < TEST_NICE; waited += 50)
    await sleep(50);
  return getPriority(pid);
}

describe.runIf(process.platform === "linux")(
  "lowerWhile: errors other than its abort (011-410)",
  () => {
    it("lowers a later child after a walk throws, and reports the error once", async () => {
      const fork = sleeper();
      const late = sleeper();
      const message = `walk failed ${randomUUID()}`;
      let walks = 0;
      const run = lowering(
        async () => [fork],
        () => {
          walks++;
          if (walks >= 2 && walks <= 4) throw new Error(message);
          return walks > 4 ? [late] : [];
        },
      );
      expect(await niced(late.pid)).toBe(TEST_NICE);
      expect(run.ended()).toBe(false);
      expect(getPriority(fork.pid)).toBe(TEST_NICE);
      expect(run.reports.filter((line) => line.includes(message))).toHaveLength(1);
    });

    it("lowers a carrier found after its listing rejects, and reports the error once", async () => {
      const fork = sleeper();
      const message = `carriers failed ${randomUUID()}`;
      let looks = 0;
      const run = lowering(async () => {
        looks++;
        if (looks <= 3) throw new Error(message);
        return [fork];
      });
      expect(await niced(fork.pid)).toBe(TEST_NICE);
      expect(run.ended()).toBe(false);
      expect(run.reports.filter((line) => line.includes(message))).toHaveLength(1);
    });

    it("ends on its abort, and reports nothing, even with a listing in flight", async () => {
      let started = (): void => {};
      const listing = new Promise<void>((resolve) => {
        started = resolve;
      });
      const run = lowering(async () => {
        started();
        await sleep(200);
        throw new Error("aborted while listing");
      });
      await listing;
      await run.stop();
      expect(run.ended()).toBe(true);
      expect(run.reports).toEqual([]);
    });
  },
);
