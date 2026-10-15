import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { alive } from "../harness/opencode/stub.js";
import { tempDir } from "../store/helpers.js";

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
