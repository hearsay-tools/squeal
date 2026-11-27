import { existsSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
  type Machines,
  readMachines,
  updateMachine,
} from "../core/runner-host/remote/machines-store.js";
import { machineScope, worktreePresence } from "../core/runner-host/remote/presence.js";
import type { MachineRecord } from "../core/runner-host/remote/provider.js";
import { pruneRemovedWorktrees, reattach } from "../core/runner-host/remote/prune.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { DaemonRequest, DaemonResponse, RemoteSleepOutcome } from "../core/types/daemon.js";
import { askDaemon, daemonSocket } from "./daemon-access.js";
import type { CliIo } from "./main.js";

/*
 * Spec 026 D12.3 to D12.5 (row 026-10): the remote machines the lanes
 * acquired, as `$XDG_STATE_HOME/squeal/remote-machines.json` records them.
 * `list` shows them; `sleep` asks a worktree's machine to sleep now; `prune`
 * releases (`worktree-removed`) each machine whose worktree is gone, which
 * stops a cloud machine's disk charges. None needs a daemon. A machine's
 * hooks come from the user's `remote.json` entry it was acquired under.
 *
 * Review 0.1.616 B7 (D12.4): `sleep` asks the worktree's running daemon
 * first, which closes its idle channel before the machine sleeps and
 * refuses while a run is on it. With no daemon, or a daemon that holds no
 * machine, the machine is reached here. A machine that does not sleep when
 * idle, such as a static `ssh` host, is left as it is.
 */

const USAGE = "usage: squeal remote list [--json] | sleep [<worktree>] | prune [--dry-run]\n";

/** Exit 1: a machine could not be reached, slept or released, or the file could not be read. */
const FAILED = 1;

/** How long `sleep` waits for a daemon's sleep: its hooks' own default deadlines are shorter. */
const SLEEP_WAIT_MS = 180_000;

export interface RemoteDeps {
  /** The answer of the daemon of the worktree at `root`; `null` when none runs. */
  readonly ask?: (root: AbsolutePath, request: DaemonRequest) => Promise<DaemonResponse | null>;
  /** How often `sleep` asks the daemon how its sleep goes. */
  readonly pollMs?: number;
}

export async function remoteCommand(
  args: readonly string[],
  io: CliIo,
  deps: RemoteDeps = {},
): Promise<number> {
  const [sub, ...rest] = args;
  const env = (io.env ?? process.env) as NodeJS.ProcessEnv;
  if (sub === "list" && rest.every((arg) => arg === "--json")) {
    return list(io, env, rest.includes("--json"));
  }
  if (sub === "sleep" && rest.length <= 1 && !rest[0]?.startsWith("-"))
    return sleep(io, env, rest[0], deps);
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
  const presence = new Map(read.machines.map((m) => [m, worktreePresence(m.worktreeRoot)]));
  const rows = read.machines.map((m) => ({ ...m, worktreeExists: presence.get(m) === "present" }));
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
  // Row 026-37 (#301): machines of removed worktrees bill until released.
  // Review 0.1.658 B2: only a path confirmed missing counts, as the prune counts it.
  const orphans = read.machines.filter((m) => presence.get(m) === "gone").length;
  const tail =
    orphans === 0
      ? ""
      : `${orphans} machine${orphans === 1 ? "" : "s"} of removed worktrees; \`squeal remote prune\` releases ${orphans === 1 ? "it" : "them"}.\n`;
  io.stdout(`Remote machines (${read.path}):\n${lines.map((l) => `  ${l}\n`).join("")}${tail}`);
  return 0;
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
  deps: RemoteDeps,
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
  // One worktree's records: its daemon holds at most the machine of its lane.
  const root = records[0]?.worktreeRoot as AbsolutePath;
  const daemon = await daemonSleep(root, deps).catch((error: unknown) => String(error));
  let code = 0;
  for (const record of records) {
    const told = typeof daemon === "string" ? { failed: daemon } : toldBy(daemon, record);
    const line = told ?? (await sleepHere(record, env));
    if ("failed" in line) {
      io.stderr(`${record.id}: not slept: ${line.failed}\n`);
      code = FAILED;
    } else io.stdout(`${record.id}: ${line.done}\n`);
  }
  return code;
}

