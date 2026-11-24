import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { daemonExits, loadPolicy, POLICY_FILE } from "../../src/core/daemon/policy.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";

/*
 * Spec 026 D2.2 (row 026-09; the human, 2026-11-24): with no test group at
 * `edit` or `pause`, `daemon.unusedExitMinutes` defaults to 2 instead of 30,
 * and (the coordinator, 2026-11-24) a daemon with no consumer stops after
 * the lesser of `daemon.idleExitMinutes` and that bound unless
 * `daemon.idleExitMinutes` is set. An explicit key always wins. The loader
 * records which keys the file sets; `daemonExits` resolves both bounds for
 * the daemon's timers, at each reload, and for `squeal ps` alike.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function dirWith(config: object | null): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-exits-"));
  dirs.push(dir);
  if (config !== null) writeFileSync(join(dir, POLICY_FILE), JSON.stringify(config));
  return dir;
}

function exits(config: object | null) {
  const dir = dirWith(config);
  const { policy, problems } = loadPolicy(dir);
  expect(problems).toEqual([]);
  return daemonExits(policy);
}

const MANUAL_TESTS = [{ name: "unit", runner: "vitest", at: "manual" }];
const EDIT_FREE = {
  checks: [...MANUAL_TESTS, { name: "lint", lint: ["oxlint"], at: "edit" }],
  lint: { enabled: true, tools: ["oxlint"] },
};

describe("the daemon's exit bounds by test policy (spec 026 D2.2, row 026-09)", () => {
  it("keeps 30 and 60 minutes when tests run at edit, as with no file", () => {
    expect(exits(null)).toEqual(DEFAULT_POLICY.daemon);
    expect(exits({})).toEqual(DEFAULT_POLICY.daemon);
    expect(exits({ checks: [{ name: "unit", runner: "vitest", at: "edit" }] })).toEqual({
      idleExitMinutes: 60,
      unusedExitMinutes: 30,
    });
  });

  it("keeps them when tests run at pause", () => {
    expect(exits({ checks: [{ name: "unit", runner: "vitest", at: "pause" }] })).toEqual({
      idleExitMinutes: 60,
      unusedExitMinutes: 30,
    });
  });

  it("defaults both to 2 minutes when no test group runs at edit or pause", () => {
    expect(exits(EDIT_FREE)).toEqual({ idleExitMinutes: 2, unusedExitMinutes: 2 });
    expect(exits({ checks: [{ name: "unit", runner: "vitest", at: "stop" }] })).toEqual({
      idleExitMinutes: 2,
      unusedExitMinutes: 2,
    });
  });

  it("lets an explicit unusedExitMinutes win, and caps the unset idle bound by it", () => {
    expect(exits({ ...EDIT_FREE, daemon: { unusedExitMinutes: 0.5 } })).toEqual({
      idleExitMinutes: 0.5,
      unusedExitMinutes: 0.5,
    });
    expect(exits({ ...EDIT_FREE, daemon: { unusedExitMinutes: 90 } })).toEqual({
      idleExitMinutes: 60,
      unusedExitMinutes: 90,
    });
  });

  it("lets an explicit idleExitMinutes win under an edit-free policy", () => {
    expect(exits({ ...EDIT_FREE, daemon: { idleExitMinutes: 45 } })).toEqual({
      idleExitMinutes: 45,
      unusedExitMinutes: 2,
    });
  });

  it("leaves explicit bounds alone when tests run at edit", () => {
    const daemon = { idleExitMinutes: 5, unusedExitMinutes: 0.5 };
    expect(exits({ daemon })).toEqual(daemon);
    expect(exits({ daemon: { unusedExitMinutes: 0.5 } })).toEqual({
      idleExitMinutes: 60,
      unusedExitMinutes: 0.5,
    });
  });

  it("treats a bad value as unset: the derived default applies", () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-exits-"));
    dirs.push(dir);
    const config = { ...EDIT_FREE, daemon: { unusedExitMinutes: 0, idleExitMinutes: "x" } };
    writeFileSync(join(dir, POLICY_FILE), JSON.stringify(config));
    const { policy, problems } = loadPolicy(dir);
    expect(problems).toHaveLength(2);
    expect(daemonExits(policy)).toEqual({ idleExitMinutes: 2, unusedExitMinutes: 2 });
  });

  it("records which bounds the file sets, and holds the defaults for the rest", () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-exits-"));
    dirs.push(dir);
    writeFileSync(join(dir, POLICY_FILE), JSON.stringify({ daemon: { unusedExitMinutes: 30 } }));
    expect(loadPolicy(dir).policy.daemon).toEqual({
      idleExitMinutes: 60,
      unusedExitMinutes: 30,
      set: { idleExitMinutes: false, unusedExitMinutes: true },
    });
    // An explicit 30 under an edit-free policy stays 30; the unset idle bound is capped by it.
    writeFileSync(
      join(dir, POLICY_FILE),
      JSON.stringify({ ...EDIT_FREE, daemon: { unusedExitMinutes: 30 } }),
    );
    expect(daemonExits(loadPolicy(dir).policy)).toEqual({
      idleExitMinutes: 30,
      unusedExitMinutes: 30,
    });
  });

  it("keeps a hand-built policy's bounds unless they are the defaults", () => {
    const manual = loadPolicy(dirWith(EDIT_FREE)).policy;
    const daemon = { idleExitMinutes: 5, unusedExitMinutes: 0.5 };
    expect(daemonExits({ ...manual, daemon })).toEqual(daemon);
    expect(daemonExits({ ...manual, daemon: DEFAULT_POLICY.daemon })).toEqual({
      idleExitMinutes: 2,
      unusedExitMinutes: 2,
    });
    expect(daemonExits(DEFAULT_POLICY)).toEqual(DEFAULT_POLICY.daemon);
  });
});
