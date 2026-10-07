import { writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeTurn } from "../../src/core/delivery/turn.js";
import { storePaths } from "../../src/core/store/paths.js";
import { check, result } from "../state/helpers.js";
import { liveSocket, runBundle, runtimeDir } from "./bundle-helpers.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Spec 001 D9: PostToolBatch "budget 80 ms p95 (about 50 ms Node start plus a
 * store read)". Every bundled hook is held to it: rounds of 20 cold runs, a
 * real store with 50 test files of 10 checks, and a transition before every
 * run so delivering hooks deliver. Stop and UserPromptSubmit also run silent,
 * with nothing to deliver (review wave 10, S5): a silent Stop ends the turn,
 * its most expensive path. Other test files spawn processes at the
 * same time, so a hook passes when one of up to 3 rounds meets the budget;
 * the table reports the best round. Above load average 8 nothing is asserted.
 *
 * Task 001-96 (review wave 10c S1): SessionStart that spawns the daemon waits
 * for its heartbeat only, as in 0.1.11 (131 to 184 ms on the review's
 * machine), held to `SPAWN_BUDGET_MS`. The daemon is a stand-in CLI that
 * writes the heartbeat, a real daemon's first store write.
 */

const RUNS = 20;
const ROUNDS = 3;
const BUDGET_MS = 80;
const SPAWN_BUDGET_MS = 200;
// Inside the full parallel suite the measurement competes with other test files; at load 7 a
// hook read 80 ms p95 that measured 50 ms alone. Assert only on a quiet machine, report always.
const MAX_LOAD = 4;
const FILES = 50;
const CHECKS_PER_FILE = 10;

function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
}

/** A store the size of a small project: every check passing, one consumer registered. */
function seeded(): SquealRepo {
  const r = squealRepo();
  const results = [];
  for (let f = 0; f < FILES; f++) {
    const file = { project: "", path: `src/m${f}.test.ts` };
    r.store.testFileKeys.upsertMany([
      { worktreeId: r.worktreeId, testFile: file, key: `k${f}`, revision: 1, pending: null },
    ]);
    for (let c = 0; c < CHECKS_PER_FILE; c++) {
      results.push(
        result(check(`m${f} > case ${c}`, file), "pass", {
          key: `k${f}`,
          worktreeId: r.worktreeId,
        }),
      );
    }
  }
  r.apply(r.pass(), ...results);
  return r;
}

interface Case {
  readonly hook: string;
  /** Row label when `hook` runs in more than one case; a case named "(silent)" must print nothing. */
  readonly name?: string;
  readonly input: string;
  /** Fields over the recorded input. */
  readonly overrides?: object;
  readonly env?: Readonly<Record<string, string>>;
  /** Untimed work before each run. */
  readonly before?: (r: SquealRepo, run: number) => void;
  /** p95 budget; default `BUDGET_MS`. */
  readonly budget?: number;
}

/**
 * SessionStart `startup` spawning the daemon: no socket in a runtime dir of
 * its own, no daemon record, and as the CLI a stand-in that records a
 * heartbeat the way `squeal daemon` does once it holds its lock.
 */
function spawnCase(r: SquealRepo): Case {
  const dir = runtimeDir();
  const cli = join(dir, "daemon.mjs");
  const update = `UPDATE worktrees SET daemon_socket = ?, daemon_started_at = ?,
    daemon_heartbeat_at = ?, daemon_heartbeat_interval_ms = 3600000,
    daemon_version = '0.0.0-test' WHERE id = ?`;
  writeFileSync(
    cli,
    [
      `import { DatabaseSync } from "node:sqlite";`,
      `const db = new DatabaseSync(${JSON.stringify(storePaths(r.repo.commonDir).database)});`,
      `db.exec("PRAGMA busy_timeout = 2000");`,
      `const now = Date.now();`,
      `db.prepare(${JSON.stringify(update)}).run("/nowhere.sock", now, now, ${JSON.stringify(r.worktreeId)});`,
      `db.close();`,
    ].join("\n"),
  );
  return {
    hook: "session-start",
    name: "session-start (spawn)",
    input: "session-start",
    env: { XDG_RUNTIME_DIR: dir, SQUEAL_CLI: cli },
    before: (repo) => repo.daemon("none"),
    budget: SPAWN_BUDGET_MS,
  };
}

