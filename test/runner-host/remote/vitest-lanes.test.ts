import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import type { RemoteHostOptions } from "../../../src/core/runner-host/remote/connect.js";
import {
  createDaemonRemote,
  type DaemonRemote,
  vitestOver,
} from "../../../src/core/runner-host/remote/daemon-lane.js";
import { readMachines } from "../../../src/core/runner-host/remote/machines-store.js";
import { remoteSettingsPath } from "../../../src/core/runner-host/remote/settings.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import type { RunnerAdapter, RunOptions } from "../../../src/core/types/runner.js";
import { POLICY, REPORT } from "../fake-channel.js";
import { until } from "./lane-fixture.js";
import { fake, refOf, servedHosts, VERSION } from "./share-fixture.js";

/*
 * Spec 026 D8.1 (row 026-11): the daemon's Vitest runner over a remote
 * (`vitestOver`). Each tier `lanes` names goes there: an edit's and a
 * background tier on the runner's own lane's host, and a slow, a group or a
 * beside tier on a host of that lane's own per pass, on the same machine,
 * closed when the pass ends. A `{ target }` entry keeps spec 021's default:
 * background tiers alone. Each host is served in this process.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-vitest-lanes-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const REF = refOf("vitest");
let n = 0;
const run = (lane: string, extra: Partial<RunOptions> = {}): RunOptions => ({
  runId: `r${++n}`,
  logDir: join(scratch, `logs${n}`),
  timeoutMs: 60_000,
  lane,
  ...extra,
});

function vitest(entry: Record<string, unknown>) {
  const dir = join(scratch, `v${++n}`);
  const root = join(dir, "repo");
  const remoteRoot = join(dir, "remote", "root");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  mkdirSync(remoteRoot, { recursive: true });
  mkdirSync(join(dir, "xdg", "squeal"), { recursive: true });
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "test/a.test.ts"), "import '../src/a';\n");
  execFileSync("git", ["init", "-q", root]);
  const real = realpathSync(root);
  const env = {
    XDG_CONFIG_HOME: join(dir, "xdg"),
    XDG_STATE_HOME: join(dir, "state"),
    HOME: join(dir, "home"),
    PATH: process.env.PATH,
  };
  writeFileSync(
    remoteSettingsPath(env),
    JSON.stringify({ repositories: { [real]: { target: "build-box", ...entry } } }),
  );
  /** Each remote run, by the lane its host started for. */
  const remoteRuns: string[] = [];
  /** Each run here, by the instance that ran it. */
  const localRuns: string[] = [];
  const closed: [string, number][] = [];
  const started: string[] = [];
  const serve = servedHosts(
    real,
    remoteRoot,
    (options) => async (files) => {
      remoteRuns.push(String(options.options.childEnv.LANE));
      return { ...REPORT, completedFiles: [...files] };
    },
    closed,
  );
  const startHost = (options: RemoteHostOptions) => {
    started.push(String(options.options.childEnv.LANE));
    return serve(options);
  };
  const notes: [string, string][] = [];
  const remote = createDaemonRemote({
    root: real,
    commonDir: join(real, ".git"),
    version: VERSION,
    launch: { execPath: process.execPath, execArgv: [], cli: join(dir, "squeal.mjs") },
    policy: () => DEFAULT_POLICY,
    note: (text, topic) => notes.push([topic, text]),
    lastNote: (topic) => notes.findLast(([t]) => t === topic)?.[1],
    log: () => {},
    env,
    startHost,
  }) as DaemonRemote;
  const instance = (name: string): RunnerAdapter =>
    fake("vitest", async (files) => {
      localRuns.push(name);
      return { ...REPORT, completedFiles: [...files] };
    });
  const runner = vitestOver(remote, {
    fast: instance("vitest"),
    lane: (lane) => instance(lane),
    beside: () => instance("beside:vitest"),
    start: (lane) => ({ options: { childEnv: { LANE: lane } }, policy: () => POLICY }),
  });
  onTestFinished(async () => {
    await runner.close();
    await remote.release();
  });
  return {
    runner,
    env,
    remoteRuns,
    localRuns,
    closed,
    started,
    /** The runner's own lane says its runs go there. */
    connected: () =>
      until(() => / go there/.test(notes.findLast(([t]) => t === "remote-lane")?.[1] ?? "")),
  };
}

describe("the daemon's Vitest runner over a remote (row 026-11)", () => {
  it("keeps a { target } entry's default: background tiers alone go there", async () => {
    const v = vitest({});
    await v.connected();
    await v.runner.run([REF], run("vitest"));
    await v.runner.run([REF], run("vitest", { background: true }));
    await v.runner.run([REF], run("slow:vitest"));
    await v.runner.run([REF], run("group:e2e:vitest"));
    await v.runner.run([REF], run("beside:vitest"));
    expect(v.remoteRuns).toEqual(["vitest"]);
    expect(v.localRuns).toEqual(["vitest", "slow:vitest", "group:e2e:vitest", "beside:vitest"]);
    expect(v.started).toEqual(["vitest"]);
  });

  it("sends every tier of lanes 'all', each slow, group and beside lane on its own host", async () => {
    const v = vitest({ lanes: "all" });
    await v.connected();
    await v.runner.run([REF], run("vitest"));
    await v.runner.run([REF], run("vitest", { background: true }));
    await v.runner.run([REF], run("slow:vitest"));
    await v.runner.run([REF], run("group:e2e:vitest"));
    await v.runner.run([REF], run("beside:vitest"));
    expect(v.localRuns).toEqual([]);
    expect(v.remoteRuns).toEqual([
      "vitest",
      "vitest",
      "slow:vitest",
      "group:e2e:vitest",
      "beside:vitest",
    ]);
    expect(v.started).toEqual(["vitest", "slow:vitest", "group:e2e:vitest", "beside:vitest"]);
    // The slow lane's pass ends: its host closes, the others stay, the machine is kept.
    await v.runner.releaseLane?.("slow:vitest");
    expect(v.closed.map(([lane]) => lane)).toEqual(["vitest"]);
    expect(readMachines(v.env).machines.map((m) => m.status)).toEqual(["awake"]);
    // Its next pass starts a host again.
    await v.runner.run([REF], run("slow:vitest"));
    expect(v.started.at(-1)).toBe("slow:vitest");
  });

  it("sends only the configured tiers: slow alone keeps edit tiers here", async () => {
    const v = vitest({ lanes: ["slow"] });
    await v.runner.run([REF], run("vitest"));
    await v.runner.run([REF], run("vitest", { background: true }));
    await v.runner.run([REF], run("slow:vitest"));
    await v.runner.run([REF], run("group:e2e:vitest"));
    expect(v.remoteRuns).toEqual(["slow:vitest"]);
    expect(v.localRuns).toEqual(["vitest", "vitest", "group:e2e:vitest"]);
  });
});
