import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  type PiMessage,
  type PiRequest,
  type PiRunOptions,
  runPi,
  textOf,
} from "../../helpers/pi.js";
import { tempDir } from "../../store/helpers.js";
import { liveSocket, quietCli, runtimeDir } from "../bundle-helpers.js";
import type { SquealRepo } from "../helpers.js";

/*
 * Real Pi 1.0.4 with the fake provider and the shipped extension bundle,
 * in a Squeal fixture repository (spec 009 Testing). A planned `bash` call
 * is a gate: it signals the test and waits, so the test lands a result at a
 * known point of the run, as the daemon would while a tool runs.
 */

/** The environment a gate's `bash` and the extension's worker see. */
export interface PiWorld {
  readonly env: Record<string, string>;
  readonly marks: string;
  /** Whether the extension spawned the CLI as a daemon. */
  spawnedDaemon(): boolean;
}

/**
 * `XDG_RUNTIME_DIR` with a socket standing in for a live daemon of `r`
 * (none with `daemon: "dead"`), and the CLI as a stand-in that never serves.
 */
export async function piWorld(
  r: SquealRepo | null,
  daemon: "live" | "dead" = "live",
): Promise<PiWorld> {
  const runtime = runtimeDir();
  if (r !== null && daemon === "live") {
    await liveSocket(join(runtime, `squeal-${r.worktreeId}.sock`));
  }
  const quiet = quietCli();
  const marks = tempDir("squeal-pi-marks-");
  return {
    env: { XDG_RUNTIME_DIR: runtime, SQUEAL_CLI: quiet.cli, SQUEAL_TEST_MARKS: marks },
    marks,
    spawnedDaemon: () => existsSync(quiet.ran),
  };
}

/** A planned `bash` call that waits at gate `n` until the test opens it. */
export function gateCall(n: number) {
  const go = `"$SQUEAL_TEST_MARKS/go.${n}"`;
  const open = `"$SQUEAL_TEST_MARKS/open.${n}"`;
  return {
    name: "bash",
    arguments: {
      command: `echo "$PI_FIXTURE_LOG" > ${go}; while [ ! -f ${open} ]; do sleep 0.02; done; echo gate ${n}`,
    },
  };
}

/**
 * Runs `then` when the gate's `bash` reaches it, then opens the gate and
 * resolves the fake provider's request log; `null` when Pi ended first.
 */
export async function atGate(
  world: PiWorld,
  n: number,
  done: () => boolean,
  then: () => Promise<void> | void = () => {},
): Promise<string | null> {
  const go = join(world.marks, `go.${n}`);
  while (!existsSync(go)) {
    if (done()) return null;
    await sleep(20);
  }
  await then();
  writeFileSync(join(world.marks, `open.${n}`), "");
  return readFileSync(go, "utf8").trim();
}

/**
 * Lands `then` while the final request is in flight: after gate 0 opens and
 * the fake provider has received request `n`.
 */
export async function duringRequest(
  world: PiWorld,
  n: number,
  done: () => boolean,
  then: () => void,
): Promise<void> {
  const log = await atGate(world, 0, done);
  if (log === null) return;
  await requestStarted(log, n, done);
  if (!done()) then();
}

/** Resolves once the fake provider has received request `n` (its log has `n + 1` lines). */
export async function requestStarted(log: string, n: number, done: () => boolean): Promise<void> {
  const lines = () =>
    existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  while (lines().length <= n && !done()) await sleep(10);
}

/** `runPi` with the extension bundle, running `beside` alongside until Pi exits. */
export async function runWithExtension(
  extension: string,
  options: PiRunOptions,
  beside: (done: () => boolean) => Promise<void> = async () => {},
) {
  let finished = false;
  const done = () => finished;
  const run = runPi({ ...options, extensions: [extension] }).finally(() => {
    finished = true;
  });
  const [result] = await Promise.all([run, beside(done)]);
  return result;
}

/** The messages of `request` that Squeal added: plain user text naming Squeal (D3). */
export function squealMessages(request: PiRequest | undefined): PiMessage[] {
  return (request?.messages ?? []).filter(
    (message) => message.role !== "toolResult" && textOf(message).startsWith("SQUEAL"),
  );
}

/** The last message of `request`. */
export const lastMessage = (request: PiRequest | undefined) => request?.messages.at(-1);
