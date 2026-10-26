import { setTimeout as sleep } from "node:timers/promises";
import { type EnsuredDaemon, probeDaemon, recordedDaemon } from "../core/daemon/ensure.js";
import { STATUS_BUSY_TIMEOUT_MS } from "../core/status/index.js";
import type { AbsolutePath, PingResponse } from "../core/types/index.js";
import type { CliIo } from "./main.js";
import { statusCommand } from "./status-command.js";

/*
 * `squeal start`'s wait for a daemon to answer and be recorded (rows
 * 011-111 and 011-214, C9).
 */

/**
 * A spawned daemon binds its socket in about 100 ms; a loaded machine gets
 * more: at load 40 on 24 CPUs one took longer than 10 s (gh-94, row 011-214).
 */
const SPAWN_WAIT_MS = 30_000;

/**
 * Row 011-214 (C9): waits up to `SPAWN_WAIT_MS` for the daemon `start`
 * spawned as `pid` (`null` when the spawn failed) to answer and be
 * recorded, then `null`. Otherwise the exit code, said on stderr: 1 once its
 * process ended without an answer; 3 past the bound while it lives, since it
 * may still be starting, as a loaded host makes it (gh-94), and `squeal
 * status` says when. Row 011-219: whether it lives is read from `ended`, its
 * exit or error event, not its pid, which another process may have by then.
 */
export async function spawnedFailed(
  root: AbsolutePath,
  { pid, ended }: Pick<EnsuredDaemon, "pid" | "ended">,
  io: CliIo,
): Promise<number | null> {
  const lives = () => !ended();
  const ready = await served(root, Date.now() + SPAWN_WAIT_MS, () => true, lives);
  if (ready === "served") return null;
  if (ready === "ended") {
    io.stderr(`squeal: spawned a daemon for ${root}, but it exited without answering\n`);
    return 1;
  }
  const command = statusCommand(io.env ?? process.env);
  io.stderr(
    `squeal: the daemon spawned for ${root} (pid ${pid}) is still starting: it has not answered after ${SPAWN_WAIT_MS / 1_000} s; \`${command} status\` says when it serves\n`,
  );
  return 3;
}

/**
 * Row 011-111 (C9): waits until a daemon whose ping `accepts` answers and
 * the store records it, then `served`; at `deadline`, `served` when one
 * answered, else `starting`. A daemon answers on its socket before it
 * registers. Until then status reads no daemon, or in a handoff its claim,
 * so it says the daemon hands over; from its registration on, status reads
 * it serving. Row 011-214: `ended` once the process `lives` names is gone
 * and none answers. That is read before each probe: a loser of the lock
 * exits once the winner is recorded, so the probe after it finds the winner.
 */
export async function served(
  root: AbsolutePath,
  deadline: number,
  accepts: (ping: PingResponse) => boolean,
  lives: () => boolean = () => true,
): Promise<"served" | "starting" | "ended"> {
  for (;;) {
    const ended = !lives();
    const probe = await probeDaemon(root, 100);
    const answered = probe.state === "alive" && accepts(probe.ping);
    if (answered && registered(root, probe.ping)) return "served";
    if (ended && !answered) return "ended";
    if (Date.now() > deadline) return answered ? "served" : "starting";
    await sleep(50);
  }
}

/** Whether the store records the daemon of `ping`: its start time, as `follows` reads it. */
function registered(root: AbsolutePath, ping: PingResponse): boolean {
  return recordedDaemon(root, STATUS_BUSY_TIMEOUT_MS)?.startedAt === ping.startedAt;
}
