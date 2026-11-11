import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import type { HostedAdapter } from "../../../src/core/runner-host/host.js";
import { type RemoteHost, remoteHostOver } from "../../../src/core/runner-host/remote/connect.js";
import { withRemoteLane } from "../../../src/core/runner-host/remote/lane.js";
import type { WhenLost } from "../../../src/core/runner-host/remote/settings.js";
import { createTreeHost } from "../../../src/core/runner-host/remote/tree-host.js";
import type {
  RunnerAdapter,
  RunnerEnvironment,
  RunOptions,
  RunReport,
} from "../../../src/core/types/runner.js";
import { inProcessHost, POLICY, REPORT } from "../fake-channel.js";

/*
 * Spec 021 D11 to D13 (row 021-14): the lane sends background runs to the
 * remote and keeps a result only over a proven tree and an equal
 * environment; a refusal sends the files again and retries once; a lost or
 * hung host ends its run incomplete, and the policy decides what follows.
 * The host is served in this process over a real proxy and tree host.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-remote-lane-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const REF = { project: "", path: "test/a.test.ts" };
const ENV: RunnerEnvironment = {
  project: "",
  runnerName: "vitest",
  runnerVersion: "5.0.3",
  adapterVersion: "1",
  resolvedConfig: "{}",
  files: ["vitest.config.ts"],
};

interface Setup {
  readonly whenLost?: WhenLost;
  readonly remoteEnv?: RunnerEnvironment;
  readonly remoteRun?: (root: string, hang: () => void) => Promise<RunReport>;
  readonly aliveMs?: number;
}

let n = 0;
async function setup({ whenLost = "local", remoteEnv = ENV, remoteRun, aliveMs }: Setup = {}) {
  const dir = join(scratch, `s${++n}`);
  const root = join(dir, "local");
  const remoteRoot = join(dir, "remote", "root");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  mkdirSync(remoteRoot, { recursive: true });
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "test/a.test.ts"), "import '../src/a';\n");
  writeFileSync(join(root, "vitest.config.ts"), "export default {};\n");
  execFileSync("git", ["init", "-q", root]);

  const remoteRuns: string[] = [];
  const localRuns: RunOptions[] = [];
  let paused = false;
  const fake = (env: RunnerEnvironment, run: HostedAdapter["run"]): HostedAdapter => ({
    name: "vitest",
    adapterVersion: "1",
    invalidate: async () => ({ recreatedProjects: [] }),
    affected: async () => ({ direct: [REF], transitive: [] }),
    closure: async (testFile) => ({ testFile, paths: ["src/a.ts", "test/a.test.ts"] }),
    enumerate: async () => [],
    testFiles: async () => [REF],
    environment: async () => [env],
    run,
    close: async () => {},
  });
  const connects: number[] = [];
  const connect = async (): Promise<RemoteHost> => {
    connects.push(Date.now());
    const host = inProcessHost(
      async () =>
        fake(remoteEnv, async (files) => {
          remoteRuns.push(files.map((f) => f.path).join(","));
          return remoteRun === undefined
            ? { ...REPORT, completedFiles: [...files] }
            : remoteRun(remoteRoot, () => {
                paused = true;
              });
        }),
      "0.0.0-test",
      { tree: createTreeHost(remoteRoot, () => {}) },
    );
    // A paused remote: nothing more reaches the daemon.
    const output = new PassThrough();
    output.setEncoding("utf8");
    host.channel.output.on("data", (chunk: string) => {
      if (!paused) output.write(chunk);
    });
    onTestFinished(() => host.channel.kill());
    return remoteHostOver({ ...host.channel, output }, "v-test", {
      target: { destination: "box" },
      version: "0.0.0-test",
      root,
      runner: "vitest",
      options: { childEnv: {} },
      policy: () => POLICY,
      ...(aliveMs === undefined ? {} : { deadlines: { aliveMs } }),
    });
  };
  const local: RunnerAdapter = fake(ENV, async (files, options) => {
    localRuns.push(options);
    return { ...REPORT, completedFiles: [...files] };
  });
  const statuses: string[] = [];
  const logs: string[] = [];
  let clock = 1_000_000;
  const lane = withRemoteLane({
    target: "box",
    whenLost,
    root,
    version: "0.0.0-test",
    local,
    connect,
    allowlist: () => [],
    status: (text) => statuses.push(text),
    log: (text) => logs.push(text),
    now: () => clock,
    backoffMs: [60_000],
  });
  onTestFinished(() => lane.close());
  await until(() => statuses.some((s) => s.includes("go there")));
  return {
    lane,
    root,
    remoteRoot,
    remoteRuns,
    localRuns,
    statuses,
    logs,
    connects,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

async function until(done: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error("until: not met");
    await sleep(10);
  }
}

const options = (extra: Partial<RunOptions> = {}): RunOptions => ({
  runId: `r${++n}`,
  logDir: join(scratch, `logs${n}`),
  timeoutMs: 60_000,
  ...extra,
});
const background = (extra: Partial<RunOptions> = {}) =>
  options({ background: true, workers: 2, lane: "vitest", ...extra });

describe("a remote lane (row 021-14)", () => {
  it("runs a background tier on the remote, proven, and every other run here", async () => {
    const s = await setup();
    await s.lane.run([REF], options());
    await s.lane.run([REF], background({ lane: "slow:vitest" }));
    expect(s.remoteRuns).toEqual([]);
    expect(s.localRuns).toHaveLength(2);
    const report = await s.lane.run([REF], background());
    expect(report.end).toBe("completed");
    expect(s.remoteRuns).toEqual(["test/a.test.ts"]);
    expect(s.statuses.at(-1)).toMatch(/^remote box: background runs of vitest go there; proven at/);
    expect(report).not.toHaveProperty("proof");
  });

  it("refuses a tree that differs before the run, sends the files again, and runs the retry", async () => {
    const s = await setup();
    writeFileSync(join(s.remoteRoot, "src/a.ts"), "drifted\n");
    await s.lane.run([REF], background());
    expect(s.logs).toContain("remote box: tree differs at src/a.ts; sending again");
    expect(readFileSync(join(s.remoteRoot, "src/a.ts"), "utf8")).toBe("export const a = 1;\n");
    expect(s.remoteRuns).toHaveLength(1);
    expect(s.localRuns).toHaveLength(0);
  });

  it("keeps no result of a run whose tree moved during it, twice: it runs here", async () => {
    const s = await setup({
      remoteRun: async (remoteRoot) => {
        writeFileSync(join(remoteRoot, "src/a.ts"), `moved ${Math.random()}\n`);
        return REPORT;
      },
    });
    await s.lane.run([REF], background());
    expect(s.remoteRuns).toHaveLength(2);
    expect(s.localRuns).toHaveLength(1);
    expect(s.statuses.at(-1)).toBe(
      "remote box: refused a run whose tree stayed different; ran it here",
    );
  });

  it("refuses a remote whose environment differs, and names the difference", async () => {
    const s = await setup({ remoteEnv: { ...ENV, runnerVersion: "5.0.2" } });
    await s.lane.run([REF], background());
    expect(s.remoteRuns).toEqual([]);
    expect(s.localRuns).toHaveLength(1);
    expect(s.statuses.at(-1)).toMatch(
      /^remote box refused: .*5\.0\.2 on the remote, 5\.0\.3 here; running here$/,
    );
  });

  it("ends a hung remote's run unknown within its deadline, then runs here and reconnects later", async () => {
    const s = await setup({
      aliveMs: 200,
      remoteRun: (_, hang) => {
        hang();
        return new Promise(() => {});
      },
    });
    const started = Date.now();
    const report = await s.lane.run([REF], background());
    expect(report.end).toBe("timed-out");
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(s.statuses.at(-1)).toMatch(
      /^remote box unreachable since .* \(the vitest runner host did not answer run, nor tell it is alive, within 200 ms; Squeal stopped it\); running here$/,
    );
    await s.lane.run([REF], background());
    expect(s.localRuns).toHaveLength(1);
    expect(s.connects).toHaveLength(1);
    s.advance(60_000);
    await s.lane.run([REF], background());
    expect(s.connects).toHaveLength(2);
  });

  it("leaves a lost remote's files not run under whenLost not-run, and says how many", async () => {
    const s = await setup({
      whenLost: "not-run",
      aliveMs: 200,
      remoteRun: (_, hang) => {
        hang();
        return new Promise(() => {});
      },
    });
    await s.lane.run([REF], background());
    const report = await s.lane.run([REF], background());
    expect(report.end).toBe("crashed");
    expect(report.failure).toMatch(/not run here/);
    expect(s.localRuns).toHaveLength(0);
    expect(s.statuses.at(-1)).toMatch(/unreachable since .*; 1 files not run$/);
  });
});
