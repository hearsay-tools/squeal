import { loadavg } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BridgeCommand, callBridge } from "../../../src/harness/opencode/bridge-client.js";
import {
  bridgeFile,
  type OcAnswers,
  type OcRequest,
} from "../../../src/harness/opencode/protocol.js";
import { check, result } from "../../state/helpers.js";
import { liveSocket, quietCli, runtimeDir } from "../bundle-helpers.js";
import { SESSION, type SquealRepo, squealRepo } from "../helpers.js";
import { buildOpencodeBundles } from "./helpers.js";

/*
 * Spec 008 D4 and open question 3: "Wave 0 measures the bridge against that
 * 80 ms p95." Each case runs the built `dist/hooks/opencode.mjs` through the
 * plugin's bridge client, as a hook does, on a store with 50 test files of 10
 * checks: the bare round trip (a Node start and the bundle's load), a
 * registration, and an unregistration. Above load average 4, and in CI, the
 * table is reported and nothing is asserted, as 001's, 002's and 009's
 * latency tests do.
 */

const RUNS = 30;
const BUDGET_MS = 80;
const MAX_LOAD = 4;
const FILES = 50;
const CHECKS_PER_FILE = 10;

const calm = () => (loadavg()[0] ?? 0) <= MAX_LOAD && process.env.CI === undefined;

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.ceil(sorted.length * p) - 1] ?? Number.NaN;
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
  built = await buildOpencodeBundles();
}, 60_000);
afterAll(() => built.cleanup());

describe("the OpenCode bridge's per-call cost", () => {
  it(`stays under ${BUDGET_MS} ms p95 per call at calm load`, async () => {
    const r = seeded();
    const dir = runtimeDir();
    await liveSocket(join(dir, `squeal-${r.worktreeId}.sock`));
    // The bridge inherits this process's environment, as it inherits OpenCode's.
    process.env.XDG_RUNTIME_DIR = dir;
    process.env.SQUEAL_CLI = quietCli().cli;
    const host = { worktree: r.root, pid: process.pid };
    const timed = async <K extends OcRequest["kind"]>(request: OcRequest & { kind: K }) => {
      const started = performance.now();
      const bridge: BridgeCommand = {
        node: process.execPath,
        entry: join(built.dir, "hooks", bridgeFile(request.kind)),
      };
      const answer = await callBridge<OcAnswers[K]>(bridge, request, r.root, 2_000);
      return [performance.now() - started, answer] as const;
    };
    const consumer = { sessionId: SESSION };
    const rows: { call: string; p50: number; p95: number; max: number }[] = [];
    const measure = async (call: string, sample: () => Promise<number>) => {
      const samples: number[] = [];
      for (let run = 0; run < RUNS; run++) samples.push(await sample());
      const sorted = [...samples].sort((a, b) => a - b);
      const round = (ms: number) => Math.round(ms * 10) / 10;
      rows.push({
        call,
        p50: round(percentile(sorted, 0.5)),
        p95: round(percentile(sorted, 0.95)),
        max: round(sorted.at(-1) ?? Number.NaN),
      });
    };
    try {
      await measure("ping", async () => {
        const [ms, answer] = await timed({ kind: "ping", ...host });
        expect(answer).toEqual({ pong: true });
        return ms;
      });
      await measure("register (chat.message)", async () => {
        const [ms, answer] = await timed({ kind: "register", consumer, ...host });
        expect(answer?.header).toMatch(/^SQUEAL · registered/);
        return ms;
      });
      await measure("end (dispose)", async () => {
        const [ms, answer] = await timed({
          kind: "end",
          sessions: [],
          consumers: [consumer],
          ...host,
        });
        expect(answer).toEqual({ ended: 1 });
        return ms;
      });
    } finally {
      delete process.env.XDG_RUNTIME_DIR;
      delete process.env.SQUEAL_CLI;
    }

    const load = loadavg();
    const asserted = calm();
    console.log(
      `OpenCode bridge per-call ms, ${RUNS} calls each, load ` +
        `${load.map((l) => l.toFixed(2)).join(" ")}` +
        (asserted ? "" : `, above ${MAX_LOAD} or in CI: reported only`),
    );
    console.table(rows);
    if (!asserted) return;
    for (const row of rows) expect(row.p95, row.call).toBeLessThan(BUDGET_MS);
  }, 120_000);
});
