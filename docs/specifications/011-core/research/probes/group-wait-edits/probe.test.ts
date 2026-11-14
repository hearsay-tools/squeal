import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { daemonSuite, spawnCli, waitReady, withStore } from "../../../../../../test/daemon/helpers.js";
import { CODE_OFF } from "../../../../../../test/helpers/policy.js";
import { runGroupCommand } from "../../../../../../src/cli/run-group.js";
import { syncDaemon } from "../../../../../../src/cli/status-sync.js";

/*
 * Throwaway probe, row 011-332 (waits.md decision 5). A real daemon on the
 * scheduler fixture, as test/cli/run-group-daemon.test.ts starts one: fixture
 * under test/fixtures/scheduler/.tmp, XDG_RUNTIME_DIR and XDG_CONFIG_HOME in a
 * private /tmp directory; HOME is also moved there, so nothing reaches the real one.
 *
 * Each run: wait until the store's revision is still for QUIET_MS, write
 * src/value.ts (a source file only the e2e group's test reads), then at once
 * spawn `squeal run e2e --wait`. Afterwards read the revision the edit made.
 * A request taken at a revision below the edit's missed the edit.
 *
 * RUNS and GAP_MS (ms between the write and the spawn) come from the environment.
 */

const RUNS = Number(process.env.PROBE_RUNS ?? 24);
/**
 * `cli`: spawn the built CLI (a user's command). `inproc`: call
 * `runGroupCommand` in this process, with no Node startup between the write
 * and the request. `latency`: no command; poll the store every 5 ms for the
 * edit's revision, the window a request could miss it in.
 */
const MODE = (process.env.PROBE_MODE ?? "cli") as "cli" | "inproc" | "inproc-sync" | "latency";
/* `inproc-sync`: `inproc` after the status waits' sync (`syncDaemon`), the candidate fix; its time is recorded. */
const GAP_MS = Number(process.env.PROBE_GAP_MS ?? 0);
const OUT = process.env.PROBE_OUT ?? join(import.meta.dirname, "evidence", `${MODE}-gap${GAP_MS}.ndjson`);
const QUIET_MS = 1_500;

const suite = daemonSuite();

