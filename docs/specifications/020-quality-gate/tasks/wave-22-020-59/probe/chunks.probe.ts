import { appendFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { expect, it } from "vitest";
import { ADAPTERS, codeGateCommand } from "../../../../../../src/cli/code-gate.js";
import { CHUNK_WIDTHS, chunkSize, MIN_CHUNK } from "../../../../../../src/core/code/gate/chunks.js";
import type { GateAdapters } from "../../../../../../src/core/code/gate/runners.js";
import type { RunnerAdapter } from "../../../../../../src/core/types/runner.js";
import { quiet } from "../../../../../../test/code/gate/host-load.js";
import { featureRepo, keepPolicy } from "../../../../../../test/cli/code-gate-keep-kit.js";
import { ownHomeAndTmp } from "../../../../../../test/cli/code-gate-fixture.js";

/*
 * Row 020-59, the parent's condition 2: the whole gate time of one Vitest
 * run against the same files in chunks, at a one-minute load below the
 * CPU count, and the cost of one more chunk. N test files each sleep a
 * fixed, uneven time (no CPU work: no artificial load), each loads its own
 * changed module, so every file is selected and none is in a store (each
 * gate gets a fresh repository). Modes alternate, `ROUNDS` times each.
 * Output: one JSON line per gate to `$PROBE_OUT`.
 */

const N = Number(process.env.PROBE_FILES ?? 240);
const ROUNDS = Number(process.env.PROBE_ROUNDS ?? 3);
const OUT = process.env.PROBE_OUT ?? "/dev/null";

/** A fixed, uneven sleep per file: most short, a few long, as stored durations look. */
function sleepOf(i: number): number {
  const x = ((i * 2654435761) % 1000) / 1000;
  return Math.round(30 + 1200 * x ** 4);
}

function files(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < N; i++) {
    out[`src/p/m${i}.ts`] = `export const v${i} = (x: number) => (x > 0 ? ${i} : -${i});\n`;
    out[`test/p/t${i}.test.ts`] =
      `import { expect, it } from "vitest";\nimport { v${i} } from "../../src/p/m${i}.ts";\n\nit("t${i}", async () => {\n  await new Promise((done) => setTimeout(done, ${sleepOf(i)}));\n  expect(v${i}(1)).toBe(${i});\n});\n`;
  }
  return out;
}

const MODES = [
  { name: "one-run", chunkFiles: 1_000_000 },
  { name: "default", chunkFiles: undefined },
  { name: "small", chunkFiles: 24 },
] as const;

function counted(runs: number[]): GateAdapters {
  const wrap = (adapter: RunnerAdapter): RunnerAdapter =>
    new Proxy(adapter, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (key !== "run") return value.bind(target);
        return async (...args: Parameters<RunnerAdapter["run"]>) => {
          const since = performance.now();
          try {
            return await target.run(...args);
          } finally {
            runs.push(Math.round(performance.now() - since));
          }
        };
      },
    });
  return {
    vitest: async (options) => wrap(await ADAPTERS.vitest(options)),
    nodeTest: ADAPTERS.nodeTest,
  };
}

it("measures one run against chunks", async () => {
  const cpuCount = cpus().length;
  for (let round = 0; round < ROUNDS; round++) {
    for (const mode of MODES) {
      const load = loadavg()[0] ?? 0;
      if (load >= cpuCount) {
        appendFileSync(OUT, `${JSON.stringify({ round, mode: mode.name, skip: "load", load, cpuCount })}\n`);
        continue;
      }
      ownHomeAndTmp();
      const repo = featureRepo(keepPolicy("lookup-only"), files());
      const runs: number[] = [];
      let stderr = "";
      const since = performance.now();
      let reportMs = 0;
      const code = await codeGateCommand(
        ["--base", "main", "--json", "--timeout", "1800"],
        {
          stdout: () => {
            reportMs = Math.round(performance.now() - since);
          },
          stderr: (text) => {
            stderr += text;
          },
          cwd: repo.root,
          env: {},
          hostLoad: quiet,
          ...(mode.chunkFiles === undefined ? {} : { chunkFiles: mode.chunkFiles }),
        },
        counted(runs),
      );
      const totalMs = Math.round(performance.now() - since);
      const after = loadavg()[0] ?? 0;
      const line = { round, mode: mode.name, code, reportMs, totalMs, runs, load, after, cpuCount };
      appendFileSync(OUT, `${JSON.stringify(line)}\n`);
      if (code !== 0) appendFileSync(OUT, `${JSON.stringify({ stderr })}\n`);
      repo.cleanup();
    }
  }
  expect([CHUNK_WIDTHS, MIN_CHUNK, typeof chunkSize]).toEqual([4, 8, "function"]);
});