/** Alternates the one fixture check between pass and fail, so each run has a transition to deliver. */
const flip = (r: SquealRepo, run: number) => r.apply(run % 2 === 0 ? r.fail() : r.pass());

const CASES: readonly Case[] = [
  { hook: "session-start", input: "session-start" },
  { hook: "post-tool-batch", input: "post-tool-batch", before: flip },
  { hook: "pre-tool-use", input: "pre-tool-use", before: flip },
  // Task 001-93: every tool call, its costliest path putting a consumer left idle in a turn.
  {
    hook: "pre-tool-use",
    name: "pre-tool-use (Bash, silent)",
    input: "pre-tool-use",
    overrides: { tool_name: "Bash", tool_input: { command: "sleep 15" } },
    before: (r) => r.store.transaction(() => writeTurn(r.store, r.consumer(), null)),
  },
  { hook: "stop", input: "stop", before: flip },
  // Nothing to deliver: Stop ends the turn (task 001-85), recording what the waiter waits for.
  { hook: "stop", name: "stop (silent)", input: "stop" },
  // Task 001-85: a prompt starts a turn and carries the delta.
  { hook: "user-prompt-submit", input: "user-prompt-submit", before: flip },
  { hook: "user-prompt-submit", name: "user-prompt-submit (silent)", input: "user-prompt-submit" },
  {
    hook: "session-end",
    input: "session-end",
    before: (r) => r.store.consumers.register(r.consumer(), Date.now()),
  },
  {
    hook: "waiter",
    input: "stop",
    env: { CLAUDE_CODE_SESSION_ATTENDED: "0", CLAUDE_CODE_ENTRYPOINT: "sdk-cli" },
  },
];

describe("bundled hook latency", () => {
  it(`stays under ${BUDGET_MS} ms p95 over ${RUNS} cold runs per hook`, async () => {
    const r = seeded();
    const dir = runtimeDir();
    await liveSocket(join(dir, `squeal-${r.worktreeId}.sock`));
    await runBundle("session-start", recorded("session-start", r.root), {
      XDG_RUNTIME_DIR: dir,
    });

    const rows: {
      hook: string;
      rounds: number;
      p50: number;
      p95: number;
      max: number;
      budget: number;
    }[] = [];
    // Last: the stand-in leaves a daemon record whose socket nobody listens on.
    for (const c of [...CASES, spawnCase(r)]) {
      const budget = c.budget ?? BUDGET_MS;
      let best: number[] | null = null;
      let rounds = 0;
      while (rounds < ROUNDS && (best === null || p95(best) >= budget)) {
        rounds++;
        const samples: number[] = [];
        for (let run = 0; run < RUNS; run++) {
          c.before?.(r, run);
          const out = await runBundle(c.hook, recorded(c.input, r.root, c.overrides), {
            XDG_RUNTIME_DIR: dir,
            ...c.env,
          });
          expect(out.code, `${c.hook}: ${out.stderr}`).toBe(0);
          if (c.name?.endsWith("(silent)")) expect(out.stdout, c.name).toBe("");
          samples.push(out.ms);
        }
        if (best === null || p95(samples) < p95(best)) best = samples;
      }
      const sorted = [...(best ?? [])].sort((x, y) => x - y);
      rows.push({
        hook: c.name ?? c.hook,
        rounds,
        p50: Math.round(sorted[Math.floor(RUNS / 2)] ?? 0),
        p95: Math.round(p95(sorted)),
        max: Math.round(sorted.at(-1) ?? 0),
        budget,
      });
    }

    const load = loadavg()[0] ?? 0;
    console.log(
      `hook latency ms, best of up to ${ROUNDS} rounds of ${RUNS} cold runs, load ${load.toFixed(2)}`,
    );
    console.table(rows);
    // Shared CI runners report a low load average and still take 128 ms for a cold Node start
    // (Node 22 job, 2026-10-06). The budget is a dogfooding measurement; in CI it is reported only.
    if (load > MAX_LOAD || process.env.CI !== undefined) return;
    for (const row of rows) expect(row.p95, row.hook).toBeLessThan(row.budget);
  }, 120_000);
});