type Told = { readonly done: string } | { readonly failed: string };

/** What the daemon's `outcome` says of `record`; `null` when it holds no such machine. */
function toldBy(outcome: RemoteSleepOutcome | null, record: MachineRecord): Told | null {
  if (outcome === null || outcome.kind === "none" || outcome.provider !== record.provider) {
    return null;
  }
  if (outcome.kind === "busy") return { failed: outcome.reason };
  return { done: outcome.kind === "slept" ? "asked to sleep" : ALWAYS_ON };
}

const ALWAYS_ON = "always on; nothing to sleep";

/** With no daemon holding it: the machine reached here, asked to sleep, and recorded. */
async function sleepHere(record: MachineRecord, env: NodeJS.ProcessEnv): Promise<Told> {
  if (!record.capabilities.sleepOnIdle) return { done: ALWAYS_ON };
  const machine = reattach(record, env);
  try {
    if (typeof machine === "string") throw new Error(machine);
    await machine.sleep();
    updateMachine(record, { status: "sleeping" }, env);
    return { done: "asked to sleep" };
  } catch (error) {
    return { failed: (error as Error).message };
  }
}

/**
 * The daemon of `root` closes its channel and sleeps its machine: what it
 * did, `null` when no daemon runs, or why it could not (a string).
 */
async function daemonSleep(
  root: AbsolutePath,
  deps: RemoteDeps,
): Promise<RemoteSleepOutcome | null | string> {
  const ask =
    deps.ask ??
    ((at: AbsolutePath, request) => daemonSocket(at).then((s) => askDaemon(s, request)));
  const deadline = performance.now() + SLEEP_WAIT_MS;
  let answer = await ask(root, { type: "remote-sleep" });
  if (answer === null) return null;
  if (!answer.ok) {
    return `the daemon of ${root} cannot close its remote channel (${answer.error}); run \`squeal stop\` there first`;
  }
  while (answer?.ok === true && answer.type === "remote-sleep") {
    if (answer.settled) return answer.outcome ?? answer.error ?? "the daemon's sleep failed";
    if (performance.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, deps.pollMs ?? 100));
    answer = await ask(root, { type: "remote-sleep-status", requestId: answer.requestId });
  }
  return answer === null
    ? `the daemon of ${root} ended during the sleep`
    : `the daemon of ${root} did not finish the sleep`;
}

/** Review 0.1.658 N1: ` (recorded in <scope>)` for a record of another host or mount namespace. */
function foreign(record: MachineRecord): string {
  return record.scope === undefined || record.scope === machineScope()
    ? ""
    : ` (recorded in ${record.scope})`;
}

async function prune(io: CliIo, env: NodeJS.ProcessEnv, dryRun: boolean): Promise<number> {
  const what = (r: MachineRecord) =>
    `${r.id} (${r.provider}) of removed worktree ${r.worktreeRoot}`;
  const result = await pruneRemovedWorktrees({
    env,
    dryRun,
    report: (outcome) => {
      if (outcome.kind === "failed") {
        io.stderr(`${what(outcome.record)}: not released, still tracked: ${outcome.error}\n`);
      } else if (outcome.kind === "kept") {
        const r = outcome.record;
        io.stdout(
          `kept ${r.id} (${r.provider}) of worktree ${r.worktreeRoot}: ${outcome.reason}\n`,
        );
      } else {
        const verb = outcome.kind === "released" ? "released" : "would release";
        io.stdout(`${verb} ${what(outcome.record)}${foreign(outcome.record)}\n`);
      }
    },
  });
  if (result.problem !== undefined) {
    io.stderr(`squeal remote: ${result.problem.path} ${result.problem.text}\n`);
    return FAILED;
  }
  if (result.gone === 0) {
    io.stdout("No tracked remote machine has a removed worktree.\n");
    return 0;
  }
  return result.outcomes.some((o) => o.kind === "failed") ? FAILED : 0;
}
