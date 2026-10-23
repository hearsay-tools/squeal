import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createDeliveryHost } from "../../../src/harness/pi/host.js";
import { check, result } from "../../state/helpers.js";
import { liveSocket, quietCli, runtimeDir } from "../bundle-helpers.js";
import { SESSION, type SquealRepo, squealRepo } from "../helpers.js";
import { buildPiBundles } from "./helpers.js";

/*
 * Row 009-31's probe, never committed under test/: copied into a copy of the
 * tree as test/harness/pi/fresh-probe.test.ts. It times the phases of each
 * fresh delivery worker's first `boundary` call, on the latency test's store,
 * and writes one JSON line per worker to $PROBE_OUT.
 *
 * The wrapper entry `probe-worker.cjs` marks the time (`js`), then imports
 * the real `worker.mjs`, whose `serve` takes the queued message. So the
 * phases are: the thread's boot (`ctor1` to `js`, Node's bootstrap of a
 * worker), the bundle's load and evaluation (to `evaluated`), the wait for the
 * message (to `received`), the handler (to `answered`) and the answer's way
 * back to this thread (to `at`). `cpuJs`, `cpuEvaluated` and `cpu` are the
 * worker thread's own CPU time at those marks (`threadCpuUsage`), so a phase's
 * wall time minus its CPU time is time the thread waited for a CPU or for I/O.
 *
 * PROBE_N fresh workers (default 20); PROBE_PLAIN=1 starts the real
 * `worker.mjs` with no wrapper, to show the wrapper costs nothing. Odd runs
 * (`minEnv`) give the worker the minimal environment the 001 and 002 latency
 * tests give their hooks (`PATH`, `HOME`), even runs the latency test's full
 * `process.env`, so both conditions share the same load. PROBE_STOP=1 stops
 * each fresh worker, and waits for its exit, before the next starts, as Pi
 * holds one worker at a time; by default all stay alive, as in latency.test.ts.
 */

const N = Number(process.env.PROBE_N ?? 20);
const PLAIN = process.env.PROBE_PLAIN === "1";
const OUT = process.env.PROBE_OUT ?? "/dev/null";
const LABEL = process.env.PROBE_LABEL ?? "probe";
const STOP = process.env.PROBE_STOP === "1";

const now = () => performance.timeOrigin + performance.now();

const WRAPPER = `const t = () => performance.timeOrigin + performance.now();
const p = { js: t(), cpuJs: process.threadCpuUsage() };
const { parentPort } = require("node:worker_threads");
let cur = {};
// serve's own listener and answer, wrapped: the port has no prependListener.
const on = parentPort.on.bind(parentPort);
parentPort.on = (type, listener) =>
  on(type, type !== "message" ? listener : (m) => { cur = { received: t() }; listener(m); });
const post = parentPort.postMessage.bind(parentPort);
parentPort.postMessage = (m) => {
  cur.answered = t();
  cur.cpu = process.threadCpuUsage();
  post({ ...m, probe: { ...p, ...cur } });
};
import("./worker.mjs").then(() => {
  p.evaluated = t();
  p.cpuEvaluated = process.threadCpuUsage();
});
`;

function psi(): number {
  const line = readFileSync("/proc/pressure/cpu", "utf8").split("\n")[0] ?? "";
  return Number(/avg10=([\d.]+)/.exec(line)?.[1] ?? Number.NaN);
}

function seeded(): SquealRepo {
  const r = squealRepo();
  const results = [];
  for (let f = 0; f < 50; f++) {
    const file = { project: "", path: `src/m${f}.test.ts` };
    r.store.testFileKeys.upsertMany([
      { worktreeId: r.worktreeId, testFile: file, key: `k${f}`, revision: 1, pending: null },
    ]);
    for (let c = 0; c < 10; c++) {
      results.push(
        result(check(`m${f} > case ${c}`, file), "pass", { key: `k${f}`, worktreeId: r.worktreeId }),
      );
    }
  }
  r.apply(r.pass(), ...results);
  return r;
}

let built = { dir: "", cleanup: () => {} };
beforeAll(async () => {
  built = await buildPiBundles();
  writeFileSync(join(built.dir, "probe-worker.cjs"), WRAPPER);
}, 60_000);
afterAll(() => built.cleanup());

it("times each fresh worker's phases", async () => {
  const r = seeded();
  const dir = runtimeDir();
  await liveSocket(join(dir, `squeal-${r.worktreeId}.sock`));
  const env = { ...process.env, XDG_RUNTIME_DIR: dir, SQUEAL_CLI: quietCli().cli };
  const minimal = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    XDG_RUNTIME_DIR: dir,
    SQUEAL_CLI: env.SQUEAL_CLI,
  };
  const entry = join(built.dir, PLAIN ? "worker.mjs" : "probe-worker.cjs");
  const session = { sessionId: SESSION, cwd: r.root };
  const first = createDeliveryHost(() => new Worker(join(built.dir, "worker.mjs"), { env }));
  expect(await first.call({ kind: "start", reason: "startup", ...session }, 2_000)).toMatch(
    /^SQUEAL · registered/,
  );
  const hosts = [first];
  try {
    for (let run = 0; run < N; run++) {
      const minEnv = run % 2 === 1;
      const marks: Record<string, unknown> = { label: LABEL, run, plain: PLAIN, minEnv, stop: STOP };
      let worker: Worker | null = null;
      const probes: unknown[] = [];
      marks.loadBefore = loadavg()[0];
      marks.psiBefore = psi();
      const fresh = createDeliveryHost(() => {
        marks.ctor0 = now();
        const w = new Worker(entry, { env: minEnv ? minimal : env });
        worker = w;
        marks.ctor1 = now();
        w.on("online", () => {
          marks.online = now();
        });
        w.on("error", (error) => {
          marks.error = String(error);
        });
        w.on("message", (m: { probe?: unknown }) => {
          if (m.probe !== undefined) probes.push({ ...(m.probe as object), at: now() });
        });
        return w;
      });
      hosts.push(fresh);
      const cpu0 = process.threadCpuUsage();
      const t0 = now();
      const answer = await fresh.call({ kind: "boundary", edited: true, ...session }, 2_000);
      const t1 = now();
      marks.mainCpu = process.threadCpuUsage(cpu0);
      expect(answer).toBeNull();
      expect(marks.error).toBeUndefined();
      if (!PLAIN) expect(probes).toHaveLength(1);
      const w0 = now();
      await fresh.call({ kind: "boundary", edited: true, ...session }, 2_000);
      marks.warm = now() - w0;
      marks.call = t0;
      marks.done = t1;
      marks.total = t1 - t0;
      marks.probes = probes;
      marks.loadAfter = loadavg()[0];
      marks.psiAfter = psi();
      appendFileSync(OUT, `${JSON.stringify(marks)}\n`);
      if (STOP && worker !== null) {
        const exited = new Promise((resolve) => (worker as Worker).once("exit", resolve));
        fresh.stop();
        await exited;
      }
    }
  } finally {
    for (const h of hosts) h.stop();
  }
}, 600_000);
