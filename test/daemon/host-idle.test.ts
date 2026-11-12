import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { defaultHostIdleMinutes, hostIdleMs } from "../../src/core/daemon/host-idle.js";
import { loadPolicy } from "../../src/core/daemon/policy.js";

/*
 * Spec 021 D20.4 (row 021-26): `runner.hostIdleMinutes`. Its default comes
 * from the machine's total memory, one minute per 8 GiB, 2 to 10; the user
 * config's value wins over `squeal.config.json`'s.
 */

const GIB = 2 ** 30;

describe("runner.hostIdleMinutes (spec 021 D20.4)", () => {
  it("defaults to 2, 6 and 10 minutes at 16, 48 and 80 GiB, and stays within 2 to 10", () => {
    expect(defaultHostIdleMinutes(16 * GIB)).toBe(2);
    expect(defaultHostIdleMinutes(48 * GIB)).toBe(6);
    expect(defaultHostIdleMinutes(80 * GIB)).toBe(10);
    // A 48 GiB machine reports a little less (this host: 47.04 GiB).
    expect(defaultHostIdleMinutes(47.04 * GIB)).toBe(6);
    expect(defaultHostIdleMinutes(4 * GIB)).toBe(2);
    expect(defaultHostIdleMinutes(512 * GIB)).toBe(10);
  });

  it("takes the user config's minutes, else the project's at each read, else the default", () => {
    let project: number | null = null;
    const fromProject = hostIdleMs(null, () => project, 6);
    expect(fromProject()).toBe(6 * 60_000);
    project = 0;
    expect(fromProject()).toBe(0);
    project = 3;
    expect(fromProject()).toBe(3 * 60_000);
    expect(hostIdleMs(1, () => project, 6)()).toBe(60_000);
    expect(hostIdleMs(0, () => project, 6)()).toBe(0);
  });

  it("reads whole minutes from 0 in squeal.config.json, and keeps the default for another value", () => {
    const root = mkdtempSync(join(tmpdir(), "squeal-host-idle-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const read = (value: string) => {
      writeFileSync(join(root, "squeal.config.json"), `{"runner": {"hostIdleMinutes": ${value}}}`);
      return loadPolicy(root);
    };
    for (const minutes of [0, 4]) {
      expect(read(String(minutes))).toMatchObject({
        policy: { runner: { hostIdleMinutes: minutes } },
        problems: [],
      });
    }
    expect(read("null")).toMatchObject({ policy: { runner: { hostIdleMinutes: null } } });
    for (const bad of ["2.5", "-1", '"3"']) {
      const { policy, problems } = read(bad);
      expect(problems).toEqual([
        `"runner.hostIdleMinutes" must be a whole number of minutes >= 0, or null, got ${bad}`,
      ]);
      expect(policy.runner.hostIdleMinutes).toBeNull();
    }
  });
});
