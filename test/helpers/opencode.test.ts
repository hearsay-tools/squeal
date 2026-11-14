import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { alive } from "../harness/opencode/stub.js";
import { tempDir } from "../store/helpers.js";
import { afterFailure } from "./opencode.js";
import { StillAlive } from "./process-groups.js";

/*
 * Spec 008 wave 2, 008-24: a process group `runOpenCode` started never outlives the Vitest
 * worker that started it. Each case runs a stand-in worker that starts a group through
 * `spawnGroup`, a leader with a grandchild, then ends without the `finally` that kills it.
 */

/** tsx's loader by URL, so the stand-in worker imports the helper from source. */
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const HELPER = pathToFileURL(resolve(import.meta.dirname, "opencode.ts")).href;

/** Each case's worker, leader and grandchild, killed after it, passed or failed. */
const started: number[] = [];
afterEach(() => {
  for (const pid of started.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, as a passing case leaves it.
    }
  }
});

/** A worker that starts a group, records its pids in `pids`, then ends as `end` says. */
function worker(end: "exit" | "wait"): { child: ChildProcess; pids: string } {
  const dir = tempDir("squeal-oc-groups-");
  const pids = join(dir, "pids.json");
  const script = join(dir, "worker.mts");
  writeFileSync(
    script,
    `import { writeFileSync } from "node:fs";
import { spawnGroup } from ${JSON.stringify(HELPER)};
const leader = spawnGroup(process.execPath, ["-e", ${JSON.stringify(`
  const { spawn } = require("node:child_process");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  process.stdout.write(String(child.pid));
  setInterval(() => {}, 1000);
`)}], { stdio: ["ignore", "pipe", "ignore"] });
leader.stdout.setEncoding("utf8").once("data", (grandchild) => {
  writeFileSync(${JSON.stringify(pids)}, JSON.stringify([leader.pid, Number(grandchild)]));
  ${end === "exit" ? "process.exit(0);" : "setInterval(() => {}, 1000);"}
});
`,
  );
  const child = spawn(process.execPath, ["--import", TSX, script], { stdio: "ignore" });
  if (child.pid !== undefined) started.push(child.pid);
  return { child, pids };
}

async function recorded(pids: string): Promise<[number, number]> {
  await expect.poll(() => existsSync(pids), { timeout: 10_000 }).toBe(true);
  const both = JSON.parse(readFileSync(pids, "utf8")) as [number, number];
  started.push(...both);
  return both;
}

const ended = (child: ChildProcess) =>
  new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) =>
    child.once("exit", (code, signal) => done({ code, signal })),
  );

describe("spawnGroup", () => {
  it("kills the group when its worker exits first", async () => {
    const { child, pids } = worker("exit");
    const exit = ended(child);
    const [leader, grandchild] = await recorded(pids);
    expect(await exit).toEqual({ code: 0, signal: null });
    await expect.poll(() => alive(leader) || alive(grandchild), { timeout: 2_000 }).toBe(false);
  });

  it("kills the group when Vitest stops the worker with SIGTERM, and the worker still ends by it", async () => {
    const { child, pids } = worker("wait");
    const exit = ended(child);
    const [leader, grandchild] = await recorded(pids);
    expect(alive(leader) && alive(grandchild)).toBe(true);
    child.kill("SIGTERM");
    expect(await exit).toEqual({ code: null, signal: "SIGTERM" });
    await expect.poll(() => alive(leader) || alive(grandchild), { timeout: 2_000 }).toBe(false);
  });
});

// Review 011-336 S1: a failed run removes its directory only once what it started has ended.
describe("afterFailure", () => {
  const run = new Error("the run failed");
  /** A run directory with a file in it. */
  const runDir = () => {
    const dir = join(tempDir("squeal-oc-failed-"), "run");
    mkdirSync(join(dir, "proj"), { recursive: true });
    writeFileSync(join(dir, "proj", "file"), "x");
    return dir;
  };

  it("removes a fresh run's directory and throws the run's own error", async () => {
    const dir = runDir();
    let ends = 0;
    const end = async () => {
      ends++;
      throw new Error("a bridge had to be killed");
    };
    expect(await afterFailure(run, end, dir, true)).toBe(run);
    expect(ends).toBe(1);
    expect(existsSync(dir)).toBe(false);
  });

  it("keeps the directory while a process outlived its SIGKILL, and names it with the run's error as cause", async () => {
    const dir = runDir();
    const member = { pid: 4242, pgid: 4242, args: "node /dist/hooks/end.mjs" };
    const end = () => Promise.reject(new StillAlive("bridges from /dist", [member]));
    const thrown = (await afterFailure(run, end, dir, true)) as Error;
    expect(thrown.message).toBe(
      `bridges from /dist still alive after their SIGKILL: 4242 node /dist/hooks/end.mjs; ${dir} was not removed`,
    );
    expect(thrown.cause).toBe(run);
    expect(existsSync(join(dir, "proj", "file"))).toBe(true);
  });
});
