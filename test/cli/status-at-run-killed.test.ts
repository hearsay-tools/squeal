import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { fixture, git } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { clean, run } from "./status-at-kit.js";

/*
 * Row 023-07, done-when; spec 023 D6; review wave-7 B3: a `status --at
 * --run` killed with SIGKILL while its gate runs a test leaves no process
 * running, a process the test started included, and its checkout is gone
 * after the next command's sweep. The test it runs writes its own pid and
 * its started process's pid where `HOLD_OUT` says, then holds. A zombie
 * waiting for its reaper does not count as running.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const CHILD = resolve(import.meta.dirname, "status-at-cli-child.ts");

const HOLD_TEST = [
  'import { spawn } from "node:child_process";',
  'import { writeFileSync } from "node:fs";',
  'import { it } from "vitest";',
  'import { value } from "../src/a";',
  'it("holds", async () => {',
  '  const held = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
  "  const pids = { worker: process.pid, held: held.pid };",
  "  writeFileSync(process.env.HOLD_OUT ?? '', JSON.stringify(pids));",
  "  await new Promise((done) => setTimeout(done, 600_000 + value));",
  "}, 700_000);",
  "",
].join("\n");

describe("a killed status --at --run (row 023-07, D6)", SLOW, () => {
  it("leaves no process running, and its checkout is swept by the next command", async () => {
    const f = fixture({
      "squeal.config.json": "{}\n",
      "src/a.ts": "export const value = 1;\n",
      "test/a.test.ts": HOLD_TEST,
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const value = 2;\n" });
    const held = join(f.dir, "held");
    const child = spawn(process.execPath, ["--import", TSX, CHILD, f.root, a, f.cacheRoot], {
      stdio: "ignore",
      env: { ...process.env, HOLD_OUT: held },
    });
    const exited = new Promise((done) => child.once("exit", done));
    let pids: number[] = [];
    try {
      try {
        await waitFor(held, 120_000);
      } finally {
        child.kill("SIGKILL");
        await exited;
      }
      const marks = JSON.parse(readFileSync(held, "utf8")) as { worker: number; held: number };
      pids = [marks.worker, marks.held];
      // The test ran in a worker process of its own, which the kill did not reach directly.
      expect(marks.worker).not.toBe(child.pid);
      for (const pid of pids) expect(await gone(pid, 15_000), stateOf(pid)).toBe(true);
      expect(f.checkouts()).toHaveLength(1);

      const next = await run(f, { commit: a, json: true });
      expect(JSON.parse(next.out).files).toHaveLength(1);
      clean(f);
    } finally {
      for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
    }
  });
});

async function waitFor(path: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`${path} was not written in ${ms} ms`);
    await delay(50);
  }
}

/** Whether `pid` runs: it exists and is not a zombie waiting for its reaper. */
function alive(pid: number): boolean {
  if (existsSync("/proc/self/stat")) {
    try {
      const text = readFileSync(`/proc/${pid}/stat`, "utf8");
      return text.slice(text.lastIndexOf(")") + 2)[0] !== "Z";
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** `pid`'s `/proc` state line, for a failure's message. */
function stateOf(pid: number): string {
  try {
    return `${pid}: ${readFileSync(`/proc/${pid}/stat`, "utf8").trim()}`;
  } catch {
    return `${pid}: no /proc entry`;
  }
}

async function gone(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (alive(pid)) {
    if (Date.now() > deadline) return false;
    await delay(50);
  }
  return true;
}