const POLICY = {
  ...CODE_OFF,
  checks: [{ name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" }],
};

const TEST = `import { expect, it } from "vitest";
import { value } from "../../src/value.ts";

it("reads the value", () => {
  expect(value()).toBe(1);
});
`;

const source = (expected: number, n: number) =>
  `// edit ${n}\nexport const value = (): number => ${expected};\n`;

describe("group-wait-edits probe", () => {
  it("edit, then at once run <group> --wait", async () => {
    const repo = suite.fixture({
      "squeal.config.json": `${JSON.stringify(POLICY)}\n`,
      "src/value.ts": source(1, 0),
      "test/e2e/value.test.ts": TEST,
    });
    const home = join(repo.runtimeDir, "home");
    mkdirSync(home, { recursive: true });
    const env = { ...repo.env, HOME: home };
    const cli = suite.cli;
    const revision = () =>
      withStore(repo, (s) => s.revisions.latest(repo.worktreeId as never)?.number ?? 0);
    const quiet = async (): Promise<number> => {
      let last = revision();
      let since = Date.now();
      for (const end = Date.now() + 120_000; Date.now() < end; ) {
        await sleep(100);
        const now = revision();
        if (now !== last) {
          last = now;
          since = Date.now();
        } else if (Date.now() - since >= QUIET_MS) return now;
      }
      return last;
    };
    const run = async (args: string[]) => {
      const child = spawnCli(cli, args, { cwd: repo.root, env });
      const exited = await child.exited;
      return { code: exited.code, stdout: child.stdout(), stderr: child.stderr() };
    };

    const inproc = async () => {
      let stdout = "";
      let stderr = "";
      const io = {
        stdout: (t: string) => void (stdout += t),
        stderr: (t: string) => void (stderr += t),
        cwd: repo.root,
        env,
      };
      let syncMs: number | null = null;
      let syncRev: number | null = null;
      if (MODE === "inproc-sync") {
        const t = performance.now();
        const sync = syncDaemon(repo.root as never, 50);
        await sync.answered;
        sync.stop();
        syncMs = Math.round(performance.now() - t);
        const state = sync.current();
        syncRev = state.state === "synced" ? state.revision : null;
      }
      const code = await runGroupCommand({ waitMs: 300_000, rest: ["e2e"] }, io, "");
      return { code, stdout, stderr, syncMs, syncRev };
    };

    // The daemon in the private env as well (spawnDaemon takes repo.env; pass HOME too).
    const daemon = spawnCli(cli, ["daemon", repo.root], { cwd: repo.root, env });
    try {
      await waitReady(repo, daemon);
      // A first result for the group's file, at the fixture's revision.
      const warm = await run(["run", "e2e", "--wait", "300000"]);
      writeFileSync(`${OUT}.warm.txt`, warm.stdout + warm.stderr);
      writeFileSync(OUT, "");
      for (let i = 1; i <= RUNS; i++) {
        const before = await quiet();
        const expected = i % 2 === 1 ? 2 : 1; // odd runs fail, even runs pass
        const [load1] = loadavg();
        const t0 = performance.now();
        writeFileSync(join(repo.root, "src/value.ts"), source(expected, i));
        if (GAP_MS > 0) await sleep(GAP_MS);
        const spawnedAt = performance.now() - t0;
        if (MODE === "latency") {
          let seen = revision();
          while (seen <= before && performance.now() - t0 < 30_000) {
            await sleep(5);
            seen = revision();
          }
          const record = {
            run: i,
            load1: Math.round(load1 * 100) / 100,
            cpus: cpus().length,
            before,
            edit: seen,
            storedMs: Math.round(performance.now() - t0),
          };
          writeFileSync(OUT, `${JSON.stringify(record)}\n`, { flag: "a" });
          continue;
        }
        const result: { code: number | null; stdout: string; stderr: string; syncMs?: number | null; syncRev?: number | null } =
          MODE === "cli" ? await run(["run", "e2e", "--wait", "300000"]) : await inproc();
        const ranMs = Math.round(performance.now() - t0);
        // The revision the edit made: the first above `before`.
        let edit = revision();
        for (const end = Date.now() + 30_000; edit <= before && Date.now() < end; ) {
          await sleep(100);
          edit = revision();
        }
        const [verdictLine = "", requestLine = ""] = result.stdout.split("\n");
        const verdictRev = Number(/at revision (\d+)/.exec(verdictLine)?.[1] ?? Number.NaN);
        const requestRev = Number(/at revision (\d+)/.exec(requestLine)?.[1] ?? Number.NaN);
        const queued = /^No test files/.test(requestLine)
          ? 0
          : Number(/(\d+) test files? queued/.exec(requestLine)?.[1] ?? Number.NaN);
        const right = expected === 1 ? 0 : 1;
        const record = {
          run: i,
          load1: Math.round(load1 * 100) / 100,
          cpus: cpus().length,
          mode: MODE,
          gapMs: GAP_MS,
          spawnedAtMs: Math.round(spawnedAt),
          ranMs,
          before,
          edit,
          requestRev,
          verdictRev,
          queued,
          expectedCode: right,
          code: result.code,
          missed: requestRev < edit,
          syncMs: result.syncMs ?? null,
          syncRev: result.syncRev ?? null,
          wrongVerdict: result.code !== right,
          verdictLine,
          requestLine,
          stderr: result.stderr.trim().slice(0, 300),
        };
        writeFileSync(OUT, `${JSON.stringify(record)}\n`, { flag: "a" });
        // After a missed run the edit is stale and the stop group never runs it;
        // the next request queues it, so nothing else is needed between runs.
      }
    } finally {
      daemon.child.kill("SIGTERM");
      await daemon.exited;
    }
    expect(true).toBe(true);
  });
});
