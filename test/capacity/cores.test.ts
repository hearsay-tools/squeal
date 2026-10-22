import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createTreeCpu } from "../../src/core/capacity/cores.js";

/*
 * 011 C10 Size as amended 2026-10-21 (row 011-98): each daemon with a tier
 * running measures the CPU its process tree used since the last refresh:
 * its own, its test processes', what they started, and the children they
 * reaped. A fixture `/proc` holds the tree; ticks are 100 a second.
 */

let root: string;
let clock: number;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-cores-"));
  clock = 0;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface Proc {
  readonly pid: number;
  readonly ppid: number;
  /** User plus system ticks; written as two thirds and one third. */
  readonly ticks: number;
  /** The ticks of the children it waited for. */
  readonly reaped?: number;
  readonly children?: readonly number[];
  readonly start?: number;
}

/** Writes `procs` as the whole `/proc` of the fixture: those absent left. */
function write(procs: readonly Proc[]): void {
  rmSync(join(root, "proc"), { recursive: true, force: true });
  for (const p of procs) {
    const dir = join(root, "proc", String(p.pid));
    mkdirSync(join(dir, "task", String(p.pid)), { recursive: true });
    const stime = Math.floor(p.ticks / 3);
    const cstime = Math.floor((p.reaped ?? 0) / 3);
    const fields = ["S", p.ppid, p.ppid, 0, 0, -1, 0, 0, 0, 0, 0];
    fields.push(p.ticks - stime, stime, (p.reaped ?? 0) - cstime, cstime, 30, 10, 1, 0);
    fields.push(p.start ?? 1_000);
    writeFileSync(join(dir, "stat"), `${p.pid} (node) ${fields.join(" ")} 0 0\n`);
    writeFileSync(join(dir, "task", String(p.pid), "children"), (p.children ?? []).join(" "));
  }
}

const DAEMON = 100;
const tree = () => createTreeCpu({ pid: DAEMON, root, now: () => clock });

describe("the CPU of a daemon's process tree (row 011-98)", () => {
  test("is the growth of the daemon's and its descendants' ticks over the window, in cores", () => {
    write([
      { pid: DAEMON, ppid: 1, ticks: 1_000, children: [200] },
      { pid: 200, ppid: DAEMON, ticks: 500, children: [300] },
      { pid: 300, ppid: 200, ticks: 100 },
      // Not below the daemon: another daemon's worker.
      { pid: 400, ppid: 1, ticks: 9_000 },
    ]);
    const cpu = tree();
    expect(cpu?.read()).toBeNull();
    clock += 10_000;
    write([
      { pid: DAEMON, ppid: 1, ticks: 1_100, children: [200] },
      { pid: 200, ppid: DAEMON, ticks: 1_200, children: [300] },
      { pid: 300, ppid: 200, ticks: 400 },
      { pid: 400, ppid: 1, ticks: 99_000 },
    ]);
    // 100 + 700 + 300 ticks are 11 s of CPU in 10 s.
    expect(cpu?.read()).toBeCloseTo(1.1);
  });

  test("counts a child that ended between two reads, through its parent's reaped children's times", () => {
    write([
      { pid: DAEMON, ppid: 1, ticks: 1_000, children: [200] },
      { pid: 200, ppid: DAEMON, ticks: 500 },
    ]);
    const cpu = tree();
    cpu?.read();
    clock += 10_000;
    // The worker used 800 more ticks and ended; the daemon waited for it: 1,300 ticks in its children's times.
    write([{ pid: DAEMON, ppid: 1, ticks: 1_000, reaped: 1_300 }]);
    expect(cpu?.read()).toBeCloseTo(0.8);
  });

  test("counts a process born and ended within the window, once its parent waited for it", () => {
    write([{ pid: DAEMON, ppid: 1, ticks: 1_000 }]);
    const cpu = tree();
    cpu?.read();
    clock += 10_000;
    write([{ pid: DAEMON, ppid: 1, ticks: 1_000, reaped: 2_000 }]);
    expect(cpu?.read()).toBeCloseTo(2);
  });

  test("starts a new window after a reset, and is none where the daemon's tree cannot be read", () => {
    write([{ pid: DAEMON, ppid: 1, ticks: 1_000 }]);
    const cpu = tree();
    cpu?.read();
    cpu?.reset();
    clock += 10_000;
    write([{ pid: DAEMON, ppid: 1, ticks: 2_000 }]);
    expect(cpu?.read()).toBeNull();
    expect(createTreeCpu({ pid: 999, root, now: () => clock })).toBeNull();
  });
});
