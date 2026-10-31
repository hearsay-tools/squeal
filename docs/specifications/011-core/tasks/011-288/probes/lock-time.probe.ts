import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { build } from "esbuild";
import { afterAll, describe, expect, it } from "vitest";
import { HOOKS } from "../../../../../../src/harness/claude-code/index.js";
import { runHandler } from "../../../../../../src/harness/claude-code/run.js";
import { CODEX_HOOKS, runCodexHandler } from "../../../../../../src/harness/codex/index.js";
import { register } from "../../../../../../src/harness/opencode/bridge.js";
import { callBridge } from "../../../../../../src/harness/opencode/bridge-client.js";
import { after } from "../../../../../../src/harness/opencode/bridge-turn.js";
import { createDeliveryHost } from "../../../../../../src/harness/pi/host.js";
import { startSession, toolBoundary } from "../../../../../../src/harness/pi/session.js";
import { HandOff, writeThenCommit } from "../../../../../../src/harness/shared/hand-off.js";
import { codexRecorded } from "../../../../../../test/harness/codex/helpers.js";
import { recorded, SESSION, type SquealRepo, squealRepo } from "../../../../../../test/harness/helpers.js";
import "./lock-patch.ts";

// Throwaway probe, row 011-288: the extra time a normal (not stopped) delivery holds the
// store's write lock, from the end of its transaction body (where it committed before) to
// its COMMIT after the hand-off, per adapter. Claude Code and Codex: the real handler and
// `writeThenCommit` into a real pipe (`cat`), in this process. Pi: the real host and a built
// worker. OpenCode: the real `callBridge` and a built bridge. `lock-patch.ts` appends one
// `<ms>` line per commit to `$SQUEAL_LOCK_LOG` while it is set. Each round tells the recovery
// unmeasured, so the next failure is a transition again.

