import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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

const STORE = pathToFileURL(
  resolve(import.meta.dirname, "../../../src/core/runner-host/remote/machines-store.ts"),
).href;

const scratch = mkdtempSync(join(tmpdir(), "squeal-machines-lock-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/*
 * Review 0.1.616-r2 S1's schedule, forced in two writer processes. Each writer
 * wraps Node's filesystem functions (no return value changes) and pauses at a
 * native call boundary until the test writes a signal file:
 * - `a` pauses right after it creates the lock (`openSync(lock, "wx")`) or
 *   publishes it (`linkSync(owner, lock)`), and signals `a-paused`;
 * - `b` signals `b-read` and pauses after it reads `remote-machines.json`, or
 *   signals `b-waiting` when it sleeps on a held lock.
 */
const PAUSING_WRITER = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
const [state, role, signals] = process.argv.slice(2);
const wait = Atomics.wait.bind(Atomics);
const cell = new Int32Array(new SharedArrayBuffer(4));
const signal = (name) => fs.writeFileSync(join(signals, name), "");
const pauseUntil = (name) => {
  while (!fs.existsSync(join(signals, name))) wait(cell, 0, 0, 5);
};
const { openSync, linkSync, readFileSync } = fs;
if (role === "a") {
  let paused = false;
  const pause = () => {
    if (paused) return;
    paused = true;
    signal("a-paused");
    pauseUntil("go-a");
  };
  fs.openSync = (path, flags, ...rest) => {
    const fd = openSync(path, flags, ...rest);
    if (String(path).endsWith(".lock") && flags === "wx") pause();
    return fd;
  };
  fs.linkSync = (from, to) => {
    linkSync(from, to);
    if (String(to).endsWith(".lock")) pause();
  };
} else {
  let paused = false;
  fs.readFileSync = (path, ...rest) => {
    const value = readFileSync(path, ...rest);
    if (!paused && String(path).endsWith("remote-machines.json")) {
      paused = true;
      signal("b-read");
      pauseUntil("go-b");
    }
    return value;
  };
  Atomics.wait = (...args) => {
    if (!fs.existsSync(join(signals, "b-waiting"))) signal("b-waiting");
    return wait(...args);
  };
}
syncBuiltinESMExports();
const { recordMachine } = await import(${JSON.stringify(STORE)});
recordMachine(
  {
    provider: "command",
    id: "cmd:" + role,
    worktreeId: role,
    worktreeRoot: "/repo/" + role,
    repositoryKey: "/repo",
    destination: "dev@host",
    sshArgs: [],
    places: { node: "node", cache: ".squeal-remote" },
    capabilities: { hasGitRepository: false, sleepOnIdle: true, ephemeralHostKey: false },
    status: "awake",
    createdAt: 1,
    lastUsedAt: 1,
  },
  { XDG_STATE_HOME: state, HOME: state },
);
`;

async function until(names: readonly string[], dir: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const found = names.find((name) => existsSync(join(dir, name)));
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error(`no ${names.join(" or ")} in 30 s`);
    await new Promise((done) => setTimeout(done, 5));
  }
}

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

  it("keeps both records when a writer pauses right after it takes the lock (review 0.1.616-r2 S1)", {
    timeout: 60_000,
  }, async () => {
    const state = join(scratch, "pause");
    const signals = join(scratch, "pause-signals");
    mkdirSync(signals, { recursive: true });
    mkdirSync(join(state, "squeal"), { recursive: true });
    writeFileSync(
      machinesPath({ XDG_STATE_HOME: state }),
      `${JSON.stringify({ v: 1, machines: [] })}\n`,
    );
    const script = join(scratch, "pausing-writer.mjs");
    writeFileSync(script, PAUSING_WRITER);
    const writer = (role: string) =>
      run(process.execPath, ["--import", TSX, script, state, role, signals], { timeout: 50_000 });
    const a = writer("a");
    await until(["a-paused"], signals);
    const b = writer("b");
    // Before the repair `b` removed `a`'s empty lock and read the file; now it waits.
    const reached = await until(["b-read", "b-waiting"], signals);
    writeFileSync(join(signals, "go-a"), "");
    await a;
    writeFileSync(join(signals, "go-b"), "");
    await b;
    const ids = readMachines({ XDG_STATE_HOME: state }).machines.map((m) => m.worktreeId);
    expect({ reached, ids: [...ids].sort() }).toEqual({ reached: "b-waiting", ids: ["a", "b"] });
  });

  it.each([
    ["a holder that died", "999999999 gone\n"],
    ["a holder that died before it wrote its owner", ""],
  ])("takes over an old lock of %s", (_, text) => {
    const state = join(scratch, `stale-${text.length}`);
    const env = { XDG_STATE_HOME: state, HOME: state };
    const path = machinesPath(env);
    mkdirSync(join(state, "squeal"), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ v: 1, machines: [] })}\n`);
    writeFileSync(`${path}.lock`, text);
    const old = new Date(Date.now() - 120_000);
    utimesSync(`${path}.lock`, old, old);
    const started = Date.now();
    updateMachine({ provider: "command", worktreeId: "w" }, { status: "sleeping" }, env);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(existsSync(`${path}.lock`)).toBe(false);
  });
});
