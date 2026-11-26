import { loadavg } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeTurn } from "../../../src/core/delivery/turn.js";
import { type Consumer, MAIN_AGENT } from "../../../src/core/types/delivery.js";
import { ANTIGRAVITY_PLUGIN_DIR } from "../../../src/harness/antigravity/build.js";
import { check } from "../../state/helpers.js";
import {
  type BundleRun,
  latencyStore,
  liveSocket,
  runBundle,
  runLaunched,
  runtimeDir,
} from "../bundle-helpers.js";
import { FILE, type SquealRepo } from "../helpers.js";
import { antigravityRecorded, buildAntigravityBundles, CONVERSATION } from "./helpers.js";

/*
 * Spec 024 goal 7: "Per-invocation and per-tool hooks stay within 80 ms p95
 * for the Node path at calm load". Every bundled Antigravity hook is held to
 * it, as Codex's latency test holds Codex's: the bundles built from this
 * worktree, rounds of 20 cold runs of `node <bundle>`, a store with 50 test
 * files of 10 checks, a live socket, a transition before every run of a
 * delivering case. A hook passes when one of up to 3 rounds meets the
 * budget; above load average 4, and in CI, the table is reported and nothing
 * is asserted: one round of `LOADED_RUNS` per hook, and no hook starts after
 * `REPORT_BY_MS`, so the table comes well inside the timeout (lessons,
 * defect 6). The `sh` fast path's own budget is `fast-path.test.ts`'s.
 *
 * Row 025-21 (option A, human 2026-11-26, as row 025-19 for Claude Code): the
 * budget holds the path Antigravity runs, hooks.json's `hooks/run [--if-squeal]
 * node <bundle>` with Node's compile cache warm in a temp directory, one
 * untimed run per case filling it, on a store with the write markers a daemon
 * arms. The uncached direct run (`runBundle`) stays in the table, one round,
 * not asserted.
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

function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
}

type Hook = "session-start" | "pre-invocation" | "pre-tool-use" | "stop";

interface Case {
  readonly hook: Hook;
  /** Row label. */
  readonly name: string;
  /** A silent case must print nothing on stdout. */
  readonly silent?: boolean;
  readonly fixture: string;
  readonly overrides?: object;
  readonly before?: (r: SquealRepo, run: number) => void;
  /** How every run of a delivering case's output starts, so its costly path is the one timed. */
  readonly speaks?: string;
}

const INJECTS = '{"injectSteps":';

let flips = 0;
/**
 * A transition before every run: the check alternates across cases too, so
 * an odd number of runs (`LOADED_RUNS`) never leaves the next case's first
 * run with the state already told.
 */
const flip = (r: SquealRepo) => r.apply(flips++ % 2 === 0 ? r.fail() : r.pass());
const consumer = (r: SquealRepo): Consumer => ({
  worktreeId: r.worktreeId,
  sessionId: CONVERSATION,
  agentId: MAIN_AGENT,
});
/** A consumer left idle, as a Stop leaves it: the next hook puts it back in a turn. */
const idle = (r: SquealRepo) => r.store.transaction(() => writeTurn(r.store, consumer(r), null));
let regressions = 0;
/**
 * A fresh `PASS -> FAIL` before every run: a regression denies once, and the
 * same check failing again after that is no new one, so each run breaks a
 * check of its own that passed at the revision before.
 */
const regress = (r: SquealRepo) => {
  const fresh = check(`math > regression ${regressions++}`, FILE);
  r.apply(r.pass(), r.pass(fresh));
  r.apply(r.pass(), r.fail(fresh));
};

const CASES: readonly Case[] = [
  { hook: "session-start", name: "session-start", fixture: "session-start" },
  {
    hook: "pre-invocation",
    name: "pre-invocation (first)",
    fixture: "pre-invocation-first",
    before: flip,
    speaks: INJECTS,
  },
  {
    hook: "pre-invocation",
    name: "pre-invocation (after tools)",
    fixture: "pre-invocation-after-tools",
    before: flip,
    speaks: INJECTS,
  },
  {
    hook: "pre-invocation",
    name: "pre-invocation (after tools, silent)",
    silent: true,
    fixture: "pre-invocation-after-tools",
  },
  {
    hook: "pre-tool-use",
    name: "pre-tool-use (write_file, denying)",
    fixture: "pre-tool-use-write-file",
    before: regress,
    speaks: '{"decision":"deny"',
  },
  {
    hook: "pre-tool-use",
    name: "pre-tool-use (run_command, silent)",
    silent: true,
    fixture: "pre-tool-use-run-command",
    // Its costliest silent path: putting a consumer left idle in a turn.
    before: idle,
  },
  { hook: "stop", name: "stop", fixture: "stop", before: flip, speaks: '{"decision":"continue"' },
  // Nothing to deliver: Stop ends the turn, recording the pending files.
  { hook: "stop", name: "stop (silent)", fixture: "stop", silent: true },
];

