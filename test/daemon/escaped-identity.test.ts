import { describe, expect, it } from "vitest";
import {
  describe as note,
  type ProcessEntry,
  type ProcessTable,
  terminate,
} from "../../src/core/daemon/terminate.js";

/*
 * Review 001-149 S2: a stop reaches a process by pid and start time (001
 * D12). Between the scan and each signal the pid can go and be reused; a
 * process table of the test's own changes identities at chosen moments, so
 * no host pid is churned.
 */

const entry = (pid: number, start: number, ppid = 1): ProcessEntry => ({
  pid,
  ppid,
  pgrp: pid,
  start,
});

/** A table whose processes exit on SIGTERM; `reuse` swaps a pid's start time when its step comes. */
function table(entries: readonly ProcessEntry[]) {
  const live = new Map(entries.map((e) => [e.pid, e]));
  const signals: string[] = [];
  const reads: number[] = [];
  const hooks = { onRead: (_pid: number) => {} };
  const t: ProcessTable = {
    stat: (pid) => live.get(pid) ?? null,
    async commandLine(pid) {
      reads.push(pid);
      hooks.onRead(pid);
      return `node ${pid}`;
    },
    uptime: () => 1_000,
    signal(pid, name) {
      signals.push(`${pid} ${name}`);
      if (name === "SIGTERM" || name === "SIGKILL") live.delete(pid);
    },
  };
  const reuse = (pid: number) => live.set(pid, entry(pid, 999));
  return { t, signals, reads, hooks, reuse };
}

describe("terminate: a process by pid and start time (review 001-149 S2)", () => {
  it("signals the processes the scan found, and names them", async () => {
    const { t, signals } = table([entry(10, 1), entry(11, 2)]);
    const stopped = await terminate([entry(10, 1), entry(11, 2)], t);
    expect(signals).toEqual(["10 SIGTERM", "11 SIGTERM"]);
    expect(stopped.map(({ pid, args }) => ({ pid, args }))).toEqual([
      { pid: 10, args: "node 10" },
      { pid: 11, args: "node 11" },
    ]);
  });

  it("neither reads nor signals a pid reused before its command line is read", async () => {
    const { t, signals, reads, reuse } = table([entry(10, 1), entry(11, 2)]);
    reuse(10);
    const stopped = await terminate([entry(10, 1), entry(11, 2)], t);
    // 11, then its parent; never 10.
    expect(reads).toEqual([11, 1]);
    expect(signals).toEqual(["11 SIGTERM"]);
    expect(stopped.map((s) => s.pid)).toEqual([11]);
  });

  it("does not signal a pid reused after its command line was read", async () => {
    const { t, signals, hooks, reuse } = table([entry(10, 1), entry(11, 2)]);
    hooks.onRead = (pid) => {
      if (pid === 11) reuse(10);
    };
    const stopped = await terminate([entry(10, 1), entry(11, 2)], t);
    expect(signals).toEqual(["11 SIGTERM"]);
    expect(stopped.map((s) => s.pid)).toEqual([11]);
  });

  it("checks each identity right before its own SIGTERM (review wave-13b S2)", async () => {
    const { t, signals, reuse } = table([entry(10, 1), entry(11, 2)]);
    // Signalling 10 lets 11's pid be reused before 11's own signal goes out.
    const between: ProcessTable = {
      ...t,
      signal(pid, name) {
        t.signal(pid, name);
        if (pid === 10) reuse(11);
      },
    };
    const stopped = await terminate([entry(10, 1), entry(11, 2)], between);
    expect(signals).toEqual(["10 SIGTERM"]);
    expect(stopped.map((s) => s.pid)).toEqual([10]);
  });

  it("does not SIGKILL a pid reused during the grace", async () => {
    const { t, signals, reuse } = table([entry(10, 1)]);
    // Ignores SIGTERM until the grace ends, by which time its pid holds another process.
    const ignoring: ProcessTable = {
      ...t,
      signal(pid, name) {
        signals.push(`${pid} ${name}`);
        if (name === "SIGTERM") setTimeout(() => reuse(pid), 50);
      },
    };
    await terminate([entry(10, 1)], ignoring);
    expect(signals).toEqual(["10 SIGTERM"]);
  });
});

describe("what a stop's note says of each process (task 001-212)", () => {
  it("names its parent, its age when told to stop, and SIGTERM when that ended it", async () => {
    const { t } = table([entry(5, 100), entry(10, 580, 5)]);
    const stopped = await terminate([entry(10, 580, 5)], t);
    expect(stopped).toEqual([
      { pid: 10, args: "node 10", ppid: 5, parent: "node 5", ageSeconds: 4.2, killed: false },
    ]);
    expect(note(stopped, "a test left running after its tier (run r1)")).toBe(
      "stopped 1 process a test left running after its tier (run r1): 10 node 10 (parent 5 node 5, 4.2 s old, SIGTERM)",
    );
  });

  it("says SIGKILL when the process outlived the grace", async () => {
    const { t, signals } = table([entry(5, 100), entry(10, 580, 5)]);
    const ignoring: ProcessTable = {
      ...t,
      signal(pid, name) {
        if (name === "SIGKILL") t.signal(pid, name);
        else signals.push(`${pid} ${name}`);
      },
    };
    const stopped = await terminate([entry(10, 580, 5)], ignoring);
    expect(signals).toEqual(["10 SIGTERM", "10 SIGKILL"]);
    expect(stopped.map((s) => s.killed)).toEqual([true]);
    expect(note(stopped, "x")).toBe(
      "stopped 1 process x: 10 node 10 (parent 5 node 5, 4.2 s old, SIGKILL after 1 s)",
    );
  });

  it("does not name as its parent a process it was reparented away from during the read", async () => {
    const { t, hooks } = table([entry(5, 100), entry(10, 580, 5)]);
    // The parent exits while its command line is read; the child goes to pid 1.
    hooks.onRead = (pid) => {
      if (pid === 5) t.signal(5, "SIGTERM");
    };
    const reparenting: ProcessTable = {
      ...t,
      stat: (pid) => {
        const found = t.stat(pid);
        return found !== null && pid === 10 && t.stat(5) === null ? { ...found, ppid: 1 } : found;
      },
    };
    const stopped = await terminate([entry(10, 580, 5)], reparenting);
    expect(stopped.map(({ ppid, parent }) => ({ ppid, parent }))).toEqual([
      { ppid: 5, parent: "" },
    ]);
    expect(note(stopped, "x")).toBe(
      "stopped 1 process x: 10 node 10 (parent 5, 4.2 s old, SIGTERM)",
    );
  });

  it("gives a long-lived process's age in minutes or hours", async () => {
    const at = (ageSeconds: number) =>
      note([{ pid: 1, args: "a", ppid: 0, parent: "", ageSeconds, killed: false }], "x");
    expect(at(185.4)).toContain("3 min 5 s old");
    expect(at(7_830)).toContain("2 h 10 min old");
  });
});
