import { setTimeout as sleep } from "node:timers/promises";
import { resolveCommonDir } from "../core/fs/index.js";
import { formatStatus, readStatus } from "../core/status/index.js";
import { isStoreOpenFailure, openStore } from "../core/store/index.js";
import type { AbsolutePath, CheckpointRecord, RunAllResponse } from "../core/types/index.js";
import { askDaemon, daemonSocket, worktreeRoot } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import { statusCommand } from "./status-command.js";

const USAGE = "usage: squeal run --all [--force] [--wait]\n";
/** Without `--wait`, how long to wait for the scheduler to record the checkpoint. */
const RECORD_WAIT_MS = 10_000;
const POLL_MS = 100;

/**
 * `squeal run --all [--force] [--wait]`: an explicit checkpoint (spec 001
 * D5), requested over the daemon socket. Prints the checkpoint once the
 * scheduler recorded it; with `--wait`, polls the store until it ends and
 * prints status. Exit code 0 when requested (or completed with `--wait`), 1
 * when no daemon runs, the request failed, or the checkpoint was abandoned.
 */
export async function runCommand(args: readonly string[], io: CliIo): Promise<number> {
  const flags = new Set(args);
  const unknown = args.filter((a) => !["--all", "--force", "--wait"].includes(a));
  if (!flags.has("--all") || unknown.length > 0) {
    io.stderr(
      `squeal run: ${unknown.length > 0 ? `unknown argument "${unknown[0]}"` : "--all is required"}\n${USAGE}`,
    );
    return 2;
  }
  const root = worktreeRoot(undefined, io);
  if (root === null) return 1;
  const socketPath = await daemonSocket(root);
  const response = await askDaemon(socketPath, { type: "run-all", force: flags.has("--force") });
  if (response === null) {
    io.stderr(`squeal: no daemon running for ${root}; start one with squeal start\n`);
    return 1;
  }
  if (!response.ok || response.type !== "run-all") {
    io.stderr(`squeal: run --all failed: ${response.ok ? "unexpected answer" : response.error}\n`);
    return 1;
  }
  const wait = flags.has("--wait");
  const checkpoint = await recorded(socketPath, response, wait ? null : RECORD_WAIT_MS, io);
  if (checkpoint === null) return 1;
  io.stdout(
    `Checkpoint ${checkpoint.id} started at revision ${checkpoint.revision}: ${checkpoint.testFiles.length} test files\n`,
  );
  if (!wait) return 0;
  const end = await ended(root, socketPath, checkpoint.id);
  if (end === null) {
    io.stderr(`squeal: the daemon stopped before checkpoint ${checkpoint.id} ended\n`);
    return 1;
  }
  io.stdout(`Checkpoint ${checkpoint.id} ${end}\n\n`);
  const now = io.now ?? Date.now;
  io.stdout(formatStatus(readStatus(root, { now }), now(), statusCommand(io.env ?? process.env)));
  return end === "completed" ? 0 : 1;
}

/** Polls the daemon until the scheduler recorded the request's checkpoint. */
async function recorded(
  socketPath: AbsolutePath,
  first: RunAllResponse,
  timeoutMs: number | null,
  io: CliIo,
): Promise<CheckpointRecord | null> {
  const deadline = timeoutMs === null ? Number.POSITIVE_INFINITY : Date.now() + timeoutMs;
  let state: RunAllResponse = first;
  for (;;) {
    if (state.checkpoint !== null) return state.checkpoint;
    if (state.error !== null) {
      io.stderr(`squeal: run --all failed: ${state.error}\n`);
      return null;
    }
    if (Date.now() > deadline) {
      io.stdout(
        `Run requested (request ${first.requestId}); the daemon records the checkpoint once its current work allows\n`,
      );
      return null;
    }
    await sleep(POLL_MS);
    const next = await askDaemon(socketPath, {
      type: "run-all-status",
      requestId: first.requestId,
    });
    if (next === null || !next.ok || next.type !== "run-all") {
      io.stderr("squeal: the daemon stopped before recording the checkpoint\n");
      return null;
    }
    state = next;
  }
}

/** Polls the store until the checkpoint ends; `null` when the daemon went away first. */
async function ended(
  root: AbsolutePath,
  socketPath: AbsolutePath,
  id: string,
): Promise<CheckpointRecord["end"]> {
  const commonDir = resolveCommonDir(root);
  if (commonDir === null) return null;
  for (let polls = 0; ; polls++) {
    const store = openStore(commonDir, { create: false, busyTimeoutMs: 1_000 });
    if (isStoreOpenFailure(store)) return null;
    let end: CheckpointRecord["end"];
    try {
      end = store.checkpoints.get(id)?.end ?? null;
    } finally {
      store.close();
    }
    if (end !== null) return end;
    // A killed daemon never ends its checkpoint; check that it is still there now and then.
    if (polls % 20 === 19 && (await askDaemon(socketPath, { type: "ping" })) === null) return null;
    await sleep(250);
  }
}
