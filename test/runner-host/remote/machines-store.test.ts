import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  forgetMachine,
  machinesPath,
  readMachines,
  recordMachine,
  updateMachine,
} from "../../../src/core/runner-host/remote/machines-store.js";
import type { MachineRecord } from "../../../src/core/runner-host/remote/provider.js";

/*
 * Spec 026 D12 (row 026-10): `remote-machines.json` under the user's
 * state directory. Every case names its own; none reads the real home.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-machines-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
const fresh = () => ({ XDG_STATE_HOME: join(scratch, `s${++n}`), HOME: join(scratch, "home") });

function machineRecord(over: Partial<MachineRecord> = {}): MachineRecord {
  return {
    provider: "command",
    id: "cmd:lan",
    worktreeId: "w1",
    worktreeRoot: "/repo",
    repositoryKey: "/repo",
    destination: "dev@host",
    sshArgs: [],
    places: { node: "node", cache: ".squeal-remote" },
    capabilities: { hasGitRepository: false, sleepOnIdle: true, ephemeralHostKey: false },
    status: "awake",
    createdAt: 1,
    lastUsedAt: 1,
    ...over,
  };
}

describe("the remote machines file (row 026-10)", () => {
  it("lives under XDG_STATE_HOME, else ~/.local/state", () => {
    expect(machinesPath({ XDG_STATE_HOME: "/s", HOME: "/h" })).toBe(
      "/s/squeal/remote-machines.json",
    );
    expect(machinesPath({ XDG_STATE_HOME: "relative", HOME: "/h" })).toBe(
      "/h/.local/state/squeal/remote-machines.json",
    );
  });

  it("tracks none without the file", () => {
    expect(readMachines(fresh()).machines).toEqual([]);
  });

  it("records, updates and forgets by provider and worktree", () => {
    const env = fresh();
    recordMachine(machineRecord(), env);
    recordMachine(machineRecord({ worktreeId: "w2", worktreeRoot: "/other" }), env);
    recordMachine(machineRecord({ destination: "dev@new" }), env);
    expect(readMachines(env).machines.map((m) => [m.worktreeId, m.destination])).toEqual([
      ["w2", "dev@host"],
      ["w1", "dev@new"],
    ]);
    updateMachine({ provider: "command", worktreeId: "w1" }, { status: "sleeping" }, env);
    updateMachine({ provider: "ssh", worktreeId: "w1" }, { status: "detached" }, env);
    expect(readMachines(env).machines.find((m) => m.worktreeId === "w1")?.status).toBe("sleeping");
    forgetMachine({ provider: "command", worktreeId: "w2" }, env);
    expect(readMachines(env).machines.map((m) => m.worktreeId)).toEqual(["w1"]);
    expect(statSync(machinesPath(env)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(machinesPath(env), "utf8")).v).toBe(1);
  });

  it("names a file that is not its shape, and tracks none from it", () => {
    const env = fresh();
    mkdirSync(join(env.XDG_STATE_HOME, "squeal"), { recursive: true });
    writeFileSync(machinesPath(env), "{ nope");
    const read = readMachines(env);
    expect(read.machines).toEqual([]);
    expect(read.problem).toBe("is not a remote machines file");
  });
});
