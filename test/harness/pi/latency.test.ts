import { loadavg } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeliveryHost, type DeliveryHost } from "../../../src/harness/pi/host.js";
import type { PiRequest } from "../../../src/harness/pi/protocol.js";
import { check, result } from "../../state/helpers.js";
import { liveSocket, quietCli, runtimeDir } from "../bundle-helpers.js";
import { SESSION, type SquealRepo, squealRepo } from "../helpers.js";
import { buildPiBundles } from "./helpers.js";

/*
 * Spec 009 D4: "Wave 0 measures the worker's round trip per tool call against
 * 002's 80 ms p95." Each case posts requests to the built `dist/worker.mjs`
 * through the delivery host and times the answer, on a store with 50 test
 * files of 10 checks: the bare round trip, a tool boundary that delivers (a
 * transition before each call) and one that does not, and a call on a fresh
 * worker, which `session_start` and the first event after a missed deadline
 * pay. Above load average 4, and in CI, the table is reported and nothing is
 * asserted, as 001's and 002's latency tests do.
 */

const RUNS = 50;
const COLD_RUNS = 10;
const BUDGET_MS = 80;
const MAX_LOAD = 4;
const FILES = 50;
const CHECKS_PER_FILE = 10;

const calm = () => (loadavg()[0] ?? 0) <= MAX_LOAD && process.env.CI === undefined;

function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
}

/** A store the size of a small project: every check passing. */
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

let built = { dir: "", cleanup: () => {} };
beforeAll(async () => {
  built = await buildPiBundles();
}, 60_000);
afterAll(() => built.cleanup());

async function timed(host: DeliveryHost, request: PiRequest): Promise<[number, unknown]> {
  const started = performance.now();
  const answer = await host.call(request, 2_000);
  return [performance.now() - started, answer];
}

describe("the Pi delivery worker's round trip", () => {
  it(`stays under ${BUDGET_MS} ms p95 per call at calm load`, async () => {
    const r = seeded();
    const dir = runtimeDir();
    await liveSocket(join(dir, `squeal-${r.worktreeId}.sock`));
    const env = { ...process.env, XDG_RUNTIME_DIR: dir, SQUEAL_CLI: quietCli().cli };
    const start = () => new Worker(join(built.dir, "worker.mjs"), { env });
    const session = { sessionId: SESSION, cwd: r.root };
    const host = createDeliveryHost(start);
    const hosts = [host];
    try {
      expect(await host.call({ kind: "start", reason: "startup", ...session }, 2_000)).toMatch(
        /^SQUEAL · registered/,
      );
      const rows: { call: string; p50: number; p95: number; max: number }[] = [];
      const measure = async (
        call: string,
        runs: number,
        sample: (run: number) => Promise<number>,
      ) => {
        const samples: number[] = [];
        for (let run = 0; run < runs; run++) samples.push(await sample(run));
        const sorted = [...samples].sort((a, b) => a - b);
        rows.push({
          call,
          p50: Math.round((sorted[Math.floor(sorted.length / 2)] ?? Number.NaN) * 10) / 10,
          p95: Math.round(p95(sorted) * 10) / 10,
          max: Math.round((sorted.at(-1) ?? Number.NaN) * 10) / 10,
        });
      };
      await measure("ping", RUNS, async () => (await timed(host, { kind: "ping" }))[0]);
      await measure("boundary (delivers)", RUNS, async (run) => {
        r.apply(run % 2 === 0 ? r.fail() : r.pass());
        const [ms, text] = await timed(host, { kind: "boundary", edited: true, ...session });
        expect(text).toMatch(/^SQUEAL/);
        return ms;
      });
      await measure("boundary (silent)", RUNS, async () => {
        const [ms, text] = await timed(host, { kind: "boundary", edited: true, ...session });
        expect(text).toBeNull();
        return ms;
      });
      await measure("boundary on a fresh worker", COLD_RUNS, async () => {
        const fresh = createDeliveryHost(start);
        hosts.push(fresh);
        return (await timed(fresh, { kind: "boundary", edited: true, ...session }))[0];
      });

      const load = loadavg();
      const asserted = calm();
      console.log(
        `Pi delivery worker round trip ms, ${RUNS} calls (${COLD_RUNS} fresh workers), load ` +
          `${load.map((l) => l.toFixed(2)).join(" ")}` +
          (asserted ? "" : `, above ${MAX_LOAD} or in CI: reported only`),
      );
      console.table(rows);
      if (!asserted) return;
      for (const row of rows) expect(row.p95, row.call).toBeLessThan(BUDGET_MS);
    } finally {
      for (const h of hosts) h.stop();
    }
  }, 120_000);
});
