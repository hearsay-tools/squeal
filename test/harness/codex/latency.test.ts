import { loadavg } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeTurn } from "../../../src/core/delivery/turn.js";
import { type Consumer, MAIN_AGENT } from "../../../src/core/types/delivery.js";
import type { CodexHookName } from "../../../src/harness/codex/hooks.js";
import {
  adapterCompileCache,
  latencyStore,
  liveSocket,
  runBundle,
  runtimeDir,
} from "../bundle-helpers.js";
import type { SquealRepo } from "../helpers.js";
import { buildCodexBundles, codexInput, codexRecorded, sessionOf } from "./helpers.js";

/*
 * Spec 002 goal 7: "Per-tool hooks at calm load: 80 ms p95 for the Node
 * path". Every bundled Codex hook is held to it, as 001's latency test holds
 * the Claude Code hooks: rounds of 20 cold runs, a store with 50 test files of
 * 10 checks, a transition before every run of a delivering case. A hook
 * passes when one of up to 3 rounds meets the budget; above load average 4,
 * and in CI, the table is reported and nothing is asserted: one round of
 * `LOADED_RUNS` per hook, and no hook starts after `REPORT_BY_MS`, so the
 * table comes well inside the timeout (lessons, defect 6).
 *
 * Row 025-21 (option A, human 2026-11-26, as row 025-19 for Claude Code): the
 * budget holds the runtime bundles with Node's compile cache warm in a temp
 * directory, as Codex's adapter turns it on before it loads the runtime
 * (`enableOwnCompileCache`), one untimed run per case filling it, on a store
 * with the write markers a daemon arms. The uncached direct run stays in the
 * table, one round, not asserted.
 */

const RUNS = 20;
const ROUNDS = 3;
const BUDGET_MS = 80;
const MAX_LOAD = 4;
const LOADED_RUNS = 5;
/** Half the test's 240 s timeout. */
const REPORT_BY_MS = 120_000;

/** Whether the budget is asserted: a quiet machine, outside CI. */
const calm = () => (loadavg()[0] ?? 0) <= MAX_LOAD && process.env.CI === undefined;

const SESSION = String(codexInput("exec", "session-start", "/").session_id);
/** Moves the app-server `interrupt` record into the exec session, transcript included (D2). */
const IN_SESSION = sessionOf("exec", "session-start");
const AGENT = String(codexInput("exec", "subagent-start", "/").agent_id);

function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
}

/** p50, p95 and max of `samples`, rounded. */
function summary(samples: readonly number[]): { p50: number; p95: number; max: number } {
  const sorted = [...samples].sort((x, y) => x - y);
  return {
    p50: Math.round(sorted[Math.floor(sorted.length / 2)] ?? Number.NaN),
    p95: Math.round(p95(sorted)),
    max: Math.round(sorted.at(-1) ?? Number.NaN),
  };
}

interface Case {
  readonly hook: CodexHookName;
  /** Row label; one ending "(silent)" must print nothing. */
  readonly name: string;
  readonly fixture: string;
  readonly mode?: "exec" | "app-server";
  readonly before?: (r: SquealRepo, run: number) => void;
}

const flip = (r: SquealRepo, run: number) => r.apply(run % 2 === 0 ? r.fail() : r.pass());
const consumer = (r: SquealRepo, agentId: string = MAIN_AGENT): Consumer => ({
  worktreeId: r.worktreeId,
  sessionId: SESSION,
  agentId,
});
const register = (agentId?: string) => (r: SquealRepo) =>
  r.store.consumers.register(consumer(r, agentId), Date.now());

