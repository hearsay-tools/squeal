import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DISK_WRITES,
  type DiskProbe,
  degradedText,
  judgeDisk,
  medianOf,
  probeDisk,
} from "../../../src/core/runner-host/remote/disk-check.js";
import { fakeSsh } from "./helpers.js";

/*
 * Spec 026 D11 (row 026-13): the disk probe runs under the remote's Node
 * through `ssh`, here a fake one whose login is a directory of this
 * machine: 20 writes of 4 KiB, each with its sync, in `<cache>/squeal`,
 * its file removed after. The verdict over its median follows the lane's
 * `diskCheck`.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-disk-check-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
function login() {
  const dir = join(scratch, `l${++n}`);
  const home = join(dir, "home");
  const ssh = fakeSsh(join(dir, "bin"), home);
  return { home, target: { destination: "dev@box", ssh } };
}

const CHECK = { enabled: true, maxWriteMs: 10, onSlowDisk: "warn" } as const;
const probeAt = (ms: number) => async (): Promise<DiskProbe> => ({
  medianMs: ms,
  samplesMs: [ms],
});

describe("the disk probe (row 026-13, spec 026 D11.1)", () => {
  it("writes 20 times with a sync in <cache>/squeal, removes its file, and reports the median", async () => {
    const { home, target } = login();
    const probe = await probeDisk(target, { node: process.execPath, cache: ".squeal-remote" });
    expect(probe.samplesMs).toHaveLength(DISK_WRITES);
    for (const ms of probe.samplesMs) expect(ms).toBeGreaterThanOrEqual(0);
    expect(probe.medianMs).toBe(medianOf(probe.samplesMs));
    const dir = join(home, ".squeal-remote", "squeal");
    expect(statSync(dir).isDirectory()).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("takes an absolute cache, and leaves what was there", async () => {
    const { target } = login();
    const cache = join(scratch, `abs${n}`);
    const probe = await probeDisk(target, { node: process.execPath, cache });
    expect(probe.samplesMs).toHaveLength(DISK_WRITES);
    writeFileSync(join(cache, "squeal", "kept"), "x");
    await probeDisk(target, { node: process.execPath, cache });
    expect(readdirSync(join(cache, "squeal"))).toEqual(["kept"]);
  });

  it("fails, named, when the remote's Node cannot run it", async () => {
    const { target } = login();
    await expect(
      probeDisk(target, { node: "/srv/none/node", cache: ".squeal-remote" }, 10_000),
    ).rejects.toThrow(/could not measure the disk of dev@box/);
  });

  it("takes the median of an odd and an even count", () => {
    expect(medianOf([5, 1, 3])).toBe(3);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
    expect(medianOf([])).toBe(0);
  });
});

describe("the disk verdict (row 026-13, spec 026 D11.2)", () => {
  it("measures nothing when the check is off", async () => {
    let probed = false;
    const verdict = await judgeDisk({ ...CHECK, enabled: false }, async () => {
      probed = true;
      return { medianMs: 99, samplesMs: [99] };
    });
    expect(verdict).toEqual({ kind: "skipped" });
    expect(probed).toBe(false);
  });

  it("passes a median at or under the limit, and names one above it", async () => {
    expect((await judgeDisk(CHECK, probeAt(10))).kind).toBe("healthy");
    expect(await judgeDisk(CHECK, probeAt(34.4))).toEqual({
      kind: "slow",
      probe: { medianMs: 34.4, samplesMs: [34.4] },
      text: "degraded disk: 34 ms/sync, limit 10 ms",
    });
  });

  it("says a probe that failed measured nothing", async () => {
    const verdict = await judgeDisk(CHECK, async () => {
      throw new Error("no ssh");
    });
    expect(verdict).toEqual({ kind: "unmeasured", why: "no ssh" });
  });

  it("shows whole milliseconds from 10 and one decimal under it", () => {
    expect(degradedText(123.4, 10)).toBe("degraded disk: 123 ms/sync, limit 10 ms");
    expect(degradedText(2.46, 1.5)).toBe("degraded disk: 2.5 ms/sync, limit 1.5 ms");
  });
});
