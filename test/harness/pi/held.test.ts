import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { createDeliveryHost } from "../../../src/harness/pi/host.js";
import { startSession, toolBoundary } from "../../../src/harness/pi/session.js";
import { tempDir } from "../../store/helpers.js";
import { SESSION, type SquealRepo, squealRepo } from "../helpers.js";

/*
 * Row 011-288 (011 C8 as amended 2026-10-31): a Pi report commits only
 * when the host received the worker's answer before its deadline. A worker
 * whose answer, its report prepared, never reaches the host leaves the
 * report owed: the next boundary tells the transition once, and the one
 * after it does not repeat it. The research probe
 * (`research/delivery-receipt.md`) showed the opposite at 0.1.384.
 */

const TRANSITION = "PASS -> FAIL";
const DEADLINE_MS = 2_000;
const deps = { env: {}, ensureDaemon: async () => "alive" as const };

/**
 * The real `serve`, its port wrapped: with `workerData.lose`, the first
 * answer that carries a report is written to `workerData.mark` and never
 * posted, as an answer that misses the host's deadline.
 */
async function workerEntry(dir: string): Promise<string> {
  const serve = JSON.stringify(resolve("src/harness/pi/worker.ts"));
  const code = `
    import { writeFileSync } from "node:fs";
    import { parentPort, workerData } from "node:worker_threads";
    import { serve, verdictsOf } from ${serve};
    let lose = workerData.lose;
    const port = {
      on: (event, listener) => parentPort.on(event, listener),
      postMessage: (message) => {
        if (lose && message.ok && message.answer !== null) {
          lose = false;
          writeFileSync(workerData.mark, JSON.stringify(message));
          return;
        }
        parentPort.postMessage(message);
      },
    };
    serve(port, { env: {}, ensureDaemon: async () => "alive" }, verdictsOf(workerData));
  `;
  const outfile = join(dir, "worker.mjs");
  await build({
    stdin: { contents: code, resolveDir: process.cwd(), loader: "ts" },
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
  });
  return outfile;
}

/** A registered session whose check went from PASS to FAIL since, its view still `pass`. */
async function failedSince(): Promise<SquealRepo> {
  const r = squealRepo();
  r.policy({});
  r.apply(r.pass());
  await startSession({ sessionId: SESSION, cwd: r.root, reason: "startup" }, deps);
  r.apply(r.fail());
  return r;
}

const viewOf = (r: SquealRepo) =>
  r.store.views.list(r.consumer()).find((v) => v.check.kind === "test")?.outcome;
const count = (text: string | null) => (text ?? "").split(TRANSITION).length - 1;

async function until(condition: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) return false;
    await new Promise((done) => setTimeout(done, 5));
  }
  return true;
}

/**
 * One boundary through the real host and the built worker. The worker
 * commits on the host's verdict, just after the host received the answer:
 * the host stops once the view moved or `settleMs` passed.
 */
async function hosted(r: SquealRepo, lose: boolean, settleMs = 0) {
  const dir = tempDir("squeal-pi-held-");
  const file = await workerEntry(dir);
  const mark = join(dir, "lost.json");
  const host = createDeliveryHost(
    (verdicts) =>
      new Worker(file, {
        workerData: { verdicts, lose, mark },
        env: { PATH: process.env.PATH ?? "", HOME: dir, XDG_RUNTIME_DIR: dir },
      }),
  );
  const request = { kind: "boundary", sessionId: SESSION, cwd: r.root, edited: false } as const;
  try {
    const answer = await host.call(request, DEADLINE_MS);
    await until(() => viewOf(r) === "fail", settleMs);
    return { answer, lost: existsSync(mark) ? readFileSync(mark, "utf8") : null };
  } finally {
    host.stop();
  }
}

describe("Pi: a report commits only on the host's verdict (row 011-288)", () => {
  it("tells a transition once and commits it, when the host receives the answer in time", async () => {
    const r = await failedSince();
    const { answer } = await hosted(r, false, DEADLINE_MS);
    expect(count(answer)).toBe(1);
    expect(viewOf(r)).toBe("fail");
    expect(count(await toolBoundary({ sessionId: SESSION, cwd: r.root }, deps, false))).toBe(0);
  }, 60_000);

  it("keeps the transition owed when the prepared answer misses the host's deadline", async () => {
    const r = await failedSince();
    const { answer, lost } = await hosted(r, true);
    expect(answer).toBeNull();
    expect(lost).toContain(TRANSITION);
    expect(viewOf(r)).toBe("pass");
    expect(count(await toolBoundary({ sessionId: SESSION, cwd: r.root }, deps, false))).toBe(1);
    expect(viewOf(r)).toBe("fail");
    expect(count(await toolBoundary({ sessionId: SESSION, cwd: r.root }, deps, false))).toBe(0);
  }, 60_000);
});