interface Row {
  readonly hook: string;
  readonly rounds: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly "direct p50": number;
  readonly "direct p95": number;
}

/** How a run starts: through `hooks/run` with the cache warm, or the direct uncached `node <bundle>`. */
type Start = (c: Case, stdin: string) => Promise<BundleRun>;

/** hooks.json's launcher for `hook`: every hook but SessionStart passes `--if-squeal`. */
const launcher = (hook: Hook): [string, ...string[]] => [
  join(ANTIGRAVITY_PLUGIN_DIR, "hooks/run"),
  ...(hook === "session-start" ? [] : ["--if-squeal"]),
];

/** One measured round of `runs` runs of `c` through `start`, each checked for its output. */
async function round(c: Case, r: SquealRepo, start: Start, runs: number) {
  const samples: number[] = [];
  for (let run = 0; run < runs; run++) {
    c.before?.(r, run);
    const out = await start(c, antigravityRecorded(c.fixture, r.root, c.overrides));
    expect(out.code, `${c.name}: ${out.stderr}`).toBe(0);
    expect(out.stderr, c.name).toBe("");
    if (c.silent) expect(out.stdout, c.name).toBe("");
    if (c.speaks !== undefined)
      expect(out.stdout.startsWith(c.speaks), `${c.name}, run ${run}: ${out.stdout}`).toBe(true);
    samples.push(out.ms);
  }
  return samples;
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

/**
 * The best of up to `maxRounds` launched rounds of `c` after one untimed run
 * that fills the compile cache, and one direct uncached round; none when `late`.
 */
async function measure(
  c: Case,
  r: SquealRepo,
  [launched, direct]: readonly [Start, Start],
  [runs, maxRounds]: readonly [number, number],
  late: boolean,
): Promise<Row> {
  let best: number[] | null = null;
  let rounds = 0;
  if (!late) await round(c, r, launched, 1);
  while (!late && rounds < maxRounds && (best === null || p95(best) >= BUDGET_MS)) {
    rounds++;
    const samples = await round(c, r, launched, runs);
    if (best === null || p95(samples) < p95(best)) best = samples;
  }
  const uncached = summary(late ? [] : await round(c, r, direct, runs));
  return {
    hook: c.name,
    rounds,
    ...summary(best ?? []),
    "direct p50": uncached.p50,
    "direct p95": uncached.p95,
  };
}

let dist = "";
let cleanup = () => {};
beforeAll(async () => {
  ({ dir: dist, cleanup } = await buildAntigravityBundles());
}, 60_000);
afterAll(() => cleanup());

describe("bundled Antigravity hook latency", () => {
  it(`stays under ${BUDGET_MS} ms p95 over ${RUNS} launched runs per hook, compile cache warm`, async () => {
    const r = latencyStore();
    const dir = runtimeDir();
    const cacheHome = runtimeDir();
    await liveSocket(join(dir, `squeal-${r.worktreeId}.sock`));
    const env = { XDG_RUNTIME_DIR: dir };
    const start = await runBundle(
      "session-start",
      antigravityRecorded("session-start", r.root),
      env,
      dist,
    );
    expect(start.stdout).toContain("registered at revision");

    const asserted = calm();
    const shape: [number, number] = asserted ? [RUNS, ROUNDS] : [LOADED_RUNS, 1];
    const started = performance.now();
    const starts: [Start, Start] = [
      (c, stdin) => runLaunched(c.hook, stdin, cacheHome, env, dist, launcher(c.hook)),
      (c, stdin) => runBundle(c.hook, stdin, env, dist),
    ];
    const rows: Row[] = [];
    for (const c of CASES) {
      rows.push(await measure(c, r, starts, shape, performance.now() - started > REPORT_BY_MS));
    }

    const load = loadavg()[0] ?? 0;
    console.log(
      `Antigravity hook latency ms, hooks/run with a warm compile cache, best of up to ${shape[1]} rounds of ${shape[0]} runs; ` +
        `direct: one round of uncached runBundle, not asserted; load ${load.toFixed(2)}` +
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
