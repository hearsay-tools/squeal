import { describe, expect, it } from "vitest";
import { type ProcessEntry, type ProcessTable, terminate } from "../../src/core/daemon/escaped.js";

/*
 * Review 001-149 S2: a stop reaches a process by pid and start time (001
 * D12). Between the scan and each signal the pid can go and be reused; a
 * process table of the test's own changes identities at chosen moments, so
 * no host pid is churned.
 */

const entry = (pid: number, start: number): ProcessEntry => ({ pid, ppid: 1, pgrp: pid, start });

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
    expect(stopped).toEqual([
      { pid: 10, args: "node 10" },
      { pid: 11, args: "node 11" },
    ]);
  });

  it("neither reads nor signals a pid reused before its command line is read", async () => {
    const { t, signals, reads, reuse } = table([entry(10, 1), entry(11, 2)]);
    reuse(10);
    const stopped = await terminate([entry(10, 1), entry(11, 2)], t);
    expect(reads).toEqual([11]);
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