const RUNS = 15;
const deps = { env: {}, ensureDaemon: async () => "alive" as const };
const dir = mkdtempSync(join(tmpdir(), "squeal-lock-time-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const PATCH = JSON.stringify(resolve("docs/specifications/011-core/tasks/011-288/probes/lock-patch.ts"));
const src = (path: string) => JSON.stringify(resolve("src", path));

async function bundle(name: string, body: string): Promise<string> {
  const outfile = join(dir, `${name}.mjs`);
  await build({
    stdin: { contents: `import ${PATCH};\n${body}`, resolveDir: process.cwd(), loader: "ts" },
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
  });
  return outfile;
}

const stats = (log: string) => {
  const ms = readFileSync(log, "utf8").trim().split("\n").map(Number).sort((a, b) => a - b);
  const at = (q: number) => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] ?? Number.NaN;
  return { n: ms.length, p50: at(0.5), p95: at(0.95), max: ms.at(-1) };
};

function repo(): SquealRepo {
  const r = squealRepo();
  r.policy({});
  r.apply(r.pass());
  return r;
}

/** Runs `fn` with `$SQUEAL_LOCK_LOG` set to `log`. */
async function logged<T>(log: string, fn: () => Promise<T>): Promise<T> {
  process.env.SQUEAL_LOCK_LOG = log;
  try {
    return await fn();
  } finally {
    delete process.env.SQUEAL_LOCK_LOG;
  }
}

describe("extra write-lock time of a normal delivery (row 011-288)", () => {
  for (const h of ["claude", "codex"] as const) {
    it(`${h}: write to a pipe, its callback, COMMIT`, async () => {
      const r = repo();
      const input = (name: string) =>
        h === "claude" ? recorded(name, r.root) : codexRecorded("exec", name, r.root);
      const handle = (name: string, handOff?: HandOff) => {
        const own = handOff === undefined ? deps : { ...deps, handOff };
        return h === "claude"
          ? runHandler(name, HOOKS[name as keyof typeof HOOKS], input(name), own)
          : runCodexHandler(name, CODEX_HOOKS[name as keyof typeof CODEX_HOOKS], input(name), own);
      };
      await handle("session-start");
      const boundary = h === "claude" ? "post-tool-batch" : "post-tool-use";
      const log = join(dir, `${h}.log`);
      const cat = spawn("cat", [], { stdio: ["pipe", "ignore", "ignore"] });
      try {
        for (let i = 0; i < RUNS; i++) {
          r.apply(r.fail());
          const out = await logged(log, async () => {
            const handOff = new HandOff();
            const result = await handle(boundary, handOff);
            await writeThenCommit(handOff, [[cat.stdin, result.stdout]]);
            return result.stdout;
          });
          expect(out).toContain("PASS -> FAIL");
          r.apply(r.pass());
          expect((await handle(boundary)).stdout).toContain("FAIL -> PASS");
        }
      } finally {
        cat.stdin.end();
      }
      console.log(JSON.stringify({ adapter: h, ...stats(log) }));
    });
  }

  it("pi: the host's verdict round trip, COMMIT", async () => {
    const entry = await bundle("worker", `
      import { parentPort, workerData } from "node:worker_threads";
      import { serve, verdictsOf } from ${src("harness/pi/worker.ts")};
      serve(parentPort, { env: {}, ensureDaemon: async () => "alive" }, verdictsOf(workerData));
    `);
    const r = repo();
    const session = { sessionId: SESSION, cwd: r.root };
    await startSession({ ...session, reason: "startup" }, deps);
    const log = join(dir, "pi.log");
    const host = createDeliveryHost(
      (verdicts) =>
        new Worker(entry, {
          workerData: { verdicts },
          env: { PATH: process.env.PATH ?? "", HOME: dir, XDG_RUNTIME_DIR: dir, SQUEAL_LOCK_LOG: log },
        }),
    );
    try {
      for (let i = 0; i < RUNS; i++) {
        r.apply(r.fail());
        const answer = await host.call({ kind: "boundary", ...session, edited: false }, 5_000);
        expect(answer).toContain("PASS -> FAIL");
        // The worker commits on the verdict, just after the answer: wait for the view.
        for (let n = 0; n < 200 && r.store.views.list(r.consumer()).some((v) => v.outcome === "pass"); n++) {
          await new Promise((done) => setTimeout(done, 5));
        }
        r.apply(r.pass());
        expect(await toolBoundary(session, deps, false)).toContain("FAIL -> PASS");
      }
    } finally {
      host.stop();
    }
    console.log(JSON.stringify({ adapter: "pi", ...stats(log) }));
  });

  it("opencode: answer line, plugin read, SIGUSR2, COMMIT", async () => {
    const entry = await bundle("after", `
      import { readFileSync } from "node:fs";
      import { runBridge } from ${src("harness/opencode/bridge.ts")};
      import { after } from ${src("harness/opencode/bridge-turn.ts")};
      await runBridge(readFileSync(0, "utf8"), new URL(import.meta.url), "after", after);
    `);
    const r = repo();
    const about = { consumer: { sessionId: SESSION }, worktree: r.root, pid: process.pid };
    await register({ kind: "register", ...about }, deps);
    const log = join(dir, "opencode.log");
    for (let i = 0; i < RUNS; i++) {
      r.apply(r.fail());
      const answer = await logged(log, () =>
        callBridge<{ text: string | null }>(
          { node: process.execPath, entry },
          { kind: "after", ...about, tool: "bash" },
          r.root,
          5_000,
        ),
      );
      expect(answer?.text).toContain("PASS -> FAIL");
      for (let n = 0; n < 200 && r.store.views.list(r.consumer()).some((v) => v.outcome === "pass"); n++) {
        await new Promise((done) => setTimeout(done, 5));
      }
      r.apply(r.pass());
      expect((await after({ kind: "after", ...about, tool: "bash" }, deps)).text).toContain("FAIL -> PASS");
    }
    console.log(JSON.stringify({ adapter: "opencode", ...stats(log) }));
  });
});
