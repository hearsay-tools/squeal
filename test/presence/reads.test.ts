import { describe, expect, it, vi } from "vitest";
import { rowReads } from "./reads-rows.js";
import { stopRowReads } from "./reads-stop.js";
import { rows } from "./rows.js";
import { stopRows } from "./rows-stop.js";
import { traceView, VIEWS } from "./trace.js";

/*
 * Row 011-293, review 0.1.403-r2 B2: the table's expected-reads column. For
 * each row and each view, the reads the view makes, in order, are the ones
 * stated (`reads-rows.ts`, `reads-stop.ts`): what the old code at 4204b3d47
 * read, less the reductions `tasks/011-293/notes.md` section R2 names. The
 * mocks log each mark file read and each lock probe into `traceLog`.
 */

const log = vi.hoisted(() => {
  const shared = globalThis as { __presenceTrace?: { events: string[]; on: boolean } };
  shared.__presenceTrace ??= { events: [], on: false };
  return shared.__presenceTrace;
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readFileSync = ((path: unknown, ...rest: unknown[]) => {
    const name = String(path);
    if (log.on && name.endsWith(".starting")) log.events.push(".starting");
    if (log.on && name.endsWith(".spawned")) log.events.push(".spawned");
    return (actual.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof actual.readFileSync;
  return { ...actual, readFileSync };
});

vi.mock("../../src/core/daemon/lock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/daemon/lock.js")>();
  return {
    ...actual,
    acquireDaemonLock: (...args: Parameters<typeof actual.acquireDaemonLock>) => {
      if (log.on) log.events.push("probe");
      return actual.acquireDaemonLock(...args);
    },
  };
});

const expected = { ...rowReads, ...stopRowReads };
const cases = [...rows, ...stopRows].flatMap((row) => VIEWS.map((view) => ({ row, view })));

describe("daemon presence: each view reads as the old readers did (review 0.1.403-r2 B2)", () => {
  it("states the reads of every row of the table, and of no other", () => {
    expect(Object.keys(expected).sort()).toEqual([...rows, ...stopRows].map((r) => r.name).sort());
  });

  it.each(cases)("$row.name: $view", ({ row, view }) => {
    expect(traceView(row, view).reads).toBe(expected[row.name]?.[view]);
  });
});
