import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { VERSION_ARGS } from "../fixed-version.js";
import { BASE, repo } from "./code-gate-fixture.js";

/*
 * Spec 023 D6 (row 023-04, `temp-checkout.md` 4): with `--json`, the gate
 * runs in a relaunch child. A SIGKILL'd CLI process leaves no process
 * behind: the child leads a process group of its own and ends it once its
 * parent is gone, its Vitest worker and a process the test started with
 * it, and the group of each node:test file it runs. The CLI runs from
 * source through tsx, so the relaunch is real.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const CLI = resolve(import.meta.dirname, "../../src/cli/index.ts");

const SLOW_TEST = [
  'import { spawn } from "node:child_process";',
  'import { writeFileSync } from "node:fs";',
  'import { join } from "node:path";',
  'import { it } from "vitest";',
  "",
  'it("waits", async () => {',
  '  const held = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
  "  const pids = { worker: process.pid, parent: process.ppid, held: held.pid };",
  '  writeFileSync(join(process.env.GATE_MARKS ?? "", "pids.json"), JSON.stringify(pids));',
  "  await new Promise((done) => setTimeout(done, 600_000));",
  "}, 700_000);",
  "",
].join("\n");

const SLOW_NODE_TEST = [
  'import { writeFileSync } from "node:fs";',
  'import { join } from "node:path";',
  'import test from "node:test";',
  "",
  'test("waits", async () => {',
  "  const pids = { file: process.pid, runner: process.ppid };",
  '  writeFileSync(join(process.env.GATE_MARKS ?? "", "node.json"), JSON.stringify(pids));',
  "  await new Promise((done) => setTimeout(done, 600_000));",
  "});",
  "",
].join("\n");

/** Vitest runs the `.test.ts` files under `test/`; node:test, which runs each file in a group of its own, the `.test.mjs` files. */
const FILES: Readonly<Record<string, string>> = {
  ...BASE,
  "squeal.config.json": `${JSON.stringify({ nodeTest: [{ name: "t", include: ["test/*.test.mjs"] }] })}\n`,
  "test/slow.test.ts": SLOW_TEST,
  "test/slow-node.test.mjs": SLOW_NODE_TEST,
};

const left: number[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const pid of left.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Whether `pid` runs: it exists and is not a zombie waiting for its reaper. */
function alive(pid: number): boolean {
  const stat = `/proc/${pid}/stat`;
  if (existsSync("/proc/self/stat")) {
    try {
      const text = readFileSync(stat, "utf8");
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

async function until<T>(read: () => T | null, ms: number): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== null || Date.now() > end) return value;
    await delay(100);
  }
}

describe("squeal code --base --json: a SIGKILL'd CLI process leaves no child (spec 023 D6, row 023-04)", () => {
  it("ends the relaunch child, its Vitest worker, a node:test file and their processes within 5 s", {
    timeout: 180_000,
  }, async () => {
    const root = repo(FILES);
    const home = mkdtempSync(join(tmpdir(), "squeal-gate-home-"));
    const marks = mkdtempSync(join(tmpdir(), "squeal-gate-marks-"));
    dirs.push(home, marks);
    const env = { PATH: process.env.PATH ?? "", HOME: home, GATE_MARKS: marks };
    const flags = ["--disable-warning=ExperimentalWarning", ...VERSION_ARGS, "--import", TSX, CLI];
    const tests = ["--test", "test/slow.test.ts", "--test", "test/slow-node.test.mjs"];
    const args = ["code", "--base", "main", "--json", ...tests];
    const cli = spawn(process.execPath, [...flags, ...args, "--timeout", "300"], {
      cwd: root,
      env,
      stdio: "ignore",
    });
    const exited = new Promise((done) => cli.once("exit", done));
    if (cli.pid !== undefined) left.push(cli.pid);
    const read = (name: string) => JSON.parse(readFileSync(join(marks, name), "utf8"));
    const ready = () => ["pids.json", "node.json"].every((name) => existsSync(join(marks, name)));
    const pids = await until(
      () =>
        ready() ? ({ ...read("pids.json"), ...read("node.json") } as Record<string, number>) : null,
      120_000,
    );
    expect(pids).not.toBeNull();
    // The worker's parent is the relaunch child (forks), or the worker is the child itself (threads).
    const started = Object.values(pids ?? {}).filter((pid) => pid !== cli.pid);
    left.push(...started);
    expect(started.every(alive)).toBe(true);

    cli.kill("SIGKILL");
    await exited;

    const survivors = await until(() => {
      const running = started.filter(alive);
      return running.length === 0 ? running : null;
    }, 5_000);
    expect(survivors ?? started.filter(alive)).toEqual([]);
  });
});
