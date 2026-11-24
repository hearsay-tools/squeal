import { existsSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
  forgetMachine,
  type Machines,
  readMachines,
  updateMachine,
} from "../core/runner-host/remote/machines-store.js";
import type { MachineRecord, RemoteMachine } from "../core/runner-host/remote/provider.js";
import { providerOf } from "../core/runner-host/remote/providers/index.js";
import { loadRemoteSettings } from "../core/runner-host/remote/settings.js";
import type { CliIo } from "./main.js";

/*
 * Spec 026 D12.3 to D12.5 (row 026-10): the remote machines the lanes
 * acquired, as `$XDG_STATE_HOME/squeal/remote-machines.json` records them.
 * `list` shows them; `sleep` asks a worktree's machine to sleep now; `prune`
 * releases (`worktree-removed`) each machine whose worktree is gone, which
 * stops a cloud machine's disk charges. None needs a daemon. A machine's
 * hooks come from the user's `remote.json` entry it was acquired under.
 */

const USAGE = "usage: squeal remote list [--json] | sleep [<worktree>] | prune [--dry-run]\n";

/** Exit 1: a machine could not be reached, slept or released, or the file could not be read. */
const FAILED = 1;

export async function remoteCommand(args: readonly string[], io: CliIo): Promise<number> {
  const [sub, ...rest] = args;
  const env = (io.env ?? process.env) as NodeJS.ProcessEnv;
  if (sub === "list" && rest.every((arg) => arg === "--json")) {
    return list(io, env, rest.includes("--json"));
  }
  if (sub === "sleep" && rest.length <= 1 && !rest[0]?.startsWith("-"))
    return sleep(io, env, rest[0]);
  if (sub === "prune" && rest.every((arg) => arg === "--dry-run")) {
    return prune(io, env, rest.includes("--dry-run"));
  }
  io.stderr(USAGE);
  return 2;
}

/** The machines, or `null` after naming the file's problem. */
function machinesOf(io: CliIo, env: NodeJS.ProcessEnv): Machines | null {
  const machines = readMachines(env);
  if (machines.problem === undefined) return machines;
  io.stderr(`squeal remote: ${machines.path} ${machines.problem}\n`);
  return null;
}

function list(io: CliIo, env: NodeJS.ProcessEnv, json: boolean): number {
  const read = machinesOf(io, env);
  if (read === null) return FAILED;
  const rows = read.machines.map((m) => ({ ...m, worktreeExists: existsSync(m.worktreeRoot) }));
  if (json) {
    io.stdout(`${JSON.stringify({ path: read.path, machines: rows }, null, 2)}\n`);
    return 0;
  }
  if (rows.length === 0) {
    io.stdout(`No remote machines tracked (${read.path}).\n`);
    return 0;
  }
  const lines = rows.map(
    (m) =>
      `${m.id}  ${m.provider}  ${m.status}  ${m.worktreeRoot}${m.worktreeExists ? "" : " (worktree removed)"}  last used ${new Date(m.lastUsedAt).toISOString()}`,
  );
  io.stdout(`Remote machines (${read.path}):\n${lines.map((l) => `  ${l}\n`).join("")}`);
  return 0;
}

/** The machine of `record`, reached again with its `remote.json` entry's config; else why not. */
function reattach(record: MachineRecord, env: NodeJS.ProcessEnv): RemoteMachine | string {
  const provider = providerOf(record.provider);
  if (provider === null) return `no remote provider "${record.provider}" in this Squeal`;
  const lane = loadRemoteSettings(env).repositories[record.repositoryKey];
  if (lane === undefined || lane.provider !== record.provider) {
    return `remote.json names no ${record.provider} lane for ${record.repositoryKey}`;
  }
  return provider.reattach(record, lane.providerConfig, env);
}

/** The records of the worktree at `path` or holding it: the longest root wins. */
function recordsOf(machines: readonly MachineRecord[], path: string): MachineRecord[] {
  const holding = machines.filter(
    (m) => path === m.worktreeRoot || path.startsWith(`${m.worktreeRoot}${sep}`),
  );
  const longest = Math.max(...holding.map((m) => m.worktreeRoot.length));
  return holding.filter((m) => m.worktreeRoot.length === longest);
}

async function sleep(
  io: CliIo,
  env: NodeJS.ProcessEnv,
  worktree: string | undefined,
): Promise<number> {
  const read = machinesOf(io, env);
  if (read === null) return FAILED;
  const asked = resolve(io.cwd ?? process.cwd(), worktree ?? ".");
  const path = existsSync(asked) ? realpathSync(asked) : asked;
  const records = recordsOf(read.machines, path);
  if (records.length === 0) {
    io.stderr(`squeal remote sleep: no remote machine is tracked for ${path}\n`);
    return FAILED;
  }
  let code = 0;
  for (const record of records) {
    const machine = reattach(record, env);
    try {
      if (typeof machine === "string") throw new Error(machine);
      await machine.sleep();
      updateMachine(record, { status: "sleeping" }, env);
      io.stdout(`${record.id}: asked to sleep\n`);
    } catch (error) {
      io.stderr(`${record.id}: not slept: ${(error as Error).message}\n`);
      code = FAILED;
    }
  }
  return code;
}

async function prune(io: CliIo, env: NodeJS.ProcessEnv, dryRun: boolean): Promise<number> {
  const read = machinesOf(io, env);
  if (read === null) return FAILED;
  const gone = read.machines.filter((m) => !existsSync(m.worktreeRoot));
  if (gone.length === 0) {
    io.stdout("No tracked remote machine has a removed worktree.\n");
    return 0;
  }
  let code = 0;
  for (const record of gone) {
    const what = `${record.id} (${record.provider}) of removed worktree ${record.worktreeRoot}`;
    if (dryRun) {
      io.stdout(`would release ${what}\n`);
      continue;
    }
    const machine = reattach(record, env);
    try {
      if (typeof machine === "string") throw new Error(machine);
      await machine.release("worktree-removed");
      forgetMachine(record, env);
      io.stdout(`released ${what}\n`);
    } catch (error) {
      io.stderr(`${what}: not released, still tracked: ${(error as Error).message}\n`);
      code = FAILED;
    }
  }
  return code;
}
