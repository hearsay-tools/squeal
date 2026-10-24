import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import type { RevisionNumber } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import type { CatchUpSide } from "../scheduler/catch-up-fixture.js";
import {
  A,
  B,
  batch,
  FILES,
  gitMay,
  HELPER,
  heldPaths,
  helperReturning,
  holdSide,
  mergeRepo,
  runsOf,
} from "../scheduler/merge-hold-fixture.js";
import { type Answer, closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";

/*
 * Row 011-73 (011 C6 as amended 2026-10-21; `tasks/011-61/design.md` R2,
 * test 4): `status --wait`, a named wait and `run --all --wait`, started on
 * hold, return within one poll with the hold as their verdict line and exit
 * 3; after `git add`, a wait's sync pass reads the index first, so it waits
 * for the importers instead. A real scheduler holds; a stand-in daemon on
 * its socket answers the CLI, its sync running the scheduler's pass.
 */

const saved = { ...process.env };
let runtimeDir: string;
beforeEach(() => {
  runtimeDir = mkdtempSync("/tmp/sq-hold-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});
afterEach(() => {
  closeFakeDaemons();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

const VERDICT =
  /^On hold: unresolved merge, git lists 1 unmerged path \(src\/helper\.ts\); no verdict, since no test runs until git lists none\. Resolve it and `git add` it, or abort\.\. Worktree: /;

/**
 * A stand-in daemon for `side`: `sync` runs the scheduler's reconciliation
 * pass, which reads the index first, and `sync-status` answers its revision
 * once stored; `run-all` asks the scheduler for the checkpoint.
 */
async function standIn(side: CatchUpSide, more: Record<string, Answer[]> = {}): Promise<void> {
  const socket = socketPathFor(side.worktreeId);
  const worktree = side.store.worktrees.get(side.worktreeId);
  if (worktree?.daemon == null) throw new Error("no daemon record");
  side.store.worktrees.upsert({ ...worktree, daemon: { ...worktree.daemon, socketPath: socket } });
  let stored: number | null = null;
  const sync = (): Answer => ({
    ok: true,
    type: "sync",
    requestId: "y1",
    revision: stored,
    error: null,
    moves: true,
    incarnation: null,
  });
  const answers: Record<string, Answer[]> = {
    sync: [sync()],
    "sync-status": [sync()],
    ping: [{ ok: true, type: "ping", pid: process.pid, phase: "ready" }],
    ...more,
  };
  await fakeDaemon(socket, answers, (type) => {
    if (type === "sync") {
      stored = null;
      void side.scheduler.handleBatch({ trigger: "interval", paths: [] }).then(() => {
        stored = side.scheduler.status().revision;
      });
    }
    answers.sync = [sync()];
    answers["sync-status"] = [sync()];
  });
}

/** Asks `side`'s scheduler for the checkpoint, as the daemon's `run-all` handler does. */
async function checkpointAnswer(side: CatchUpSide): Promise<Answer> {
  const checkpoint = await side.scheduler.requestFullSuite({});
  return { ok: true, type: "run-all", requestId: "r1", checkpoint, error: null, owner: null };
}

/** The test's environment without a harness session, so a wait runs as no consumer. */
function withoutSession(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of ["CLAUDE_CODE_SESSION_ID", "CODEX_SESSION_ID", "OPENCODE_SESSION_ID"]) {
    delete env[name];
  }
  return env;
}

async function run(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    env: withoutSession(),
  };
  const started = performance.now();
  const code = await main(argv, io);
  const lines = stdout.trimEnd().split("\n");
  return { code, stdout, stderr, last: lines.at(-1) ?? "", ms: performance.now() - started };
}

async function onHold(checkpoint = false) {
  const repo = mergeRepo();
  const side = holdSide(repo, repo.main, FILES, RUN_MISSING);
  await side.scheduler.start();
  await side.scheduler.idle();
  expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
  await batch(side, HELPER);
  await side.scheduler.idle();
  expect(heldPaths(side)).toEqual([HELPER]);
  const answer = checkpoint ? await checkpointAnswer(side) : null;
  await standIn(side, answer === null ? {} : { "run-all": [answer], "run-all-status": [answer] });
  return { repo, side };
}

describe("waits on hold (row 011-73)", { timeout: 60_000 }, () => {
  it("4: `status --wait` returns within one poll with the hold as its verdict line, exit 3", async () => {
    const { repo } = await onHold();
    const result = await run(["status", "--wait", "30000"], repo.main);
    expect(result.last).toMatch(VERDICT);
    expect(result.stdout).toContain("\nOn hold: unresolved merge since ");
    expect(result.code).toBe(3);
    expect(result.ms).toBeLessThan(5_000);
  });

  it("4: `status --json --wait` gives outcome `on-hold` and `holds`, exit 3", async () => {
    const { repo } = await onHold();
    const result = await run(["status", "--json", "--wait", "30000"], repo.main);
    const payload = JSON.parse(result.stdout) as {
      wait: { outcome: string };
      holds: { cause: string; paths: string[] }[];
    };
    expect(payload.wait.outcome).toBe("on-hold");
    expect(payload.holds).toEqual([expect.objectContaining({ cause: "merge", paths: [HELPER] })]);
    expect(result.stderr).toMatch(VERDICT);
    expect(result.code).toBe(3);
  });

  it("4: a named wait returns with the hold as its verdict line, exit 3", async () => {
    const { repo } = await onHold();
    const result = await run(["status", "--wait", "30000", A], repo.main);
    expect(result.last).toMatch(VERDICT);
    expect(result.stdout).toMatch(/^Revision: .*\nOn hold: unresolved merge since /);
    expect(result.stdout).toContain(
      `queued, on hold for the unresolved merge (git lists ${HELPER} unmerged)`,
    );
    expect(result.code).toBe(3);
    expect(result.ms).toBeLessThan(5_000);
  });

  it("4: `status <path>` without a wait says the hold, exit 3", async () => {
    const { repo } = await onHold();
    const result = await run(["status", B], repo.main);
    expect(result.last).toMatch(VERDICT);
    expect(result.code).toBe(3);
  });

  it("4: `run --all --wait` records its request and returns with the hold, exit 3", async () => {
    const { repo, side } = await onHold(true);
    const result = await run(["run", "--all", "--wait", "30000"], repo.main);
    expect(result.stdout.split("\n")[0]).toMatch(
      /^Checkpoint \S+ is queued and runs when the hold ends\. On hold: unresolved merge, git lists 1 unmerged path/,
    );
    expect(result.code).toBe(3);
    expect(result.ms).toBeLessThan(5_000);
    expect(runsOf(side, A)).toBe(1);
  });

  it("4: `git add` then `status --wait` waits for the importers instead of the hold", async () => {
    const { repo, side } = await onHold();
    // The resolved write holds too (R1); `git add` alone ends the hold, with no revision.
    writeFileSync(join(repo.main, HELPER), helperReturning(4));
    await batch(side, HELPER);
    await side.scheduler.idle();
    expect(heldPaths(side)).toEqual([HELPER]);
    const revision = side.scheduler.status().revision as RevisionNumber;
    git(repo.main, ["add", HELPER]);
    const result = await run(["status", "--wait", "30000"], repo.main);
    expect(result.stdout).not.toContain("On hold:");
    expect(result.code).toBe(0);
    expect([runsOf(side, A), runsOf(side, B)]).toEqual([2, 2]);
    expect(side.scheduler.status().revision).toBe(revision);
  });
});
