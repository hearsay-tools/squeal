import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { fixture, git } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { clean, run } from "./status-at-kit.js";
import { alive, gone, stateOf, waitFor } from "./status-at-processes.js";

/*
 * Row 023-08, done-when; spec 023 D6: a `squeal proof` killed with SIGKILL
 * while its red side runs a test leaves no process running, a process the
 * test started included, and its checkout is gone after the next
 * command's sweep. The test writes its worker's pid and its started
 * process's pid where `HOLD_OUT` says, then holds.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const CHILD = resolve(import.meta.dirname, "proof-cli-child.ts");

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

describe("a killed squeal proof (row 023-08, D6)", SLOW, () => {
  it("leaves no process running, and its checkout is swept by the next command", async () => {
    const f = fixture({ "squeal.config.json": "{}\n", "src/a.ts": "export const value = 1;\n" });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const value = 2;\n", "test/a.test.ts": HOLD_TEST });
    const held = join(f.dir, "held");
    const args = [f.root, "test/a.test.ts", a, f.cacheRoot];
    const child = spawn(process.execPath, ["--import", TSX, CHILD, ...args], {
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
      expect(marks.worker).not.toBe(child.pid);
      for (const pid of pids) expect(await gone(pid, 15_000), stateOf(pid)).toBe(true);
      expect(f.checkouts()).toHaveLength(1);

      // The next command that makes a checkout sweeps the dead one first.
      await run(f, { commit: a, json: true });
      clean(f);
    } finally {
      for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
    }
  });
});
