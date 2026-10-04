import { loadavg } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check, result } from "../state/helpers.js";
import { liveSocket, runBundle, runtimeDir } from "./bundle-helpers.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Spec 001 D9: PostToolBatch "budget 80 ms p95 (about 50 ms Node start plus a
 * store read)". Every bundled hook is held to it: 20 cold runs each, a real
 * store with 50 test files of 10 checks, and a transition before every run so
 * delivering hooks deliver. The assertion is skipped on a loaded host.
 */

const RUNS = 20;
const BUDGET_MS = 80;
const MAX_LOAD = 8;
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
  readonly input: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Untimed work before each run. */
  readonly before?: (r: SquealRepo, run: number) => void;
}

/** Alternates the one fixture check between pass and fail, so each run has a transition to deliver. */
const flip = (r: SquealRepo, run: number) => r.apply(run % 2 === 0 ? r.fail() : r.pass());

const CASES: readonly Case[] = [
  { hook: "session-start", input: "session-start" },
  { hook: "post-tool-batch", input: "post-tool-batch", before: flip },
  { hook: "pre-tool-use", input: "pre-tool-use", before: flip },
  { hook: "stop", input: "stop", before: flip },
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

    const rows: { hook: string; p50: number; p95: number; max: number }[] = [];
    for (const c of CASES) {
      const samples: number[] = [];
      for (let run = 0; run < RUNS; run++) {
        c.before?.(r, run);
        const out = await runBundle(c.hook, recorded(c.input, r.root), {
          XDG_RUNTIME_DIR: dir,
          ...c.env,
        });
        expect(out.code, `${c.hook}: ${out.stderr}`).toBe(0);
        samples.push(out.ms);
      }
      const sorted = [...samples].sort((a, b) => a - b);
      rows.push({
        hook: c.hook,
        p50: Math.round(sorted[Math.floor(RUNS / 2)] ?? 0),
        p95: Math.round(p95(samples)),
        max: Math.round(sorted.at(-1) ?? 0),
      });
    }

    const load = loadavg()[0] ?? 0;
    console.log(`hook latency ms over ${RUNS} cold runs, load ${load.toFixed(2)}`);
    console.table(rows);
    if (load > MAX_LOAD) return;
    for (const row of rows) expect(row.p95, row.hook).toBeLessThan(BUDGET_MS);
  }, 60_000);
});
