import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { onTestFinished } from "vitest";
import { readDaemonNotes } from "../../src/core/notes.js";
import { processIdentity } from "../../src/core/scheduler/command-hold.js";
import {
  addCommandHold,
  type CommandHoldEntry,
  readCommandHolds,
} from "../../src/core/scheduler/hold-rows.js";
import type { HarnessProcess } from "../../src/core/types/index.js";
import type { CatchUpFile, CatchUpSide } from "./catch-up-fixture.js";

/*
 * Row 011-74 (011 C9 as amended 2026-10-21, *Hold command*;
 * `tasks/011-61/design.md` R3): a command hold's entry written as `squeal
 * hold` writes it, over processes the test starts and ends.
 */

/** A process that lives until the test kills it or the test ends. */
export interface Held {
  readonly child: ChildProcess;
  readonly identity: HarnessProcess;
  /** Kills it and waits for its exit, so `/proc` no longer lists it. */
  end(): Promise<void>;
}

/** Starts `sleep 600`, killed when the test finishes. */
export async function liveProcess(): Promise<Held> {
  const child = spawn("sleep", ["600"], { stdio: "ignore" });
  await new Promise((resolve) => child.once("spawn", resolve));
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const end = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  };
  onTestFinished(end);
  const identity = processIdentity(child.pid ?? 0);
  if (identity === null) throw new Error("no /proc identity for the live process");
  return { child, identity, end };
}

/** `side`'s worktree gets an entry held by `child`, the test process as its wrapper unless given. */
export function hold(
  side: Pick<CatchUpSide, "store" | "worktreeId">,
  child: HarnessProcess | null,
  options: {
    readonly command?: string;
    readonly ms?: number;
    readonly wrapper?: HarnessProcess | null;
  } = {},
): CommandHoldEntry {
  const since = Date.now();
  const entry: CommandHoldEntry = {
    token: randomUUID(),
    since,
    until: since + (options.ms ?? 600_000),
    command: options.command ?? "npm run gate",
    wrapper: options.wrapper === undefined ? processIdentity(process.pid) : options.wrapper,
    child,
  };
  addCommandHold(side.store, side.worktreeId, entry);
  return entry;
}

/** The tokens `side`'s command-hold row holds. */
export const tokens = (side: Pick<CatchUpSide, "store" | "worktreeId">): string[] =>
  readCommandHolds(side.store, side.worktreeId).map((e) => e.token);

/** The notes `side`'s scheduler wrote, oldest first. */
export const notes = (side: Pick<CatchUpSide, "store" | "worktreeId">): string[] =>
  readDaemonNotes(side.store, side.worktreeId).map((n) => n.text);

/** `count` test files of `realMs` each, importing `src/held.ts`. */
export const heldFiles = (count: number, realMs: number): CatchUpFile[] =>
  Array.from({ length: count }, (_, i) => ({
    path: `test/h${i}.test.ts`,
    ms: realMs,
    realMs,
    imports: ["src/held.ts"],
  }));

export const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));
