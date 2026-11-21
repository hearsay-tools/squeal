import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  type RecordedRun,
  RUN_GROUP_VARIABLE,
  RunRecord,
  readRuns,
  writeRuns,
} from "../../src/core/daemon/run-groups.js";
import {
  NOT_COVERED,
  type RunTable,
  runStopNote,
  stopRuns,
} from "../../src/core/daemon/run-groups-stop.js";
import { type ProcessEntry, statOf } from "../../src/core/daemon/terminate.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Row 023-36 (spec 023 D4 step 11, T3; review wave-20 B6): the record of a
 * `--run` run's token, and its stop: only what carries the token, and the
 * groups whose live leader carries it. A group id with no live marked
 * leader proves nothing: its unmarked members are spared and named.
 */

const TOKEN = "run-token-0123456789abcdef";
const OTHER = "other-token-0123456789abcdef";

const run = (groups: RecordedRun["groups"] = []): RecordedRun => ({
  token: TOKEN,
  runId: "old",
  groups,
});

/** A table of fixed processes and tokens; a signal ends the process. */
function table(entries: ProcessEntry[], tokens: Record<number, string>) {
  const signalled: number[] = [];
  let live = [...entries];
  const fake: RunTable = {
    list: () => live,
    token: (pid) => tokens[pid] ?? null,
    stat: (pid) => live.find((entry) => entry.pid === pid) ?? null,
    commandLine: async (pid) => `cmd-${pid}`,
    signal: (pid) => {
      signalled.push(pid);
      live = live.filter((entry) => entry.pid !== pid);
    },
    uptime: () => 1_000,
  };
  return { fake, signalled };
}

const entry = (pid: number, pgrp: number, start: number, ppid = 1): ProcessEntry => ({
  pid,
  ppid,
  pgrp,
  start,
});

describe("stopRuns on a process table", () => {
  it("B6: spares a member of a recorded group whose newer leader is gone, and names it", async () => {
    // Group 100 ended; a later unrelated leader took 100 at tick 90, started 101, and exited.
    const { fake, signalled } = table([entry(101, 100, 95)], {});
    const stop = await stopRuns([run([{ pgid: 100, start: 50 }])], undefined, fake);
    expect(signalled).toEqual([]);
    expect(stop.stopped).toEqual([]);
    expect(stop.spared).toEqual([{ pid: 101, pgid: 100, runId: "old" }]);
    const text = runStopNote(stop)?.text ?? "";
    expect(text).toContain("left 1 process running");
    expect(text).toContain(NOT_COVERED);
  });

  it("stops a carrier, and the unmarked members of a group its live carrier leads", async () => {
    const { fake, signalled } = table([entry(200, 200, 10), entry(201, 200, 11, 200)], {
      200: TOKEN,
    });
    const stop = await stopRuns([run()], undefined, fake);
    expect(signalled.sort()).toEqual([200, 201]);
    expect(stop.stopped.map(({ run: of }) => of)).toEqual(["run old", "run old"]);
    expect(stop.groups.get(TOKEN)).toEqual([{ pgid: 200, start: 10 }]);
  });

  it("never signals a process with no token or another run's", async () => {
    const { fake, signalled } = table([entry(300, 300, 10), entry(301, 301, 10)], {
      301: OTHER,
    });
    const stop = await stopRuns([run([{ pgid: 300, start: 5 }])], undefined, fake);
    expect(signalled).toEqual([]);
    // 300 leads its own group now with no mark: the recorded id alone proves nothing.
    expect(stop.spared.map(({ pid }) => pid)).toEqual([300]);
  });

  it("spares the run's own workers by the given rule", async () => {
    const { fake, signalled } = table([entry(400, 400, 10, 7), entry(401, 401, 11, 400)], {
      400: TOKEN,
      401: TOKEN,
    });
    await stopRuns([run()], (one) => one.pid === 400, fake);
    expect(signalled).toEqual([401]);
  });
});

describe("the record file", () => {
  it("writes, reads back, adds groups and removes itself when empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-run-groups-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "sub", "runs.json") as AbsolutePath;
    const record = new RunRecord(file);
    record.add(run());
    record.add(run());
    record.saw(TOKEN, [{ pgid: 42, start: 7 }]);
    record.saw(TOKEN, [{ pgid: 42, start: 7 }]);
    expect(readRuns(file)).toEqual([run([{ pgid: 42, start: 7 }])]);
    expect(new RunRecord(file).list()).toHaveLength(1);
    record.remove([TOKEN]);
    expect(readRuns(file)).toEqual([]);
    writeRuns(file, []);
    expect(readRuns(file)).toEqual([]);
  });
});

/** A sleeping node in a session and group of its own with `env`. */
async function detached(env: NodeJS.ProcessEnv): Promise<ProcessEntry> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();
  const pid = child.pid;
  if (pid === undefined) throw new Error("no pid");
  onTestFinished(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // gone
    }
  });
  for (let i = 0; i < 100; i++) {
    const found = statOf(pid);
    if (found !== null && found.pgrp === pid) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`process ${pid} did not start`);
}

describe.runIf(process.platform === "linux")("stopRuns on real processes", () => {
  it("stops the run's carrier, names it, and leaves an outside and another run's process", async () => {
    const inside = await detached({ [RUN_GROUP_VARIABLE]: TOKEN });
    const outside = await detached({});
    const other = await detached({ [RUN_GROUP_VARIABLE]: OTHER });
    const stop = await stopRuns([{ token: TOKEN, runId: "run-1", groups: [] }]);
    expect(stop.stopped.map(({ pid }) => pid)).toEqual([inside.pid]);
    expect(stop.stopped[0]?.run).toBe("run run-1");
    expect(statOf(inside.pid)).toBeNull();
    expect(statOf(outside.pid)?.start).toBe(outside.start);
    expect(statOf(other.pid)?.start).toBe(other.start);
    expect(runStopNote(stop)?.text).toMatch(/^stopped 1 process a `--run` run started: /);
  });
});
