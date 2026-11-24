import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import {
  createDaemonRemote,
  type DaemonRemote,
} from "../../../src/core/runner-host/remote/daemon-lane.js";
import type { RemoteLaneRunner } from "../../../src/core/runner-host/remote/lane.js";
import { remoteSettingsPath } from "../../../src/core/runner-host/remote/settings.js";
import { DEFAULT_POLICY, type Policy } from "../../../src/core/types/policy.js";
import type { RunnerAdapter, RunOptions } from "../../../src/core/types/runner.js";
import { POLICY, REPORT } from "../fake-channel.js";
import { until } from "./lane-fixture.js";
import { fake, refOf, servedHosts, VERSION } from "./share-fixture.js";

/*
 * Spec 026 D8.3, D8.4 (row 026-12): the daemon's lane over a `command`
 * machine. An entry whose `lanes` names `edit` plans there by default: the
 * runner here gets no call across the connect, planning, edits and runs.
 * A machine that says `hasGitRepository` takes `needsRepository` files.
 * Once the daemon's exit began, a planning call starts nothing here.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-daemon-planning-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const REF = refOf("vitest");
const GIT = { project: "", path: "test/git.test.ts" };
let n = 0;
const run = (extra: Partial<RunOptions> = {}): RunOptions => ({
  runId: `r${++n}`,
  logDir: join(scratch, `logs${n}`),
  timeoutMs: 60_000,
  lane: "vitest",
  ...extra,
});

function daemon(entry: Record<string, unknown>, hasGitRepository: boolean) {
  const dir = join(scratch, `p${++n}`);
  const root = join(dir, "repo");
  const remoteRoot = join(dir, "remote", "root");
  for (const sub of ["src", "test"]) mkdirSync(join(root, sub), { recursive: true });
  mkdirSync(remoteRoot, { recursive: true });
  mkdirSync(join(dir, "xdg", "squeal"), { recursive: true });
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "test/a.test.ts"), "import '../src/a';\n");
  writeFileSync(join(root, "test/git.test.ts"), "import '../src/a';\n");
  execFileSync("git", ["init", "-q", root]);
  const real = realpathSync(root);
  const hook = (name: string, body = "") => {
    const path = join(dir, `${name}.mjs`);
    writeFileSync(path, body);
    return [process.execPath, path];
  };
  const answer = {
    v: 1,
    id: "lan",
    destination: "dev@lan-box",
    sleepOnIdle: true,
    hasGitRepository,
  };
  const env = {
    XDG_CONFIG_HOME: join(dir, "xdg"),
    XDG_STATE_HOME: join(dir, "state"),
    HOME: join(dir, "home"),
    PATH: process.env.PATH,
  };
  writeFileSync(
    remoteSettingsPath(env),
    JSON.stringify({
      repositories: {
        [real]: {
          provider: "command",
          providerConfig: {
            acquire: hook("acquire", `console.log(${JSON.stringify(JSON.stringify(answer))});`),
            wake: hook("wake"),
            sleep: hook("sleep"),
            release: hook("release"),
          },
          ...entry,
        },
      },
    }),
  );
  const remoteRuns: string[] = [];
  const policy: Policy = {
    ...DEFAULT_POLICY,
    remote: { ...DEFAULT_POLICY.remote, needsRepository: ["test/git.*"] },
  };
  const notes: [string, string][] = [];
  const remote = createDaemonRemote({
    root: real,
    commonDir: join(real, ".git"),
    version: VERSION,
    launch: { execPath: process.execPath, execArgv: [], cli: join(dir, "squeal.mjs") },
    policy: () => policy,
    note: (text, topic) => notes.push([topic, text]),
    lastNote: (topic) => notes.findLast(([t]) => t === topic)?.[1],
    log: () => {},
    env,
    startHost: servedHosts(real, remoteRoot, () => async (files) => {
      remoteRuns.push(files.map((f) => f.path).join(","));
      return { ...REPORT, completedFiles: [...files] };
    }),
  }) as DaemonRemote;
  /** Every call on the runner here but `close`. */
  const localCalls: string[] = [];
  const here = fake("vitest", async () => REPORT);
  const spy = new Proxy(here, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function" || key === "close") return value;
      return (...args: unknown[]) => {
        localCalls.push(String(key));
        return value.apply(target, args);
      };
    },
  }) as RunnerAdapter;
  const lane = remote.wrap({
    runner: "vitest",
    local: spy,
    tiers: ["edit", "background"],
    start: { options: { childEnv: {} }, policy: () => POLICY },
  }) as unknown as RemoteLaneRunner;
  onTestFinished(async () => {
    await lane.close();
    await remote.release();
  });
  return {
    lane,
    remote,
    root: real,
    remoteRuns,
    localCalls,
    connected: () =>
      until(() => / go there/.test(notes.findLast(([t]) => t === "remote-lane")?.[1] ?? "")),
  };
}

describe("the daemon's lane that plans on its machine (026 D8.3, D8.4)", () => {
  it("makes no call here across connect, planning, an edit and runs, and sends repository readers there", async () => {
    const d = daemon({ lanes: ["edit", "background"] }, true);
    await d.connected();
    await d.lane.testFiles();
    await d.lane.affected(["src/a.ts"]);
    await d.lane.closure(REF);
    writeFileSync(join(d.root, "src/a.ts"), "export const a = 2;\n");
    await d.lane.invalidate([{ path: "src/a.ts", kind: "change" }]);
    await d.lane.run([REF, GIT], run());
    await d.lane.run([REF], run({ background: true }));
    expect(d.remoteRuns).toEqual([`${REF.path},${GIT.path}`, REF.path]);
    expect(d.localCalls).toEqual([]);
  });

  it("keeps planning here when the entry says planning local, and repository readers here without .git there", async () => {
    const d = daemon({ lanes: ["edit", "background"], planning: "local" }, false);
    await d.connected();
    await d.lane.affected(["src/a.ts"]);
    await d.lane.run([REF, GIT], run());
    expect(d.localCalls).toEqual(expect.arrayContaining(["environment", "affected", "run"]));
    expect(d.remoteRuns).toEqual([REF.path]);
  });

  it("starts nothing here for a planning call after the daemon's exit began", async () => {
    const d = daemon({ lanes: ["edit", "background"], whenLost: "local" }, false);
    await d.connected();
    expect((await d.remote.sleepRemote()).kind).toBe("slept");
    await d.remote.release();
    await expect(d.lane.affected([])).rejects.toThrow("its lane closed; not planned here");
    expect(d.localCalls).toEqual([]);
  });
});
