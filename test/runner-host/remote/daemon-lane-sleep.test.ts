import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import {
  REMOTE_TOPIC,
  sleepsRemote,
  withDaemonRemoteLane,
} from "../../../src/core/runner-host/remote/daemon-lane.js";
import { readMachines } from "../../../src/core/runner-host/remote/machines-store.js";
import { remoteSettingsPath } from "../../../src/core/runner-host/remote/settings.js";
import { REMOTE_SUMMARY_TOPIC } from "../../../src/core/runner-host/remote/summary.js";
import { DEFAULT_POLICY, type Policy } from "../../../src/core/types/policy.js";
import type { RunnerAdapter, RunOptions } from "../../../src/core/types/runner.js";
import { NO_TRAITS } from "../../../src/core/types/runner-traits.js";
import { REPORT } from "../fake-channel.js";

/*
 * Review 0.1.616 B7 (spec 026 D12.4): the daemon's lane puts its machine
 * to sleep after its channel closed, records it sleeping, leaves a machine
 * that does not sleep when idle as it is, and wakes the machine at the next
 * background run before it connects. S2 (spec 026 D1): under a policy that
 * defers Vitest, the lane reaches no machine until a background run. The
 * launch names no bundle, so each connect fails after the machine is
 * reached; the hooks are Node scripts that log their calls.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-daemon-lane-sleep-"));
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

/** Vitest's files run only on request: its keying is deferred (spec 026 D1). */
const DEFERRED: Policy = {
  ...DEFAULT_POLICY,
  checks: [{ name: "unit", runner: "vitest", at: "manual" }],
};

let n = 0;
function lane(entry: "command" | "static", policy: Policy = DEFAULT_POLICY) {
  const dir = join(scratch, `d${++n}`);
  const root = join(dir, "repo");
  mkdirSync(join(dir, "xdg", "squeal"), { recursive: true });
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q", root]);
  const real = realpathSync(root);
  const calls = join(dir, "calls.log");
  const hook = (name: string, body = "") => {
    const path = join(dir, `${name}.mjs`);
    writeFileSync(
      path,
      `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(calls)}, "${name}\\n");
${body}`,
    );
    return [process.execPath, path];
  };
  const answer = { v: 1, id: "lan", destination: "dev@lan-box", sleepOnIdle: true };
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
        [real]:
          entry === "static"
            ? { target: "build-box" }
            : {
                provider: "command",
                providerConfig: {
                  acquire: hook(
                    "acquire",
                    `console.log(${JSON.stringify(JSON.stringify(answer))});`,
                  ),
                  wake: hook("wake"),
                  sleep: hook("sleep"),
                  release: hook("release"),
                },
              },
      },
    }),
  );
  const notes: [string, string][] = [];
  const summaries: string[] = [];
  const adapter = withDaemonRemoteLane({
    root: real,
    commonDir: join(real, ".git"),
    version: "0.0.0-test",
    launch: { execPath: process.execPath, execArgv: [], cli: join(dir, "no-bundle/squeal.mjs") },
    policy: () => policy,
    vitest,
    vitestOptions: { root: real },
    // Row 026-20: the summary line has its own test; these read the lanes' own notes.
    note: (text, topic) => {
      if (topic === REMOTE_SUMMARY_TOPIC) summaries.push(text);
      else notes.push([topic, text]);
    },
    lastNote: (topic) =>
      topic === REMOTE_SUMMARY_TOPIC ? summaries.at(-1) : notes.findLast(([t]) => t === topic)?.[1],
    log: () => {},
    env,
  });
  onTestFinished(() => adapter.close());
  if (!sleepsRemote(adapter)) throw new Error("no remote lane");
  const background: RunOptions = {
    runId: "r",
    logDir: join(dir, "logs"),
    timeoutMs: 1_000,
    background: true,
    lane: "vitest",
  };
  return {
    adapter,
    summaries,
    notes,
    env,
    background,
    calls: (): string[] => {
      try {
        return readFileSync(calls, "utf8").trim().split("\n");
      } catch {
        return [];
      }
    },
    /** Waits for the lane's connect to fail: the machine was reached. */
    unreachable: async () => {
      for (let i = 0; i < 300; i++) {
        if (notes.some(([, text]) => text.includes(" unreachable since "))) return;
        await sleep(10);
      }
      throw new Error("the lane never failed its connect");
    },
  };
}

describe("the daemon's remote lane's sleep (review 0.1.616 B7)", () => {
  it("asks the machine to sleep, records it, and wakes it before the next connect", async () => {
    const l = lane("command");
    await l.unreachable();
    expect(l.calls()).toEqual(["acquire"]);
    expect(await l.adapter.sleepRemote()).toEqual({
      kind: "slept",
      provider: "command",
      machine: "cmd:lan",
    });
    expect(l.calls()).toEqual(["acquire", "sleep"]);
    expect(readMachines(l.env).machines[0]?.status).toBe("sleeping");
    // The next background run connects again, waking the machine first.
    await l.adapter.run([{ project: "", path: "test/a.test.ts" }], l.background);
    const status = () => readMachines(l.env).machines[0]?.status;
    // Row 026-43 (review 0.1.667 B2): the record is claimed awake before the wake; wait for the wake.
    for (let i = 0; i < 300 && !l.calls().includes("wake"); i++) await sleep(10);
    expect(status()).toBe("awake");
    expect(l.calls()).toEqual(["acquire", "sleep", "wake"]);
  });

  it("leaves a static ssh host as it is, and never records it sleeping", async () => {
    const l = lane("static");
    await l.unreachable();
    expect(await l.adapter.sleepRemote()).toEqual({
      kind: "always-on",
      provider: "ssh",
      machine: "build-box",
    });
    expect(readMachines(l.env).machines[0]?.status).toBe("awake");
  });
});

describe("the daemon's remote lane under a deferred policy (review 0.1.616 S2)", () => {
  it("reaches no machine until the first background run", async () => {
    const l = lane("command", DEFERRED);
    await sleep(300);
    expect(l.calls()).toEqual([]);
    expect(readMachines(l.env).machines).toEqual([]);
    expect(l.notes).toEqual([
      [REMOTE_TOPIC, "remote command: connects at the first background run of vitest"],
    ]);
    expect(await l.adapter.sleepRemote()).toEqual({
      kind: "none",
      reason: "remote command reached no machine yet",
    });
    await l.adapter.run([{ project: "", path: "test/a.test.ts" }], l.background);
    await l.unreachable();
    expect(l.calls()).toEqual(["acquire"]);
  });
});
