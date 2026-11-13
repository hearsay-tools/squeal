import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  REMOTE_SETTINGS_TOPIC,
  REMOTE_TOPIC,
  withDaemonRemoteLane,
} from "../../../src/core/runner-host/remote/daemon-lane.js";
import { remoteSettingsPath } from "../../../src/core/runner-host/remote/settings.js";
import { DEFAULT_POLICY, type Policy } from "../../../src/core/types/policy.js";
import type { RunnerAdapter, RunOptions } from "../../../src/core/types/runner.js";
import { NO_TRAITS } from "../../../src/core/types/runner-traits.js";
import { REPORT } from "../fake-channel.js";

/*
 * Spec 021 D9, D17 (rows 021-13, 021-14): which lane the daemon's Vitest
 * runner gets, and the status line that says so. No test reads the real
 * home: each names its own config directory. Row 021-23 (D19.2): the
 * policy's `remote.needsRepository` reaches the lane.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-daemon-lane-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const vitest: RunnerAdapter = {
  name: "vitest",
  adapterVersion: "1",
  traits: NO_TRAITS,
  invalidate: async () => ({ recreatedProjects: [] }),
  affected: async () => ({ direct: [], transitive: [] }),
  closure: async (testFile) => ({ testFile, paths: [] }),
  enumerate: async () => [],
  testFiles: async () => [],
  environment: async () => [],
  run: async () => REPORT,
  close: async () => {},
};

let n = 0;
function lane(settings: unknown, policy: Policy = DEFAULT_POLICY, notes: [string, string][] = []) {
  const dir = join(scratch, `d${++n}`);
  const root = join(dir, "repo");
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q", root]);
  const env = {
    XDG_CONFIG_HOME: join(dir, "xdg"),
    HOME: join(dir, "home"),
    PATH: process.env.PATH,
  };
  mkdirSync(join(dir, "xdg", "squeal"), { recursive: true });
  const real = realpathSync(root);
  if (settings !== undefined) {
    writeFileSync(
      remoteSettingsPath(env),
      JSON.stringify(typeof settings === "function" ? settings(real) : settings),
    );
  }
  const adapter = withDaemonRemoteLane({
    root: real,
    commonDir: join(real, ".git"),
    version: "0.0.0-test",
    launch: {
      execPath: process.execPath,
      execArgv: [],
      cli: join(dir, "no-bundle/cli/squeal.mjs"),
    },
    policy: () => policy,
    vitest,
    vitestOptions: { root: real },
    note: (text, topic) => notes.push([topic, text]),
    lastNote: (topic) => notes.findLast(([t]) => t === topic)?.[1],
    log: () => {},
    env,
  });
  onTestFinished(() => adapter.close());
  return { adapter, notes };
}

describe("the daemon's remote lane (rows 021-13, 021-14)", () => {
  it("is none without a setting, and says nothing", () => {
    const { adapter, notes } = lane(undefined);
    expect(adapter).toBe(vitest);
    expect(notes).toEqual([]);
  });

  it("is none when the repository forbids it, and status says why", () => {
    const off = { ...DEFAULT_POLICY, remote: { ...DEFAULT_POLICY.remote, allowed: false } };
    const { adapter, notes } = lane(
      (root: string) => ({ repositories: { [root]: { target: "build-box" } } }),
      off,
    );
    expect(adapter).toBe(vitest);
    expect(notes).toEqual([
      [
        REMOTE_TOPIC,
        "remote build-box not used: this repository's squeal.config.json forbids remote lanes (remote.allowed: false); every run is here",
      ],
    ]);
  });

  it("names the settings' problems in a note of their own", () => {
    const { adapter, notes } = lane({ repositories: { "/x": { target: "-bad" } } });
    expect(adapter).toBe(vitest);
    expect(notes[0]?.[0]).toBe(REMOTE_SETTINGS_TOPIC);
    expect(notes[0]?.[1]).toMatch(/remote\.json: "repositories\[\/x\]" "target" must be/);
  });

  it("wraps the runner when named and allowed, and names the target and why it cannot reach it", async () => {
    const { adapter, notes } = lane((root: string) => ({
      repositories: { [root]: { target: "build-box" } },
    }));
    expect(adapter).not.toBe(vitest);
    expect(notes[0]).toEqual([
      REMOTE_TOPIC,
      "remote build-box: connecting; background runs of vitest run here until it answers",
    ]);
    // The launch names no bundle: the connect fails, and status says so.
    for (let i = 0; i < 200 && notes.length < 2; i++) await sleep(10);
    expect(notes[1]?.[1]).toMatch(
      /^remote build-box unreachable since .* \(a remote lane needs Squeal's bundle to copy; .*\); running here$/,
    );
  });

  it("tells once that a lane named before is gone", () => {
    const notes: [string, string][] = [[REMOTE_TOPIC, "remote build-box: connecting"]];
    lane(undefined, DEFAULT_POLICY, notes);
    expect(notes.at(-1)).toEqual([REMOTE_TOPIC, "no remote lane: every run is here"]);
  });
});

describe("the daemon's remote lane and remote.needsRepository (row 021-23)", () => {
  it("runs a file that needs the repository here, even while the others are not run", async () => {
    const run = vi.spyOn(vitest, "run");
    onTestFinished(() => run.mockRestore());
    const policy = {
      ...DEFAULT_POLICY,
      remote: { allowed: true, needsRepository: ["test/git.*"] },
    };
    const { adapter, notes } = lane(
      (root: string) => ({
        repositories: { [root]: { target: "build-box", whenLost: "not-run" } },
      }),
      policy,
    );
    for (let i = 0; i < 200 && notes.length < 2; i++) await sleep(10);
    const background: RunOptions = {
      runId: "r",
      logDir: join(scratch, "logs"),
      timeoutMs: 1_000,
      background: true,
      lane: "vitest",
    };
    await adapter.run([{ project: "", path: "test/git.test.ts" }], background);
    const other = await adapter.run([{ project: "", path: "test/a.test.ts" }], background);
    expect(run.mock.calls.map(([files]) => files.map((f) => f.path))).toEqual([
      ["test/git.test.ts"],
    ]);
    expect(other.failure).toBe('remote build-box unreachable; not run here (whenLost "not-run")');
  });
});
