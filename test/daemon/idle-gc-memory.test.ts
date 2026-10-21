import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { readMemory } from "../../src/core/daemon/idle-gc.js";

/*
 * Row 011-69 (research `daemon-memory.md` 2): the idle GC's real effect. A
 * plain full GC frees a dropped allocation but V8 keeps its pages; the
 * daemon's last-resort GC gives them back. Private memory is read from
 * `/proc`, so only where `readMemory` reads it (review 0.1.241 S1: Linux
 * without `/proc` falls back to RSS). A fresh process: the test worker's own
 * heap would hide the drop.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const CHILD = join(import.meta.dirname, "idle-gc-child.ts");

interface ChildReport {
  readonly kind: string;
  readonly freed: number;
  readonly collected: number;
  readonly lines: readonly string[];
  readonly notes: readonly string[];
  readonly globalGc: string;
  readonly workerGc: string;
}

describe.runIf(readMemory().kind === "private")("the real idle GC (row 011-69)", () => {
  it("lowers private memory a plain GC left after a large allocation was freed", async () => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", "--import", TSX, CHILD],
      { timeout: 60_000 },
    );
    const report = JSON.parse(stdout) as ChildReport;
    expect(report.kind).toBe("private");
    expect(report.notes).toEqual([]);
    // About 350 MiB allocated, a plain GC kept most of the pages (370 to 310 MiB on this
    // host, Node 22 and 24), and the last-resort GC returned them (310 to 25 MiB).
    expect(report.freed - report.collected).toBeGreaterThanOrEqual(150);
    expect(report.lines).toEqual([
      expect.stringMatching(
        /^no tier for 60 s: a last-resort GC took private memory from \d+ to \d+ MiB in a \d+ ms pause$/,
      ),
    ]);
    // The flag went off again: contexts made later, a worker thread's, see no gc.
    expect(report.globalGc).toBe("undefined");
    expect(report.workerGc).toBe("undefined");
  }, 90_000);
});