const CASES: readonly Case[] = [
  { hook: "session-start", name: "session-start", fixture: "session-start" },
  {
    hook: "user-prompt-submit",
    name: "user-prompt-submit",
    fixture: "user-prompt-submit",
    before: flip,
  },
  {
    hook: "pre-tool-use",
    name: "pre-tool-use (apply_patch)",
    fixture: "pre-tool-use-apply-patch",
    before: flip,
  },
  {
    hook: "pre-tool-use",
    name: "pre-tool-use (Bash, silent)",
    fixture: "pre-tool-use",
    // Its costliest silent path: putting a consumer left idle in a turn.
    before: (r) => r.store.transaction(() => writeTurn(r.store, consumer(r), null)),
  },
  { hook: "post-tool-use", name: "post-tool-use", fixture: "post-tool-use", before: flip },
  { hook: "post-tool-use", name: "post-tool-use (silent)", fixture: "post-tool-use" },
  { hook: "stop", name: "stop", fixture: "stop", before: flip },
  // Nothing to deliver: Stop ends the turn, recording the pending files.
  { hook: "stop", name: "stop (silent)", fixture: "stop" },
  { hook: "subagent-start", name: "subagent-start", fixture: "subagent-start" },
  {
    hook: "subagent-stop",
    name: "subagent-stop (silent)",
    fixture: "subagent-stop",
    before: register(AGENT),
  },
  { hook: "interrupt", name: "interrupt (silent)", fixture: "interrupt", mode: "app-server" },
  { hook: "session-end", name: "session-end (silent)", fixture: "session-end", before: register() },
];

let dist = "";
let cleanup = () => {};
beforeAll(async () => {
  ({ dir: dist, cleanup } = await buildCodexBundles());
}, 60_000);
afterAll(() => cleanup());

describe("bundled Codex hook latency", () => {
  it(`stays under ${BUDGET_MS} ms p95 over ${RUNS} runs per hook, compile cache warm`, async () => {
    const r = latencyStore();
    const dir = runtimeDir();
    await liveSocket(join(dir, `squeal-${r.worktreeId}.sock`));
    const input = (c: Case) => codexRecorded(c.mode ?? "exec", c.fixture, r.root, IN_SESSION);
    const env = { XDG_RUNTIME_DIR: dir };
    const cachedEnv = { ...env, ...adapterCompileCache(runtimeDir()) };
    await runBundle("session-start", input(CASES[0] as Case), env, dist);

    const asserted = calm();
    const [runs, maxRounds] = asserted ? [RUNS, ROUNDS] : [LOADED_RUNS, 1];
    const started = performance.now();
    const rows: {
      hook: string;
      rounds: number;
      p50: number;
      p95: number;
      max: number;
      "direct p50": number;
      "direct p95": number;
    }[] = [];
    /** `count` runs of `c` with `runEnv`, each checked for its output. */
    const round = async (c: Case, runEnv: Record<string, string>, count: number) => {
      const samples: number[] = [];
      for (let run = 0; run < count; run++) {
        c.before?.(r, run);
        const out = await runBundle(c.hook, input(c), runEnv, dist);
        expect(out.code, `${c.name}: ${out.stderr}`).toBe(0);
        expect(out.stderr, c.name).toBe("");
        if (c.name.endsWith("(silent)")) expect(out.stdout, c.name).toBe("");
        samples.push(out.ms);
      }
      return samples;
    };
    for (const c of CASES) {
      let best: number[] | null = null;
      let rounds = 0;
      const late = performance.now() - started > REPORT_BY_MS;
      if (!late) await round(c, cachedEnv, 1); // fills the compile cache, untimed
      while (!late && rounds < maxRounds && (best === null || p95(best) >= BUDGET_MS)) {
        rounds++;
        const samples = await round(c, cachedEnv, runs);
        if (best === null || p95(samples) < p95(best)) best = samples;
      }
      const direct = summary(late ? [] : await round(c, env, runs));
      rows.push({
        hook: c.name,
        rounds,
        ...summary(best ?? []),
        "direct p50": direct.p50,
        "direct p95": direct.p95,
      });
    }

    const load = loadavg()[0] ?? 0;
    console.log(
      `Codex hook latency ms, compile cache warm as the adapter sets it, best of up to ${maxRounds} rounds of ${runs} runs; ` +
        `direct: one round uncached, not asserted; load ${load.toFixed(2)}` +
        (asserted ? "" : `, above ${MAX_LOAD} or in CI: reported only`),
    );
    console.table(rows);
    if (!asserted || !calm()) return;
    for (const row of rows) {
      expect(row.rounds, `${row.hook}: not measured in time`).toBeGreaterThan(0);
      expect(row.p95, row.hook).toBeLessThan(BUDGET_MS);
    }
  }, 240_000);
});
