import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import {
  machinesPath,
  readMachines,
  updateMachine,
} from "../../../src/core/runner-host/remote/machines-store.js";

/*
 * Review 0.1.616 S1: every daemon of the user changes the one
 * `remote-machines.json`; a lock beside it makes each read-change-write
 * whole, so two writers in separate processes lose no record.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const WRITER = resolve(import.meta.dirname, "machines-writer-entry.ts");
const run = promisify(execFile);

const scratch = mkdtempSync(join(tmpdir(), "squeal-machines-lock-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("the remote machines file's lock (review 0.1.616 S1)", () => {
  it("keeps every record of two writer processes at once", { timeout: 60_000 }, async () => {
    const state = join(scratch, "two");
    const startAt = Date.now() + 3_000;
    const writer = (name: string) =>
      run(process.execPath, ["--import", TSX, WRITER, state, name, "60", String(startAt)], {
        timeout: 50_000,
      });
    await Promise.all([writer("a"), writer("b")]);
    const ids = readMachines({ XDG_STATE_HOME: state }).machines.map((m) => m.worktreeId);
    expect(ids).toHaveLength(120);
    expect(new Set(ids).size).toBe(120);
  });

  it("takes over a lock its holder left behind", () => {
    const state = join(scratch, "stale");
    const env = { XDG_STATE_HOME: state, HOME: state };
    const path = machinesPath(env);
    mkdirSync(join(state, "squeal"), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ v: 1, machines: [] })}\n`);
    // A holder that died: no such process, and the lock is old.
    writeFileSync(`${path}.lock`, "999999999 gone\n");
    const old = new Date(Date.now() - 120_000);
    utimesSync(`${path}.lock`, old, old);
    const started = Date.now();
    updateMachine({ provider: "command", worktreeId: "w" }, { status: "sleeping" }, env);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
