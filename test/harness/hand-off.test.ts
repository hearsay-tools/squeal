import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { type Consumer, MAIN_AGENT } from "../../src/core/types/index.js";
import { runHook } from "../../src/harness/claude-code/index.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { tempDir } from "../store/helpers.js";
import { codexRecorded } from "./codex/helpers.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Row 011-288 (011 C8 as amended 2026-10-31): a Claude Code or Codex hook
 * commits its report only once its output is written. A hook whose output
 * stalls after the report was prepared, and that its host kills at the
 * deadline, leaves the report owed: the next boundary tells the transition
 * once, and the one after it does not repeat it. The research probe
 * (`research/delivery-receipt.md`) showed the opposite at 0.1.384.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const ENTRY = fileURLToPath(new URL("./child/hand-off-hook.ts", import.meta.url));
const TRANSITION = "PASS -> FAIL";
const deps = (): HookDeps => ({ env: {}, ensureDaemon: async () => "alive" });

interface Harness {
  readonly name: "claude" | "codex";
  readonly boundary: string;
  input(r: SquealRepo, hook: string): string;
  run(hook: string, input: string): Promise<string>;
}

const HARNESSES: readonly Harness[] = [
  {
    name: "claude",
    boundary: "post-tool-batch",
    input: (r, hook) => recorded(hook, r.root),
    run: async (hook, input) => (await runHook(hook as never, input, deps())).stdout,
  },
  {
    name: "codex",
    boundary: "post-tool-use",
    input: (r, hook) => codexRecorded("exec", hook, r.root),
    run: async (hook, input) => (await runCodexHook(hook as never, input, deps())).stdout,
  },
];

interface ChildRun {
  readonly stdout: string;
  readonly signal: NodeJS.Signals | null;
  /** What the stalled write was given; `null` when it was not reached. */
  readonly prepared: string | null;
}

async function until(condition: () => boolean, ms: number, what: () => string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`not met in ${ms} ms; ${what()}`);
    await new Promise((done) => setTimeout(done, 10));
  }
}

/**
 * Runs the boundary hook in a child process through its wrapper. `stall`:
 * its output never completes; `kill`: the host's deadline kills it once the
 * report reached the write, else it is left to end on its own.
 */
async function child(
  h: Harness,
  input: string,
  {
    stall,
    kill,
    slowMs = 0,
    whileHeld,
  }: {
    readonly stall: boolean;
    readonly kill: boolean;
    /** A write that completes this much later; `whileHeld` runs once it started. */
    readonly slowMs?: number;
    readonly whileHeld?: () => Promise<void>;
  },
): Promise<ChildRun> {
  const dir = tempDir("squeal-hand-off-");
  const marker = join(dir, "prepared");
  const proc = spawn(process.execPath, ["--import", TSX, ENTRY, h.name, h.boundary, marker], {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: dir,
      XDG_RUNTIME_DIR: dir,
      ...(stall ? { SQUEAL_TEST_STALL: "1" } : {}),
      ...(slowMs > 0 ? { SQUEAL_TEST_SLOW_MS: String(slowMs) } : {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  proc.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  proc.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const closed = new Promise<NodeJS.Signals | null>((done) =>
    proc.on("close", (_, signal) => done(signal)),
  );
  proc.stdin.end(input);
  if ((stall && kill) || whileHeld !== undefined) {
    await until(
      () => existsSync(marker),
      30_000,
      () => `stderr: ${stderr}`,
    );
  }
  if (stall && kill) proc.kill("SIGKILL");
  await whileHeld?.();
  const signal = await closed;
  return { stdout, signal, prepared: existsSync(marker) ? readFileSync(marker, "utf8") : null };
}

/** A registered session whose check went from PASS to FAIL since, its view still `pass`. */
async function failedSince(h: Harness): Promise<{ r: SquealRepo; consumer: Consumer }> {
  const r = squealRepo();
  r.policy({});
  r.apply(r.pass());
  const start = h.input(r, "session-start");
  await h.run("session-start", start);
  const { session_id } = JSON.parse(start) as { session_id: string };
  const consumer = { worktreeId: r.worktreeId, sessionId: session_id, agentId: MAIN_AGENT };
  expect(r.store.consumers.get(consumer)).not.toBeNull();
  r.apply(r.fail());
  return { r, consumer };
}

const viewOf = (r: SquealRepo, consumer: Consumer) =>
  r.store.views.list(consumer).find((v) => v.check.kind === "test")?.outcome;

const count = (text: string) => text.split(TRANSITION).length - 1;

describe.each(HARNESSES)(
  "$name: a report commits only once its output is written (row 011-288)",
  (h) => {
    it("tells a transition once and commits it, when its output is written", async () => {
      const { r, consumer } = await failedSince(h);
      const run = await child(h, h.input(r, h.boundary), { stall: false, kill: false });
      expect(count(run.stdout)).toBe(1);
      expect(viewOf(r, consumer)).toBe("fail");
      expect(count(await h.run(h.boundary, h.input(r, h.boundary)))).toBe(0);
    }, 60_000);

    it("keeps the transition owed when the host kills the hook after the report, before its output", async () => {
      const { r, consumer } = await failedSince(h);
      const run = await child(h, h.input(r, h.boundary), { stall: true, kill: true });
      expect(run.signal).toBe("SIGKILL");
      expect(run.stdout).toBe("");
      expect(run.prepared).toContain(TRANSITION);
      expect(viewOf(r, consumer)).toBe("pass");
      expect(count(await h.run(h.boundary, h.input(r, h.boundary)))).toBe(1);
      expect(viewOf(r, consumer)).toBe("fail");
      expect(count(await h.run(h.boundary, h.input(r, h.boundary)))).toBe(0);
    }, 60_000);
  },
);

describe("claude: a write that never completes (row 011-288)", () => {
  it("rolls the report back at its bound, with no kill, and the next boundary tells it", async () => {
    const h = HARNESSES[0] as Harness;
    const { r, consumer } = await failedSince(h);
    const run = await child(h, h.input(r, h.boundary), { stall: true, kill: false });
    expect(run.signal).toBeNull();
    expect(run.prepared).toContain(TRANSITION);
    expect(viewOf(r, consumer)).toBe("pass");
    expect(count(await h.run(h.boundary, h.input(r, h.boundary)))).toBe(1);
  }, 60_000);
});

describe("claude: another consumer beside a held report (row 011-288)", () => {
  it("is told its own transition while a normal hand-off holds the store, which then commits", async () => {
    const h = HARNESSES[0] as Harness;
    const { r, consumer } = await failedSince(h);
    const other = { session_id: "other-session" };
    r.apply(r.pass());
    await h.run("session-start", recorded("session-start", r.root, other));
    r.apply(r.fail());
    let beside = "";
    let waited = 0;
    const run = await child(h, h.input(r, h.boundary), {
      stall: false,
      kill: false,
      slowMs: 300,
      whileHeld: async () => {
        const started = performance.now();
        beside = await h.run(h.boundary, recorded(h.boundary, r.root, other));
        waited = performance.now() - started;
      },
    });
    // It waited for the held write lock (300 ms less the poll that saw the hold), within its busy timeout.
    expect(waited).toBeGreaterThan(150);
    expect(count(beside)).toBe(1);
    expect(count(run.stdout)).toBe(1);
    expect(viewOf(r, consumer)).toBe("fail");
  }, 60_000);
});
