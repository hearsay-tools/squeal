import { describe, expect, it } from "vitest";
import { harnessOf, type ProcStat, pidNamespace } from "../../src/core/delivery/index.js";
import type { HarnessProcess } from "../../src/core/types/index.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { findHarnessProcess } from "../../src/harness/shared/harness-process.js";
import { recorded, SESSION, SUBAGENT, squealRepo } from "./helpers.js";

/*
 * Lessons, defect 24; `research/harness-process-liveness.md`: a hook records
 * the harness it runs under with each registration, the nearest ancestor that
 * is not a shell, `CLAUDE_PID` under Claude Code.
 */

/** A process table: pid -> [comm, ppid, start time, state]. */
function table(rows: Record<number, [string, number, number, string?]>) {
  return (pid: number): ProcStat | null => {
    const row = rows[pid];
    return row === undefined
      ? null
      : { comm: row[0], ppid: row[1], startTime: row[2], state: row[3] ?? "S" };
  };
}
const NS = () => "pid:[4026531836]";
const found = (pid: number, startTime: number): HarnessProcess => ({
  pid,
  startTime,
  pidNamespace: NS(),
});

describe("findHarnessProcess", () => {
  it("is the hook's parent when that is the harness (exec form, Codex)", () => {
    const read = table({ 40: ["codex", 30, 400], 30: ["node", 1, 300] });
    expect(findHarnessProcess({ env: {}, ppid: 40, read, namespace: NS })).toEqual(found(40, 400));
  });

  it("walks past the shell of a shell-form hook, and past launchers", () => {
    const read = table({
      50: ["sh", 41, 500],
      41: ["timeout", 40, 410],
      40: ["claude", 2, 400],
    });
    expect(findHarnessProcess({ env: {}, ppid: 50, read, namespace: NS })).toEqual(found(40, 400));
  });

  it("takes CLAUDE_PID when the walk reaches it, whatever its name", () => {
    const read = table({ 50: ["sh", 40, 500], 40: ["bash", 2, 400] });
    const env = { CLAUDE_PID: "40" };
    expect(findHarnessProcess({ env, ppid: 50, read, namespace: NS })).toEqual(found(40, 400));
  });

  it("ignores a CLAUDE_PID inherited from an outer Claude Code", () => {
    const read = table({ 60: ["codex", 40, 600], 40: ["claude", 2, 400] });
    const env = { CLAUDE_PID: "40" };
    expect(findHarnessProcess({ env, ppid: 60, read, namespace: NS })).toEqual(found(60, 600));
  });

  it("names no process when the harness died first, the walk runs out, or there is no /proc", () => {
    const orphan = table({ 50: ["sh", 9, 500], 9: ["systemd", 1, 90] });
    expect(findHarnessProcess({ env: {}, ppid: 50, read: orphan, namespace: NS })).toBeNull();
    const toInit = table({ 50: ["sh", 1, 500] });
    expect(findHarnessProcess({ env: {}, ppid: 50, read: toInit, namespace: NS })).toBeNull();
    const shells = table({
      50: ["sh", 51, 1],
      51: ["sh", 52, 1],
      52: ["sh", 53, 1],
      53: ["sh", 54, 1],
      54: ["node", 2, 1],
    });
    expect(findHarnessProcess({ env: {}, ppid: 50, read: shells, namespace: NS })).toBeNull();
    const zombie = table({ 40: ["claude", 2, 400, "Z"] });
    expect(findHarnessProcess({ env: {}, ppid: 40, read: zombie, namespace: NS })).toBeNull();
    const failing = () => {
      throw new Error("EACCES");
    };
    expect(findHarnessProcess({ env: {}, ppid: 40, read: failing, namespace: NS })).toBeNull();
    expect(findHarnessProcess({ env: {}, ppid: 40, read: table({}), namespace: () => null })).toBe(
      null,
    );
  });

  it.runIf(process.platform === "linux")("finds this test's parent from /proc", () => {
    const harness = findHarnessProcess({ env: {} });
    expect(harness?.pid).toBe(process.ppid);
    expect(harness?.pidNamespace).toBe(pidNamespace());
  });
});

describe("a registration records its harness process", () => {
  const HARNESS: HarnessProcess = { pid: 4242, startTime: 99, pidNamespace: "pid:[1]" };
  const deps = (overrides: Partial<HookDeps> = {}): HookDeps => ({
    env: {},
    ensureDaemon: async () => "alive",
    harnessProcess: () => HARNESS,
    ...overrides,
  });

  it("at SessionStart and SubagentStart, and SessionEnd forgets it", async () => {
    const r = squealRepo();
    await runHook("session-start", recorded("session-start", r.root), deps());
    await runHook("session-start", recorded("subagent-start", r.root), deps());
    expect(harnessOf(r.store, r.consumer())).toEqual(HARNESS);
    expect(harnessOf(r.store, r.consumer(SUBAGENT))).toEqual(HARNESS);

    await runHook("session-end", recorded("session-end", r.root), deps());

    expect(harnessOf(r.store, r.consumer())).toBeNull();
    expect(r.store.consumers.list(r.worktreeId)).toEqual([]);
  });

  it("from the process of the latest registration: a resume moves the session", async () => {
    const r = squealRepo();
    await runHook("session-start", recorded("session-start", r.root), deps());
    const resumed: HarnessProcess = { ...HARNESS, pid: 5151 };
    await runHook(
      "session-start",
      recorded("session-start", r.root, { source: "resume", session_id: SESSION }),
      deps({ harnessProcess: () => resumed }),
    );
    expect(harnessOf(r.store, r.consumer())).toEqual(resumed);
  });

  it("records none when the hook names no process", async () => {
    const r = squealRepo();
    await runHook(
      "session-start",
      recorded("session-start", r.root),
      deps({ harnessProcess: () => null }),
    );
    expect(r.store.consumers.get(r.consumer())).not.toBeNull();
    expect(harnessOf(r.store, r.consumer())).toBeNull();
  });
});
